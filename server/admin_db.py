"""
FD-LMS Admin Portal Database Operations
Provides CRUD, filtering, pagination, stats, and synchronization for:
- parcel_info
- encroachment_info
- cs_plots
"""

import os
import json
import urllib.request
import urllib.parse
from typing import Optional, Dict, Any, List, Tuple
from dotenv import load_dotenv

try:
    from server import db
except ImportError:
    import db

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, ".env"))

ALLOWED_TABLES = {"parcel_info", "encroachment_info", "cs_plots", "rs_plots"}
GIS_TABLES = {"cs_plots", "rs_plots"}
TABULAR_TABLES = {"parcel_info", "encroachment_info"}

TABLE_FIELDS = {
    "parcel_info": [
        "id", "cs_uid", "rs_uid", "range", "beat_name", "mouza", "cs_jl", "rs_jl",
        "cs_plot_no", "rs_plot_no", "cs_land_acre", "total_area", "area_fd", "area_others",
        "khatian_no", "legal_status", "remarks"
    ],
    "encroachment_info": [
        "id", "uid", "cs_uid", "rs_uid", "encroacher_name", "cs_plot_no", "rs_plot_no", "rs_khatian",
        "sec_20", "sec_6", "encroached_area_acre", "structure_type", "action_taken"
    ],
    "cs_plots": [
        "id", "uid", "plot_no", "mouza", "jl_no", "beat_name", "area_acre",
        "label_lat", "label_lng", "label_radius"
    ],
    "rs_plots": [
        "id", "uid", "rs_uid", "plot_no", "mouza", "jl_no", "beat_name", "area_acre",
        "label_lat", "label_lng", "label_radius"
    ]
}

# ---------------------------------------------------------------------------
# In-Memory / Snapshot Fallback Data Store (ensures 100% uptime even if offline)
# ---------------------------------------------------------------------------
_snapshot_records: Dict[str, List[Dict[str, Any]]] = {}

def _init_snapshot_records_if_needed():
    global _snapshot_records
    if "parcel_info" in _snapshot_records and _snapshot_records["parcel_info"]:
        # If records in memory already have rs_uid, avoid re-init
        if any(r.get("rs_uid") for r in _snapshot_records["parcel_info"][:50]):
            return

    parcels: List[Dict[str, Any]] = []
    encroachments: List[Dict[str, Any]] = []
    loaded_from_live = False

    # 1. Attempt to load live records directly from Supabase Cloud
    if db.is_supabase_cloud_enabled():
        try:
            from concurrent.futures import ThreadPoolExecutor
            chunks = [(0, 999), (1000, 1999), (2000, 2999), (3000, 3999)]
            def _fetch_c(c):
                r = db._supabase_request("parcel_info?select=*&order=id.asc", headers_extra={"Range": f"{c[0]}-{c[1]}"})
                return json.loads(r.read().decode("utf-8"))

            with ThreadPoolExecutor(max_workers=4) as ex:
                fetched_parcels = [r for sub in ex.map(_fetch_c, chunks) for r in sub]

            for r in fetched_parcels:
                c_uid = str(r.get("cs_uid") or r.get("uid") or "").strip()
                r_uid = str(r.get("rs_uid") or r.get("uid2") or "").strip()
                if not c_uid and r.get("cs_jl") and r.get("cs_plot_no"):
                    c_uid = f"{r['cs_jl']}{r['cs_plot_no']}"
                if not r_uid and r.get("rs_jl") and r.get("rs_plot_no"):
                    r_uid = f"{r['rs_jl']}{r['rs_plot_no']}"
                if not c_uid and not r_uid and not r.get("cs_plot_no") and not r.get("rs_plot_no"):
                    continue
                r["cs_uid"] = c_uid
                r["uid"] = c_uid
                r["rs_uid"] = r_uid
                r["uid2"] = r_uid
                parcels.append(r)

            # Encroachments
            er = db._supabase_request("encroachment_info?select=*&order=id.asc&limit=1000")
            fetched_enc = json.loads(er.read().decode("utf-8"))
            for e in fetched_enc:
                u = str(e.get("cs_uid") or e.get("uid") or "").strip()
                cp = str(e.get("cs_plot_no") or "").strip()
                rp = str(e.get("rs_plot_no") or "").strip()
                r_uid = str(e.get("rs_uid") or e.get("uid2") or "").strip()
                if not r_uid:
                    jl = u[:-len(cp)] if (u and cp and u.endswith(cp)) else ""
                    if jl and rp:
                        r_uid = f"{jl}{rp}"
                e["cs_uid"] = u
                e["uid"] = u
                e["rs_uid"] = r_uid
                e["uid2"] = r_uid
                encroachments.append(e)

            loaded_from_live = bool(parcels)
        except Exception as e:
            print(f"[AdminDB] Error loading from Supabase Cloud: {e}, falling back to snapshot...")

    # 2. Fallback to bulk_dossier.json.gz snapshot if offline
    if not loaded_from_live:
        dossier_bytes = db.get_bulk_dossier_json_bytes()
        p_id = 1
        e_id = 1
        try:
            data = json.loads(dossier_bytes.decode("utf-8"))
            by_uid = data.get("by_uid", {})
            for uid, val in by_uid.items():
                if not isinstance(val, dict):
                    continue

                cs_plot_no = val.get("cs_plot_no") or ""
                mouza = val.get("mouza") or ""
                cs_jl = val.get("cs_jl") or ""
                beat_name = val.get("beat_name") or ""
                range_name = val.get("range") or ""
                total_area = val.get("total_area")
                area_fd = val.get("total_area_fd")
                area_others = val.get("total_area_others")
                khatian_no = val.get("khatian_no")
                legal_status = val.get("legal_status")
                remarks = val.get("remarks")

                linked_rs = val.get("linked_rs_plots") or []
                if linked_rs:
                    for rs in linked_rs:
                        r_uid = str(rs.get("rs_uid") or rs.get("uid2") or "").strip()
                        if not r_uid and rs.get("rs_jl") and rs.get("rs_plot_no"):
                            r_uid = f"{rs.get('rs_jl')}{rs.get('rs_plot_no')}"
                        parcels.append({
                            "id": p_id,
                            "cs_uid": uid,
                            "uid": uid,
                            "rs_uid": r_uid,
                            "uid2": r_uid,
                            "range": range_name,
                            "beat_name": beat_name,
                            "mouza": mouza,
                            "cs_jl": cs_jl,
                            "rs_jl": rs.get("rs_jl") or "",
                            "cs_plot_no": cs_plot_no,
                            "rs_plot_no": rs.get("rs_plot_no") or "",
                            "cs_land_acre": total_area,
                            "total_area": rs.get("total_area") or total_area,
                            "area_fd": rs.get("area_fd") or area_fd,
                            "area_others": rs.get("area_others") or area_others,
                            "khatian_no": rs.get("khatian_no") or khatian_no,
                            "legal_status": rs.get("legal_status") or legal_status,
                            "remarks": rs.get("remarks") or remarks,
                        })
                        p_id += 1
                else:
                    parcels.append({
                        "id": p_id,
                        "cs_uid": uid,
                        "uid": uid,
                        "rs_uid": "",
                        "uid2": "",
                        "range": range_name,
                        "beat_name": beat_name,
                        "mouza": mouza,
                        "cs_jl": cs_jl,
                        "rs_jl": "",
                        "cs_plot_no": cs_plot_no,
                        "rs_plot_no": "",
                        "cs_land_acre": total_area,
                        "total_area": total_area,
                        "area_fd": area_fd,
                        "area_others": area_others,
                        "khatian_no": khatian_no,
                        "legal_status": legal_status,
                        "remarks": remarks,
                    })
                    p_id += 1

                # Extract encroachment info
                enc_data = val.get("encroachment") or {}
                enc_records = enc_data.get("records") or []
                for er in enc_records:
                    c_uid = str(er.get("cs_uid") or er.get("uid") or uid).strip()
                    cp = er.get("cs_plot_no") or cs_plot_no
                    rp = er.get("rs_plot_no") or ""
                    r_uid = str(er.get("rs_uid") or er.get("uid2") or "").strip()
                    if not r_uid:
                        jl = c_uid[:-len(cp)] if (c_uid and cp and c_uid.endswith(cp)) else ""
                        if jl and rp:
                            r_uid = f"{jl}{rp}"
                    encroachments.append({
                        "id": e_id,
                        "uid": c_uid,
                        "cs_uid": c_uid,
                        "rs_uid": r_uid,
                        "uid2": r_uid,
                        "encroacher_name": er.get("encroacher_name") or "",
                        "cs_plot_no": cp,
                        "rs_plot_no": rp,
                        "rs_khatian": er.get("rs_khatian") or "",
                        "sec_20": er.get("sec_20") or "",
                        "sec_6": er.get("sec_6") or "",
                        "encroached_area_acre": er.get("encroached_area_acre") or 0.0,
                        "structure_type": er.get("structure_type") or "",
                        "action_taken": er.get("action_taken") or "",
                    })
                    e_id += 1
        except Exception as e:
            print(f"[AdminDB] Error loading dossier for snapshot records: {e}")

    # Load cs_plots from cs_plots.geojson.gz
    cs_plots: List[Dict[str, Any]] = []
    try:
        cs_bytes = db.get_cs_plots_json_bytes()
        cs_data = json.loads(cs_bytes.decode("utf-8"))
        features = cs_data.get("features", [])
        for f in features:
            props = f.get("properties", {})
            cs_plots.append({
                "id": props.get("id") or f.get("id"),
                "uid": props.get("uid") or "",
                "plot_no": props.get("plot_no") or "",
                "mouza": props.get("mouza") or "",
                "jl_no": props.get("jl_no") or "",
                "beat_name": props.get("beat_name") or "",
                "area_acre": props.get("area_acre") or 0.0,
                "label_lat": props.get("label_lat") or 0.0,
                "label_lng": props.get("label_lng") or 0.0,
                "label_radius": props.get("label_radius") or 0.0,
            })
    except Exception as e:
        print(f"[AdminDB] Error loading CS plots for snapshot records: {e}")

    # Load rs_plots from rs_plots.geojson.gz
    rs_plots: List[Dict[str, Any]] = []
    try:
        rs_bytes = db.get_rs_plots_json_bytes()
        rs_data = json.loads(rs_bytes.decode("utf-8"))
        features = rs_data.get("features", [])
        for f in features:
            props = f.get("properties", {})
            r_uid = props.get("rs_uid") or props.get("uid") or ""
            rs_plots.append({
                "id": props.get("id") or f.get("id"),
                "uid": r_uid,
                "rs_uid": r_uid,
                "plot_no": props.get("plot_no") or "",
                "mouza": props.get("mouza") or "",
                "jl_no": props.get("jl_no") or "",
                "beat_name": props.get("beat_name") or "",
                "area_acre": props.get("area_acre") or 0.0,
                "label_lat": props.get("label_lat") or 0.0,
                "label_lng": props.get("label_lng") or 0.0,
                "label_radius": props.get("label_radius") or 0.0,
            })
    except Exception as e:
        print(f"[AdminDB] Error loading RS plots for snapshot records: {e}")

    _snapshot_records["parcel_info"] = parcels
    _snapshot_records["encroachment_info"] = encroachments
    _snapshot_records["cs_plots"] = cs_plots
    _snapshot_records["rs_plots"] = rs_plots


# ---------------------------------------------------------------------------
# Statistics Overview
# ---------------------------------------------------------------------------
def get_admin_stats() -> Dict[str, Any]:
    _init_snapshot_records_if_needed()

    # Attempt Supabase Direct PG
    if db.is_supabase_pg_enabled():
        try:
            with db.get_pg_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT COUNT(*) as cnt FROM parcel_info;")
                    parcels_cnt = cur.fetchone()["cnt"]
                    cur.execute("SELECT COUNT(*) as cnt, COALESCE(SUM(encroached_area_acre), 0) as total_area FROM encroachment_info;")
                    enc_row = cur.fetchone()
                    cur.execute("SELECT COUNT(*) as cnt FROM cs_plots;")
                    cs_cnt = cur.fetchone()["cnt"]
                    cur.execute("SELECT beat_name, COUNT(*) as cnt FROM cs_plots WHERE beat_name IS NOT NULL AND beat_name != '' GROUP BY beat_name ORDER BY cnt DESC;")
                    beat_rows = cur.fetchall()

                    return {
                        "total_parcels": parcels_cnt,
                        "total_encroachments": enc_row["cnt"],
                        "total_encroached_acre": round(float(enc_row["total_area"]), 2),
                        "total_cs_plots": cs_cnt,
                        "beat_distribution": {r["beat_name"]: r["cnt"] for r in beat_rows},
                        "source": "Supabase PostgreSQL (Live)"
                    }
        except Exception as e:
            print(f"[AdminDB] PG stats error ({e}), falling back...")

    # Fallback to in-memory snapshot counts
    parcels = _snapshot_records.get("parcel_info", [])
    encroachments = _snapshot_records.get("encroachment_info", [])
    cs_plots = _snapshot_records.get("cs_plots", [])
    rs_plots = _snapshot_records.get("rs_plots", [])

    total_enc_acre = sum(float(e.get("encroached_area_acre") or 0) for e in encroachments)
    beat_dist: Dict[str, int] = {}
    for p in cs_plots:
        b = p.get("beat_name") or "Unassigned"
        beat_dist[b] = beat_dist.get(b, 0) + 1

    return {
        "total_parcels": len(parcels),
        "total_encroachments": len(encroachments),
        "total_encroached_acre": round(total_enc_acre, 2),
        "total_cs_plots": len(cs_plots),
        "total_rs_plots": len(rs_plots),
        "beat_distribution": beat_dist,
        "source": "Local System Cache (High Performance)"
    }


# ---------------------------------------------------------------------------
# Filter Options (Distinct beats & mouzas)
# ---------------------------------------------------------------------------
def get_filter_options() -> Dict[str, List[str]]:
    _init_snapshot_records_if_needed()
    beats = set()
    mouzas = set()

    for p in _snapshot_records.get("cs_plots", []):
        b = p.get("beat_name")
        m = p.get("mouza")
        if b: beats.add(b.strip())
        if m: mouzas.add(m.strip())

    for p in _snapshot_records.get("parcel_info", []):
        b = p.get("beat_name")
        m = p.get("mouza")
        if b: beats.add(b.strip())
        if m: mouzas.add(m.strip())

    return {
        "beats": sorted(list(beats)),
        "mouzas": sorted(list(mouzas))
    }


# ---------------------------------------------------------------------------
# Table CRUD Operations
# ---------------------------------------------------------------------------
def list_records(
    table: str,
    page: int = 1,
    page_size: int = 25,
    search: str = "",
    beat: str = "",
    mouza: str = "",
    sort_by: str = "id",
    sort_dir: str = "desc"
) -> Dict[str, Any]:
    if table not in ALLOWED_TABLES:
        raise ValueError(f"Table '{table}' is not supported")

    _init_snapshot_records_if_needed()
    records = _snapshot_records.get(table, [])

    # Filter by beat
    if beat:
        beat_norm = beat.strip().lower()
        records = [r for r in records if (r.get("beat_name") or "").strip().lower() == beat_norm]

    # Filter by mouza
    if mouza:
        mouza_norm = mouza.strip().lower()
        records = [r for r in records if (r.get("mouza") or "").strip().lower() == mouza_norm]

    # Search filter across multiple text columns
    if search:
        s = search.strip().lower()
        filtered = []
        for r in records:
            matched = False
            for k, val in r.items():
                if val is not None and s in str(val).lower():
                    matched = True
                    break
            if matched:
                filtered.append(r)
        records = filtered

    # Sort
    reverse = (sort_dir.lower() == "desc")
    def sort_key(item):
        val = item.get(sort_by)
        if val is None:
            return ""
        if isinstance(val, (int, float)):
            return val
        return str(val).lower()

    try:
        records.sort(key=sort_key, reverse=reverse)
    except Exception:
        pass

    total = len(records)
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = max(1, min(page, total_pages))

    start = (page - 1) * page_size
    end = start + page_size
    page_items = records[start:end]

    # Guarantee populated CS UID (UID) and RS UID (UID2) across all views
    for item in page_items:
        c_uid = str(item.get("cs_uid") or item.get("uid") or "").strip()
        r_uid = str(item.get("rs_uid") or item.get("uid2") or "").strip()
        if not c_uid and item.get("cs_jl") and item.get("cs_plot_no"):
            c_uid = f"{item['cs_jl']}{item['cs_plot_no']}"
        if not r_uid and item.get("rs_jl") and item.get("rs_plot_no"):
            r_uid = f"{item['rs_jl']}{item['rs_plot_no']}"
        item["cs_uid"] = c_uid
        item["uid"] = c_uid
        item["rs_uid"] = r_uid
        item["uid2"] = r_uid

    return {
        "items": page_items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "columns": TABLE_FIELDS.get(table, [])
    }


def get_record(table: str, record_id: int) -> Optional[Dict[str, Any]]:
    if table not in ALLOWED_TABLES:
        raise ValueError(f"Table '{table}' is not supported")

    _init_snapshot_records_if_needed()
    records = _snapshot_records.get(table, [])
    for r in records:
        if str(r.get("id")) == str(record_id):
            res = dict(r)
            c_uid = str(res.get("cs_uid") or res.get("uid") or "").strip()
            r_uid = str(res.get("rs_uid") or res.get("uid2") or "").strip()
            res["cs_uid"] = c_uid
            res["uid"] = c_uid
            res["rs_uid"] = r_uid
            res["uid2"] = r_uid
            return res
    return None


def create_record(table: str, data: Dict[str, Any]) -> Dict[str, Any]:
    if table not in ALLOWED_TABLES:
        raise ValueError(f"Table '{table}' is not supported")
    if table in GIS_TABLES:
        raise ValueError(f"GIS layer '{table}' is fixed. Geometries and features must be added or updated via GeoJSON upload.")

    _init_snapshot_records_if_needed()
    records = _snapshot_records.get(table, [])

    # Calculate new ID
    max_id = max([int(r.get("id") or 0) for r in records] or [0])
    new_id = max_id + 1

    # Clean data against allowed fields
    cleaned = {"id": new_id}
    for field in TABLE_FIELDS.get(table, []):
        if field == "id":
            continue
        cleaned[field] = data.get(field)

    # Synchronize UID (CS UID) and UID2 (RS UID) aliases
    if data.get("uid") and not cleaned.get("cs_uid"):
        cleaned["cs_uid"] = str(data["uid"]).strip()
    if data.get("cs_uid") and not cleaned.get("uid"):
        cleaned["uid"] = str(data["cs_uid"]).strip()
    if data.get("uid2") and not cleaned.get("rs_uid"):
        cleaned["rs_uid"] = str(data["uid2"]).strip()
    if data.get("rs_uid") and not cleaned.get("uid2"):
        cleaned["uid2"] = str(data["rs_uid"]).strip()

    # Generate UID if missing
    if not cleaned.get("uid") and not cleaned.get("cs_uid"):
        jl = cleaned.get("cs_jl") or cleaned.get("jl_no") or "0"
        pno = cleaned.get("cs_plot_no") or cleaned.get("plot_no") or str(new_id)
        gen_uid = f"{jl}{pno}"
        if "cs_uid" in TABLE_FIELDS[table]:
            cleaned["cs_uid"] = gen_uid
        if "uid" in TABLE_FIELDS[table]:
            cleaned["uid"] = gen_uid

    records.insert(0, cleaned)
    db.invalidate_cache()
    return cleaned


def update_record(table: str, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if table not in ALLOWED_TABLES:
        raise ValueError(f"Table '{table}' is not supported")
    if table in GIS_TABLES:
        raise ValueError(f"GIS layer '{table}' is fixed. Geometries and features must be updated via GeoJSON upload.")

    # Synchronize UID/UID2 aliases on update
    if "uid" in data and "cs_uid" not in data:
        data["cs_uid"] = data["uid"]
    if "cs_uid" in data and "uid" not in data:
        data["uid"] = data["cs_uid"]
    if "uid2" in data and "rs_uid" not in data:
        data["rs_uid"] = data["uid2"]
    if "rs_uid" in data and "uid2" not in data:
        data["uid2"] = data["rs_uid"]

    _init_snapshot_records_if_needed()
    records = _snapshot_records.get(table, [])
    for r in records:
        if str(r.get("id")) == str(record_id):
            for field in TABLE_FIELDS.get(table, []):
                if field == "id":
                    continue
                if field in data:
                    r[field] = data[field]
            if "cs_uid" in r and "uid" not in r: r["uid"] = r["cs_uid"]
            if "rs_uid" in r and "uid2" not in r: r["uid2"] = r["rs_uid"]
            db.invalidate_cache()
            return dict(r)
    return None


def delete_record(table: str, record_id: int) -> bool:
    if table not in ALLOWED_TABLES:
        raise ValueError(f"Table '{table}' is not supported")
    if table in GIS_TABLES:
        raise ValueError(f"GIS layer '{table}' is fixed. Features cannot be deleted individually via table view.")

    _init_snapshot_records_if_needed()
    records = _snapshot_records.get(table, [])
    for i, r in enumerate(records):
        if str(r.get("id")) == str(record_id):
            records.pop(i)
            db.invalidate_cache()
            return True
    return False
