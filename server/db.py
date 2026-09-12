"""
FD-LMS Database Access & Spatial Query Layer
Supabase-only: Direct PostgreSQL (preferred) → Supabase Cloud REST API (fallback).
Local SQLite has been removed — system requires Supabase connectivity.
"""

import os
import json
import csv
import io
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from typing import Optional, List, Dict, Any, Tuple
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, ".env"))

SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL", "").strip()
SUPABASE_URL    = os.getenv("SUPABASE_URL", "https://tbffjjlkmzswcmwdkulh.supabase.co").strip()
SUPABASE_KEY    = os.getenv("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiZmZqamxrbXpzd2Ntd2RrdWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwMTgwODMsImV4cCI6MjEwNDU5NDA4M30.8QTxmJNbuA91yfNyztrZqq4kvMniN0t9j6C6TaiQyYg").strip()

import time
import gzip
import hashlib

CACHE_DIR = os.path.join(BASE_DIR, "data", "cache")
try:
    os.makedirs(CACHE_DIR, exist_ok=True)
except OSError:
    pass

# In-memory cached JSON bytes and pre-compressed GZip bytes with ETags
_cs_cache_bytes: Optional[bytes] = None
_cs_gzip_bytes: Optional[bytes] = None
_cs_etag: Optional[str] = None

_encroach_cache_bytes: Optional[bytes] = None
_encroach_gzip_bytes: Optional[bytes] = None
_encroach_etag: Optional[str] = None

_bulk_dossier_cache_bytes: Optional[bytes] = None
_bulk_dossier_gzip_bytes: Optional[bytes] = None
_bulk_dossier_etag: Optional[str] = None

def _calc_etag(data: bytes) -> str:
    return f'"{hashlib.md5(data).hexdigest()}"'

# Beat name corrections for specific plots:
# Araishprashad (JL 18): Plots 621, 622, 623 -> Baupara Beat; Plots 321, 979 -> Park Beat
BEAT_NAME_OVERRIDES: Dict[str, str] = {
    "18621": "Baupara",    # Araishprashad CS Plot 621 -> Baupara Beat
    "18622": "Baupara",    # Araishprashad CS Plot 622 -> Baupara Beat
    "18623": "Baupara",    # Araishprashad CS Plot 623 -> Baupara Beat
    "18321": "Park Beat",  # Araishprashad CS Plot 321 -> Park Beat
    "18979": "Park Beat",  # Araishprashad CS Plot 979 -> Park Beat
}

def init_disk_cache():
    """Pre-loads spatial datasets and bulk dossier directly from disk snapshots in <10ms."""
    global _cs_cache_bytes, _cs_gzip_bytes, _cs_etag
    global _bulk_dossier_cache_bytes, _bulk_dossier_gzip_bytes, _bulk_dossier_etag
    global _encroach_cache_bytes, _encroach_gzip_bytes, _encroach_etag

    # 1. CS Plots
    cs_path = os.path.join(CACHE_DIR, "cs_plots.geojson.gz")
    if os.path.exists(cs_path) and _cs_cache_bytes is None:
        try:
            with open(cs_path, "rb") as f:
                _cs_gzip_bytes = f.read()
            _cs_cache_bytes = gzip.decompress(_cs_gzip_bytes)
            _cs_etag = _calc_etag(_cs_gzip_bytes)
            print(f"[FD-LMS] CS plots loaded from disk snapshot: {len(_cs_cache_bytes):,} bytes [OK]")
        except Exception as e:
            print(f"[FD-LMS] CS plots disk cache load error: {e}")

    # 2. Bulk Dossier
    bulk_path = os.path.join(CACHE_DIR, "bulk_dossier.json.gz")
    if os.path.exists(bulk_path) and _bulk_dossier_cache_bytes is None:
        try:
            with open(bulk_path, "rb") as f:
                _bulk_dossier_gzip_bytes = f.read()
            _bulk_dossier_cache_bytes = gzip.decompress(_bulk_dossier_gzip_bytes)
            _bulk_dossier_etag = _calc_etag(_bulk_dossier_gzip_bytes)
            print(f"[FD-LMS] Bulk dossier loaded from disk snapshot: {len(_bulk_dossier_cache_bytes):,} bytes [OK]")
        except Exception as e:
            print(f"[FD-LMS] Bulk dossier disk cache load error: {e}")

    # 3. Encroachments
    encroach_path = os.path.join(CACHE_DIR, "encroachments.geojson.gz")
    if os.path.exists(encroach_path) and _encroach_cache_bytes is None:
        try:
            with open(encroach_path, "rb") as f:
                _encroach_gzip_bytes = f.read()
            _encroach_cache_bytes = gzip.decompress(_encroach_gzip_bytes)
            _encroach_etag = _calc_etag(_encroach_gzip_bytes)
            print(f"[FD-LMS] Encroachments loaded from disk snapshot: {len(_encroach_cache_bytes):,} bytes [OK]")
        except Exception as e:
            print(f"[FD-LMS] Encroachments disk cache load error: {e}")

# Pre-load immediately on import
init_disk_cache()


def invalidate_cache(dataset: Optional[str] = None):
    """Invalidates in-memory caches so subsequent requests fetch/rebuild fresh data."""
    global _cs_cache_bytes, _cs_gzip_bytes, _cs_etag
    global _encroach_cache_bytes, _encroach_gzip_bytes, _encroach_etag
    global _bulk_dossier_cache_bytes, _bulk_dossier_gzip_bytes, _bulk_dossier_etag

    if dataset == "cs_plots":
        _cs_cache_bytes = None
        _cs_gzip_bytes = None
        _cs_etag = None
    elif dataset == "encroachments":
        _encroach_cache_bytes = None
        _encroach_gzip_bytes = None
        _encroach_etag = None
    elif dataset in ("dossier", "parcel_info"):
        _bulk_dossier_cache_bytes = None
        _bulk_dossier_gzip_bytes = None
        _bulk_dossier_etag = None
    elif dataset is None:
        _encroach_cache_bytes = None
        _encroach_gzip_bytes = None
        _encroach_etag = None
        _bulk_dossier_cache_bytes = None
        _bulk_dossier_gzip_bytes = None
        _bulk_dossier_etag = None
    print(f"[FD-LMS] In-memory cache invalidated for: {dataset or 'DOSSIER/ENCROACHMENTS'}")


def rebuild_snapshots() -> Dict[str, Any]:
    """Rebuilds data/cache/*.gz snapshot files and re-primes in-memory gzip buffers."""
    global _cs_cache_bytes, _cs_gzip_bytes, _cs_etag
    global _encroach_cache_bytes, _encroach_gzip_bytes, _encroach_etag
    global _bulk_dossier_cache_bytes, _bulk_dossier_gzip_bytes, _bulk_dossier_etag

    results = {}
    try:
        # 1. CS Plots: retain existing loaded snapshot bytes
        cs_path = os.path.join(CACHE_DIR, "cs_plots.geojson.gz")
        if _cs_gzip_bytes is None and os.path.exists(cs_path):
            with open(cs_path, "rb") as f:
                _cs_gzip_bytes = f.read()
                _cs_cache_bytes = gzip.decompress(_cs_gzip_bytes)
        elif _cs_cache_bytes is not None:
            _cs_gzip_bytes = gzip.compress(_cs_cache_bytes, compresslevel=6)
            with open(cs_path, "wb") as f:
                f.write(_cs_gzip_bytes)
        _cs_etag = _calc_etag(_cs_gzip_bytes) if _cs_gzip_bytes else None
        results["cs_plots"] = {"bytes": len(_cs_gzip_bytes) if _cs_gzip_bytes else 0, "status": "saved"}
    except Exception as e:
        results["cs_plots"] = {"error": str(e)}

    try:
        # 2. Bulk Dossier: serialize latest records
        import server.admin_db as admin_db
        admin_db._init_snapshot_records_if_needed()
        p_rows = admin_db._snapshot_records.get("parcel_info", [])
        e_rows = admin_db._snapshot_records.get("encroachment_info", [])
        raw_bd = _build_bulk_payload(p_rows, e_rows)
        gz_bd = gzip.compress(raw_bd, compresslevel=6)
        bd_path = os.path.join(CACHE_DIR, "bulk_dossier.json.gz")
        with open(bd_path, "wb") as f:
            f.write(gz_bd)
        _bulk_dossier_gzip_bytes = gz_bd
        _bulk_dossier_cache_bytes = raw_bd
        _bulk_dossier_etag = _calc_etag(gz_bd)
        results["bulk_dossier"] = {"bytes": len(gz_bd), "status": "saved"}
    except Exception as e:
        results["bulk_dossier"] = {"error": str(e)}

    try:
        # 3. Encroachments: serialize latest encroachments
        en_path = os.path.join(CACHE_DIR, "encroachments.geojson.gz")
        if _encroach_gzip_bytes is None and os.path.exists(en_path):
            with open(en_path, "rb") as f:
                _encroach_gzip_bytes = f.read()
                _encroach_cache_bytes = gzip.decompress(_encroach_gzip_bytes)
        elif _encroach_cache_bytes is not None:
            _encroach_gzip_bytes = gzip.compress(_encroach_cache_bytes, compresslevel=6)
            with open(en_path, "wb") as f:
                f.write(_encroach_gzip_bytes)
        _encroach_etag = _calc_etag(_encroach_gzip_bytes) if _encroach_gzip_bytes else None
        results["encroachments"] = {"bytes": len(_encroach_gzip_bytes) if _encroach_gzip_bytes else 0, "status": "saved"}
    except Exception as e:
        results["encroachments"] = {"error": str(e)}

    return results


# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------
def is_supabase_pg_enabled() -> bool:
    return bool(SUPABASE_DB_URL)

def is_supabase_cloud_enabled() -> bool:
    return bool(SUPABASE_URL and SUPABASE_KEY)

def get_pg_connection():
    import psycopg2
    from psycopg2.extras import RealDictCursor
    return psycopg2.connect(SUPABASE_DB_URL, cursor_factory=RealDictCursor)

def _supabase_request(
    path: str,
    method: str = "GET",
    data: Optional[bytes] = None,
    headers_extra: Optional[dict] = None
) -> Any:
    url = f"{SUPABASE_URL}/rest/v1/{path.lstrip('/')}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }
    if headers_extra:
        headers.update(headers_extra)
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    return urllib.request.urlopen(req, timeout=5)


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------
def get_stats() -> Dict[str, Any]:
    if is_supabase_pg_enabled():
        try:
            with get_pg_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT COUNT(*) FROM cs_plots;")
                    cs_count = cur.fetchone()["count"]
                    return {
                        "cs_plots_count": cs_count,
                        "rs_plots_count": 0,
                        "total_parcels": cs_count,
                        "backend": "Supabase PostgreSQL (Direct)",
                        "status": "Active" if cs_count > 0 else "Ready",
                        "linked_key": "uid"
                    }
        except Exception as e:
            print(f"Supabase PG stats error ({e}), trying Cloud API...")

    if is_supabase_cloud_enabled():
        try:
            resp = _supabase_request(
                "cs_plots?select=id",
                method="HEAD",
                headers_extra={"Range": "0-0", "Prefer": "count=exact"}
            )
            cr = resp.headers.get("Content-Range")
            cs_count = int(cr.split("/")[-1]) if cr else 0
            return {
                "cs_plots_count": cs_count,
                "rs_plots_count": 0,
                "total_parcels": cs_count,
                "backend": "Supabase Cloud (PostgreSQL)",
                "status": "Active" if cs_count > 0 else "Ready",
                "linked_key": "uid"
            }
        except Exception as e:
            print(f"Supabase Cloud API stats error: {e}")

    return {"cs_plots_count": 0, "rs_plots_count": 0, "total_parcels": 0,
            "backend": "Unavailable", "status": "Error", "linked_key": "uid"}


def get_mouza_boundaries() -> Dict[str, Any]:
    return {"type": "FeatureCollection", "features": []}


# ---------------------------------------------------------------------------
# GeoJSON assembly (shared by CS plots and encroachments)
# ---------------------------------------------------------------------------
def _assemble_features_json(rows: List[Dict[str, Any]]) -> bytes:
    if not rows:
        return b'{"type":"FeatureCollection","count":0,"bounds":null,"features":[]}'

    minx_agg, miny_agg, maxx_agg, maxy_agg = 180.0, 90.0, -180.0, -90.0
    feat_strs = []

    for r in rows:
        rx1, rx2, ry1, ry2 = r["minx"], r["maxx"], r["miny"], r["maxy"]
        if rx1 < minx_agg: minx_agg = rx1
        if ry1 < miny_agg: miny_agg = ry1
        if rx2 > maxx_agg: maxx_agg = rx2
        if ry2 > maxy_agg: maxy_agg = ry2

        pid    = r["id"]
        uid_str = str(r["uid"]) if r.get("uid") is not None else ""
        eff_beat = BEAT_NAME_OVERRIDES.get(uid_str, r.get("beat_name") or "")
        uid_val = json.dumps(uid_str)
        pno    = json.dumps(r["plot_no"] or "")
        mouza  = json.dumps(r["mouza"] or "")
        jl     = json.dumps(r["jl_no"] or "")
        beat   = json.dumps(eff_beat)
        area   = str(r["area_acre"] or 0)
        llat   = str(r["label_lat"] or 0)
        llng   = str(r["label_lng"] or 0)
        lrad   = str(r["label_radius"] or 0)
        geom   = r["geojson"]
        geom_str = json.dumps(geom) if isinstance(geom, dict) else str(geom)

        feat_strs.append(
            f'{{"type":"Feature","id":{pid},'
            f'"bbox":[{round(rx1,6)},{round(ry1,6)},{round(rx2,6)},{round(ry2,6)}],'
            f'"properties":{{"id":{pid},"uid":{uid_val},"plot_no":{pno},"mouza":{mouza},"jl_no":{jl},"beat_name":{beat},'
            f'"area_acre":{area},"label_lat":{llat},"label_lng":{llng},"label_radius":{lrad}}},'
            f'"geometry":{geom_str}}}'
        )

    bounds_str = f'[{round(minx_agg,5)},{round(miny_agg,5)},{round(maxx_agg,5)},{round(maxy_agg,5)}]'
    full_json  = f'{{"type":"FeatureCollection","count":{len(feat_strs)},"bounds":{bounds_str},"features":[{",".join(feat_strs)}]}}'
    return full_json.encode("utf-8")


def get_cs_plots_gzip_and_etag() -> Tuple[bytes, str]:
    global _cs_gzip_bytes, _cs_etag
    if _cs_gzip_bytes is not None and _cs_etag is not None:
        return _cs_gzip_bytes, _cs_etag
    raw = get_cs_plots_json_bytes()
    _cs_gzip_bytes = gzip.compress(raw, compresslevel=6)
    _cs_etag = _calc_etag(_cs_gzip_bytes)
    return _cs_gzip_bytes, _cs_etag

def get_bulk_dossier_gzip_and_etag() -> Tuple[bytes, str]:
    global _bulk_dossier_gzip_bytes, _bulk_dossier_etag
    if _bulk_dossier_gzip_bytes is not None and _bulk_dossier_etag is not None:
        return _bulk_dossier_gzip_bytes, _bulk_dossier_etag
    raw = get_bulk_dossier_json_bytes()
    _bulk_dossier_gzip_bytes = gzip.compress(raw, compresslevel=6)
    _bulk_dossier_etag = _calc_etag(_bulk_dossier_gzip_bytes)
    return _bulk_dossier_gzip_bytes, _bulk_dossier_etag

def get_encroachment_gzip_and_etag() -> Tuple[bytes, str]:
    global _encroach_gzip_bytes, _encroach_etag
    if _encroach_gzip_bytes is not None and _encroach_etag is not None:
        return _encroach_gzip_bytes, _encroach_etag
    raw = get_encroachment_geojson_bytes()
    _encroach_gzip_bytes = gzip.compress(raw, compresslevel=6)
    _encroach_etag = _calc_etag(_encroach_gzip_bytes)
    return _encroach_gzip_bytes, _encroach_etag


# ---------------------------------------------------------------------------
# CS Plots — main spatial dataset
# ---------------------------------------------------------------------------
def get_cs_plots_json_bytes(
    bbox: Optional[str] = None,
    plot_no: Optional[str] = None,
    uid: Optional[str] = None,
    limit: int = 35000
) -> bytes:
    global _cs_cache_bytes
    is_unfiltered = not bbox and not plot_no and not uid
    if is_unfiltered and _cs_cache_bytes is not None:
        return _cs_cache_bytes

    if is_supabase_pg_enabled():
        try:
            return _get_cs_plots_supabase_pg(bbox, plot_no, uid, limit, is_unfiltered)
        except Exception as e:
            print(f"Supabase direct PG error ({e}), trying Cloud API...")

    if is_supabase_cloud_enabled():
        try:
            return _get_cs_plots_supabase_api(bbox, plot_no, uid, limit, is_unfiltered)
        except Exception as e:
            print(f"Supabase Cloud API error ({e})")
            raise RuntimeError("Supabase unavailable — no fallback configured") from e

    raise RuntimeError("No Supabase connection configured")


def _get_cs_plots_supabase_api(bbox, plot_no, uid, limit, is_unfiltered) -> bytes:
    global _cs_cache_bytes

    _FIELDS = "id,uid,plot_no,mouza,jl_no,area_acre,beat_name,label_lat,label_lng,label_radius,minx,maxx,miny,maxy,geojson"

    if plot_no or uid:
        q = f"plot_no=eq.{urllib.parse.quote(str(plot_no))}" if plot_no else f"uid=eq.{urllib.parse.quote(str(uid))}"
        resp = _supabase_request(f"cs_plots?{q}&select={_FIELDS}")
        rows = json.loads(resp.read().decode("utf-8"))
        return _assemble_features_json(rows)

    if bbox:
        try:
            minx, miny, maxx, maxy = map(float, bbox.split(","))
            url_path = (f"cs_plots?minx=lte.{maxx}&maxx=gte.{minx}&miny=lte.{maxy}&maxy=gte.{miny}"
                        f"&select={_FIELDS}&limit={limit}")
            resp = _supabase_request(url_path)
            rows = json.loads(resp.read().decode("utf-8"))
            return _assemble_features_json(rows)
        except Exception:
            pass

    # Full unfiltered dataset: fetch in concurrent chunks
    def fetch_chunk(start, end):
        r = _supabase_request(
            f"cs_plots?select={_FIELDS}&order=id",
            headers_extra={"Range": f"{start}-{end}"}
        )
        return json.loads(r.read().decode("utf-8"))

    chunks = [(i, i + 999) for i in range(0, 12000, 1000)]
    all_rows: List[Dict] = []
    with ThreadPoolExecutor(max_workers=6) as ex:
        for chunk_rows in ex.map(lambda c: fetch_chunk(c[0], c[1]), chunks):
            all_rows.extend(chunk_rows)

    result_bytes = _assemble_features_json(all_rows)
    if is_unfiltered:
        _cs_cache_bytes = result_bytes
    return result_bytes


def _get_cs_plots_supabase_pg(bbox, plot_no, uid, limit, is_unfiltered) -> bytes:
    global _cs_cache_bytes
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            clauses: List[str] = []
            params:  List[Any] = []

            if bbox:
                try:
                    minx, miny, maxx, maxy = map(float, bbox.split(","))
                    clauses.append("minx <= %s AND maxx >= %s AND miny <= %s AND maxy >= %s")
                    params.extend([maxx, minx, maxy, miny])
                except ValueError:
                    pass

            if plot_no:
                clauses.append("plot_no = %s")
                params.append(plot_no)

            if uid:
                clauses.append("uid = %s")
                params.append(uid)

            where_sql = ("WHERE " + " AND ".join(clauses)) if clauses else ""
            query = f"""
            SELECT id, uid, plot_no, mouza, jl_no, area_acre, beat_name,
                   label_lat, label_lng, label_radius,
                   minx, maxx, miny, maxy, geojson::text
            FROM cs_plots
            {where_sql}
            ORDER BY id
            LIMIT {max(1, min(limit, 50000))}
            """
            cur.execute(query, params)
            rows = cur.fetchall()

    result_bytes = _assemble_features_json(rows)
    if is_unfiltered:
        _cs_cache_bytes = result_bytes
    return result_bytes


def get_rs_plots_json_bytes(
    bbox: Optional[str] = None,
    plot_no: Optional[str] = None,
    uid: Optional[str] = None,
    limit: int = 35000
) -> bytes:
    return b'{"type":"FeatureCollection","count":0,"bounds":null,"features":[]}'


# ---------------------------------------------------------------------------
# Dossier (single plot detail)
# ---------------------------------------------------------------------------
def _build_parcel_dossier_payload(
    plot: Dict[str, Any],
    parcel_records: List[Dict[str, Any]],
    encroachment_records: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    bounds     = [plot["minx"], plot["miny"], plot["maxx"], plot["maxy"]]
    plot_uid   = str(plot.get("uid") or "")
    beat_name  = BEAT_NAME_OVERRIDES.get(plot_uid, plot.get("beat_name"))

    encroach_list = []
    if encroachment_records:
        for er in encroachment_records:
            encroach_list.append({
                "encroacher_name":      er.get("encroacher_name"),
                "cs_plot_no":           er.get("cs_plot_no"),
                "rs_plot_no":           er.get("rs_plot_no"),
                "rs_khatian":           er.get("rs_khatian"),
                "sec_20":               er.get("sec_20"),
                "sec_6":                er.get("sec_6"),
                "encroached_area_acre": er.get("encroached_area_acre"),
                "structure_type":       er.get("structure_type"),
                "action_taken":         er.get("action_taken")
            })

    has_encroachment     = len(encroach_list) > 0
    total_encroached_acre = round(
        sum(float(r["encroached_area_acre"]) for r in encroach_list if r.get("encroached_area_acre") is not None),
        4
    ) if has_encroachment else 0.0

    encroachment_payload = {
        "has_encroachment":     has_encroachment,
        "count":                len(encroach_list),
        "total_encroached_acre": total_encroached_acre,
        "records":              encroach_list
    }

    if not parcel_records:
        return {
            "plot": {
                "id": plot["id"], "uid": plot_uid, "plot_no": plot["plot_no"],
                "mouza": plot["mouza"] or "N/A", "jl_no": plot["jl_no"] or "N/A",
                "area_acre": plot["area_acre"], "beat_name": beat_name or None,
                "type": "CS Cadastral Survey"
            },
            "bounds": bounds,
            "parcel_info": {
                "has_record": False, "cs_uid": plot_uid, "cs_plot_no": plot["plot_no"],
                "mouza": plot["mouza"], "cs_jl": plot["jl_no"], "beat_name": beat_name,
                "range": None, "total_area": plot["area_acre"],
                "total_area_fd": None, "total_area_others": None, "linked_rs_plots": []
            },
            "encroachment": encroachment_payload
        }

    first_rec       = parcel_records[0]
    effective_beat  = BEAT_NAME_OVERRIDES.get(plot_uid, first_rec.get("beat_name") or beat_name)
    range_val       = first_rec.get("range")
    cs_plot_no      = first_rec.get("cs_plot_no") or plot["plot_no"]
    mouza           = first_rec.get("mouza") or plot["mouza"] or "N/A"
    cs_jl           = first_rec.get("cs_jl")  or plot["jl_no"] or "N/A"
    cs_land_acre    = next((r["cs_land_acre"] for r in parcel_records if r.get("cs_land_acre") is not None), None)

    legal_statuses  = list(dict.fromkeys(r.get("legal_status") for r in parcel_records if r.get("legal_status")))
    khatians        = list(dict.fromkeys(r.get("khatian_no")   for r in parcel_records if r.get("khatian_no")))
    remarks_list    = list(dict.fromkeys(r.get("remarks")       for r in parcel_records if r.get("remarks")))

    fd_areas        = [r["area_fd"]     for r in parcel_records if r.get("area_fd")     is not None]
    others_areas    = [r["area_others"] for r in parcel_records if r.get("area_others") is not None]
    total_area_fd   = round(sum(fd_areas),     4) if fd_areas     else None
    total_area_others = round(sum(others_areas), 4) if others_areas else None

    rs_total_areas  = [r["total_area"] for r in parcel_records if r.get("total_area") is not None]
    if cs_land_acre is not None:
        recorded_total_area = cs_land_acre
    elif rs_total_areas:
        recorded_total_area = round(sum(rs_total_areas), 4)
    elif total_area_fd is not None or total_area_others is not None:
        recorded_total_area = round((total_area_fd or 0) + (total_area_others or 0), 4)
    else:
        recorded_total_area = plot.get("area_acre")

    linked_rs = []
    for r in parcel_records:
        if r.get("rs_plot_no"):
            linked_rs.append({
                "rs_plot_no": r.get("rs_plot_no"), "rs_jl": r.get("rs_jl"),
                "legal_status": r.get("legal_status"), "khatian_no": r.get("khatian_no"),
                "area_fd": r.get("area_fd"), "area_others": r.get("area_others"),
                "total_area": r.get("total_area"), "remarks": r.get("remarks")
            })

    return {
        "plot": {
            "id": plot["id"], "uid": plot_uid, "plot_no": plot["plot_no"],
            "mouza": plot["mouza"] or "N/A", "jl_no": plot["jl_no"] or "N/A",
            "area_acre": plot["area_acre"], "beat_name": effective_beat,
            "type": "CS Cadastral Survey"
        },
        "bounds": bounds,
        "parcel_info": {
            "has_record": True, "cs_uid": first_rec.get("cs_uid") or plot_uid,
            "cs_plot_no": cs_plot_no, "mouza": mouza, "cs_jl": cs_jl,
            "beat_name": effective_beat, "range": range_val, "cs_land_acre": recorded_total_area,
            "total_area": recorded_total_area, "total_area_fd": total_area_fd,
            "total_area_others": total_area_others,
            "legal_status": ", ".join(legal_statuses) if legal_statuses else None,
            "khatian_no":   ", ".join(khatians)       if khatians       else None,
            "remarks":      "; ".join(remarks_list)   if remarks_list   else None,
            "linked_rs_plots": linked_rs
        },
        "encroachment": encroachment_payload
    }


def get_cs_plot_dossier(plot_id: int) -> Optional[Dict[str, Any]]:
    if is_supabase_pg_enabled():
        try:
            # Step 1: fetch the plot row (need uid before we can query related tables)
            with get_pg_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                    SELECT id, uid, plot_no, mouza, jl_no, area_acre, beat_name, minx, miny, maxx, maxy
                    FROM cs_plots WHERE id = %s
                    """, (plot_id,))
                    plot = cur.fetchone()
            if not plot:
                return None

            uid = plot.get("uid")
            parcel_records: List[Dict] = []
            encroachment_records: List[Dict] = []

            if uid:
                # Step 2: parcel_info + encroachment_info run in PARALLEL (each needs its own connection)
                def _fetch_parcel(u):
                    with get_pg_connection() as c:
                        with c.cursor() as cur:
                            cur.execute("""
                            SELECT cs_uid, rs_uid, range, beat_name, mouza, cs_jl, rs_jl,
                                   cs_plot_no, rs_plot_no, cs_land_acre, total_area,
                                   area_fd, area_others, khatian_no, legal_status, remarks
                            FROM parcel_info WHERE cs_uid = %s ORDER BY id
                            """, (u,))
                            return [dict(r) for r in cur.fetchall()]

                def _fetch_encroach(u):
                    with get_pg_connection() as c:
                        with c.cursor() as cur:
                            cur.execute("""
                            SELECT uid, district, upazila, range, beat_name, mouza,
                                   encroacher_name, cs_plot_no, rs_plot_no, rs_khatian,
                                   sec_20, sec_6, encroached_area_acre, structure_type, action_taken
                            FROM encroachment_info WHERE uid = %s ORDER BY id
                            """, (str(u),))
                            return [dict(r) for r in cur.fetchall()]

                with ThreadPoolExecutor(max_workers=2) as ex:
                    fut_parcel   = ex.submit(_fetch_parcel,   uid)
                    fut_encroach = ex.submit(_fetch_encroach, uid)
                    parcel_records       = fut_parcel.result()
                    encroachment_records = fut_encroach.result()

            return _build_parcel_dossier_payload(plot, parcel_records, encroachment_records)
        except Exception as e:
            print(f"Supabase PG dossier error ({e}), trying Cloud API...")

    if is_supabase_cloud_enabled():
        try:
            # Step 1: fetch the plot row
            resp = _supabase_request(
                f"cs_plots?id=eq.{plot_id}&select=id,uid,plot_no,mouza,jl_no,area_acre,beat_name,minx,miny,maxx,maxy"
            )
            rows = json.loads(resp.read().decode("utf-8"))
            if not rows:
                return None
            plot = rows[0]
            parcel_records: List[Dict] = []
            encroachment_records: List[Dict] = []

            if plot.get("uid"):
                uid_enc = urllib.parse.quote(str(plot["uid"]))

                # Step 2: parcel_info + encroachment_info run in PARALLEL via HTTP
                def _fetch_parcel_api():
                    r = _supabase_request(f"parcel_info?cs_uid=eq.{uid_enc}&select=*&order=id")
                    return json.loads(r.read().decode("utf-8"))

                def _fetch_encroach_api():
                    try:
                        r = _supabase_request(f"encroachment_info?uid=eq.{uid_enc}&select=*&order=id")
                        return json.loads(r.read().decode("utf-8"))
                    except Exception as ee:
                        print(f"Encroachment fetch error: {ee}")
                        return []

                with ThreadPoolExecutor(max_workers=2) as ex:
                    fut_parcel   = ex.submit(_fetch_parcel_api)
                    fut_encroach = ex.submit(_fetch_encroach_api)
                    parcel_records       = fut_parcel.result()
                    encroachment_records = fut_encroach.result()

            return _build_parcel_dossier_payload(plot, parcel_records, encroachment_records)
        except Exception as e:
            print(f"Supabase Cloud API dossier error: {e}")

    return None


def get_plot_dossier(plot_id: int) -> Optional[Dict[str, Any]]:
    return get_cs_plot_dossier(plot_id)


# ---------------------------------------------------------------------------
# Bulk Dossier — all parcel_info + encroachment_info in one payload
# Client stores this in IndexedDB; assembly happens entirely client-side.
# ---------------------------------------------------------------------------
def _build_bulk_payload(parcel_rows: List[Dict], encroach_rows: List[Dict]) -> bytes:
    global _bulk_dossier_cache_bytes

    # Group parcel_info rows by cs_uid
    parcel_by_uid: Dict[str, List[Dict]] = {}
    for r in parcel_rows:
        uid = str(r.get("cs_uid") or "")
        if uid:
            parcel_by_uid.setdefault(uid, []).append(r)

    # Group encroachment rows by uid
    encroach_by_uid: Dict[str, List[Dict]] = {}
    for r in encroach_rows:
        uid = str(r.get("uid") or "")
        if uid:
            encroach_by_uid.setdefault(uid, []).append(r)

    # Collect all uids from both tables
    all_uids = set(parcel_by_uid.keys()) | set(encroach_by_uid.keys())

    by_uid: Dict[str, Any] = {}
    for uid in all_uids:
        precs = parcel_by_uid.get(uid, [])
        erecs = encroach_by_uid.get(uid, [])

        # Build encroachment payload
        enc_list = []
        for er in erecs:
            enc_list.append({
                "encroacher_name":      er.get("encroacher_name"),
                "cs_plot_no":           er.get("cs_plot_no"),
                "rs_plot_no":           er.get("rs_plot_no"),
                "rs_khatian":           er.get("rs_khatian"),
                "sec_20":               er.get("sec_20"),
                "sec_6":                er.get("sec_6"),
                "encroached_area_acre": er.get("encroached_area_acre"),
                "structure_type":       er.get("structure_type"),
                "action_taken":         er.get("action_taken"),
            })
        total_enc = round(
            sum(float(e["encroached_area_acre"]) for e in enc_list if e.get("encroached_area_acre") is not None), 4
        ) if enc_list else 0.0
        encroachment = {
            "has_encroachment":      bool(enc_list),
            "count":                 len(enc_list),
            "total_encroached_acre": total_enc,
            "records":               enc_list,
        }

        if not precs:
            by_uid[uid] = {"has_record": False, "encroachment": encroachment}
            continue

        first          = precs[0]
        fd_areas       = [r["area_fd"]     for r in precs if r.get("area_fd")     is not None]
        others_areas   = [r["area_others"] for r in precs if r.get("area_others") is not None]
        total_area_fd  = round(sum(fd_areas),     4) if fd_areas     else None
        total_area_oth = round(sum(others_areas), 4) if others_areas else None
        cs_land_acre   = next((r["cs_land_acre"] for r in precs if r.get("cs_land_acre") is not None), None)
        rs_totals      = [r["total_area"] for r in precs if r.get("total_area") is not None]
        if cs_land_acre is not None:
            recorded_total = cs_land_acre
        elif rs_totals:
            recorded_total = round(sum(rs_totals), 4)
        elif total_area_fd is not None or total_area_oth is not None:
            recorded_total = round((total_area_fd or 0) + (total_area_oth or 0), 4)
        else:
            recorded_total = None

        legal_statuses = list(dict.fromkeys(r.get("legal_status") for r in precs if r.get("legal_status")))
        khatians       = list(dict.fromkeys(r.get("khatian_no")   for r in precs if r.get("khatian_no")))
        remarks_list   = list(dict.fromkeys(r.get("remarks")       for r in precs if r.get("remarks")))

        linked_rs = []
        for r in precs:
            if r.get("rs_plot_no"):
                linked_rs.append({
                    "rs_plot_no":  r.get("rs_plot_no"),  "rs_jl":      r.get("rs_jl"),
                    "legal_status": r.get("legal_status"), "khatian_no": r.get("khatian_no"),
                    "area_fd":     r.get("area_fd"),      "area_others": r.get("area_others"),
                    "total_area":  r.get("total_area"),   "remarks":     r.get("remarks"),
                })

        by_uid[uid] = {
            "has_record":       True,
            "cs_plot_no":       first.get("cs_plot_no"),
            "mouza":            first.get("mouza"),
            "cs_jl":            first.get("cs_jl"),
            "beat_name":        BEAT_NAME_OVERRIDES.get(uid, first.get("beat_name")),
            "range":            first.get("range"),
            "total_area":       recorded_total,
            "total_area_fd":    total_area_fd,
            "total_area_others": total_area_oth,
            "legal_status":     ", ".join(legal_statuses) if legal_statuses else None,
            "khatian_no":       ", ".join(khatians)       if khatians       else None,
            "remarks":          "; ".join(remarks_list)   if remarks_list   else None,
            "linked_rs_plots":  linked_rs,
            "encroachment":     encroachment,
        }

    payload = json.dumps({"generated_at": int(time.time()), "by_uid": by_uid},
                         separators=(",", ":")).encode("utf-8")
    _bulk_dossier_cache_bytes = payload
    return payload


def get_bulk_dossier_json_bytes() -> bytes:
    global _bulk_dossier_cache_bytes
    if _bulk_dossier_cache_bytes:
        return _bulk_dossier_cache_bytes

    PARCEL_COLS   = "cs_uid,rs_uid,range,beat_name,mouza,cs_jl,rs_jl,cs_plot_no,rs_plot_no,cs_land_acre,total_area,area_fd,area_others,khatian_no,legal_status,remarks"
    ENCROACH_COLS = "uid,encroacher_name,cs_plot_no,rs_plot_no,rs_khatian,sec_20,sec_6,encroached_area_acre,structure_type,action_taken"

    if is_supabase_pg_enabled():
        try:
            def _fetch_parcel_pg():
                with get_pg_connection() as c:
                    with c.cursor() as cur:
                        cur.execute(f"SELECT {PARCEL_COLS} FROM parcel_info ORDER BY cs_uid, id")
                        return [dict(r) for r in cur.fetchall()]

            def _fetch_encroach_pg():
                with get_pg_connection() as c:
                    with c.cursor() as cur:
                        cur.execute(f"SELECT {ENCROACH_COLS} FROM encroachment_info ORDER BY uid, id")
                        return [dict(r) for r in cur.fetchall()]

            with ThreadPoolExecutor(max_workers=2) as ex:
                fut_p = ex.submit(_fetch_parcel_pg)
                fut_e = ex.submit(_fetch_encroach_pg)
                parcel_rows   = fut_p.result()
                encroach_rows = fut_e.result()

            return _build_bulk_payload(parcel_rows, encroach_rows)
        except Exception as e:
            print(f"Bulk dossier PG error ({e}), trying Cloud API...")

    if is_supabase_cloud_enabled():
        try:
            def _fetch_parcel_chunk(start, end):
                r = _supabase_request(
                    f"parcel_info?select={PARCEL_COLS}&order=cs_uid,id",
                    headers_extra={"Range": f"{start}-{end}"}
                )
                return json.loads(r.read().decode("utf-8"))

            def _fetch_encroach_api():
                r = _supabase_request(
                    f"encroachment_info?select={ENCROACH_COLS}&order=uid,id&limit=1000"
                )
                return json.loads(r.read().decode("utf-8"))

            # parcel_info has 3,458 rows — fetch 4 parallel chunks so no records are missed
            chunks = [(0, 999), (1000, 1999), (2000, 2999), (3000, 3999)]
            parcel_rows: List[Dict] = []
            encroach_rows: List[Dict] = []

            with ThreadPoolExecutor(max_workers=5) as ex:
                fut_encroach = ex.submit(_fetch_encroach_api)
                fut_parcels  = [ex.submit(_fetch_parcel_chunk, c[0], c[1]) for c in chunks]

                encroach_rows = fut_encroach.result()
                for fut in fut_parcels:
                    parcel_rows.extend(fut.result())

            return _build_bulk_payload(parcel_rows, encroach_rows)
        except Exception as e:
            print(f"Bulk dossier Cloud API error: {e}")

    bulk_path = os.path.join(CACHE_DIR, "bulk_dossier.json.gz")
    if os.path.exists(bulk_path):
        try:
            with open(bulk_path, "rb") as f:
                return gzip.decompress(f.read())
        except Exception:
            pass

    return json.dumps({"generated_at": int(time.time()), "by_uid": {}},
                      separators=(",", ":")).encode("utf-8")


def get_encroachment_summary() -> Dict[str, Any]:
    if is_supabase_pg_enabled():
        try:
            with get_pg_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                    SELECT COUNT(DISTINCT uid) AS uids, COUNT(*) AS total,
                           ROUND(SUM(COALESCE(encroached_area_acre, 0))::numeric, 2) AS acres
                    FROM encroachment_info
                    """)
                    r = cur.fetchone()
                    return {
                        "total_parcels":        r["uids"]  or 0,
                        "total_cases":          r["total"] or 0,
                        "total_encroached_acre": float(r["acres"] or 0),
                        "status": "Active"
                    }
        except Exception as e:
            print(f"Supabase PG encroachment summary error ({e}), trying Cloud API...")

    if is_supabase_cloud_enabled():
        try:
            resp = _supabase_request("encroachment_info?select=uid,encroached_area_acre")
            rows = json.loads(resp.read().decode("utf-8"))
            uids        = set(str(r["uid"]) for r in rows if r.get("uid"))
            total_cases = len(rows)
            total_acre  = round(sum(float(r["encroached_area_acre"]) for r in rows if r.get("encroached_area_acre")), 2)
            return {
                "total_parcels": len(uids), "total_cases": total_cases,
                "total_encroached_acre": total_acre, "status": "Active"
            }
        except Exception as e:
            print(f"Supabase Cloud encroachment summary error: {e}")

    return {"total_parcels": 0, "total_cases": 0, "total_encroached_acre": 0.0, "status": "Unavailable"}


def get_encroachment_geojson_bytes() -> bytes:
    global _encroach_cache_bytes
    if _encroach_cache_bytes is not None:
        return _encroach_cache_bytes

    # --- Step 1: collect encroachment aggregation per uid ---
    encroach_agg: Dict[str, Any] = {}
    all_encroach_rows: List[Dict] = []

    if is_supabase_pg_enabled():
        try:
            with get_pg_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT uid, encroacher_name, encroached_area_acre, structure_type, action_taken "
                        "FROM encroachment_info ORDER BY id"
                    )
                    all_encroach_rows = [dict(r) for r in cur.fetchall()]
        except Exception as e:
            print(f"Supabase PG encroachment rows error ({e}), trying Cloud API...")

    if not all_encroach_rows and is_supabase_cloud_enabled():
        try:
            resp = _supabase_request(
                "encroachment_info?select=uid,encroacher_name,encroached_area_acre,structure_type,action_taken&order=id"
            )
            all_encroach_rows = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print(f"Supabase Cloud encroachment fetch error: {e}")

    for r in all_encroach_rows:
        u = str(r["uid"])
        if u not in encroach_agg:
            encroach_agg[u] = {"count": 0, "total_acre": 0.0, "structures": set(), "actions": set()}
        encroach_agg[u]["count"] += 1
        if r.get("encroached_area_acre"):
            encroach_agg[u]["total_acre"] += float(r["encroached_area_acre"])
        if r.get("structure_type"):
            encroach_agg[u]["structures"].add(r["structure_type"].strip())
        if r.get("action_taken"):
            act = r["action_taken"].strip().replace("\n", " ")
            if len(act) > 40:
                act = act[:37] + "..."
            encroach_agg[u]["actions"].add(act)

    # --- Step 2: fetch encroached cs_plots polygons ---
    plot_rows: List[Dict] = []

    if is_supabase_pg_enabled():
        try:
            with get_pg_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                    SELECT id, uid, plot_no, mouza, jl_no, area_acre, beat_name,
                           label_lat, label_lng, label_radius, minx, maxx, miny, maxy, geojson::text
                    FROM cs_plots WHERE is_encroached = 1 ORDER BY id
                    """)
                    plot_rows = [dict(r) for r in cur.fetchall()]
        except Exception as e:
            print(f"Supabase PG encroached plots error ({e}), trying Cloud API...")

    if not plot_rows and is_supabase_cloud_enabled():
        try:
            resp = _supabase_request(
                "cs_plots?is_encroached=eq.1"
                "&select=id,uid,plot_no,mouza,jl_no,area_acre,beat_name,label_lat,label_lng,label_radius,minx,maxx,miny,maxy,geojson"
                "&order=id"
            )
            plot_rows = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print(f"Supabase Cloud encroached plots error: {e}")

    # --- Step 3: assemble GeoJSON ---
    feat_strs: List[str] = []
    minx_agg, miny_agg, maxx_agg, maxy_agg = 180.0, 90.0, -180.0, -90.0

    for r in plot_rows:
        rx1, rx2, ry1, ry2 = float(r["minx"]), float(r["maxx"]), float(r["miny"]), float(r["maxy"])
        if rx1 < minx_agg: minx_agg = rx1
        if ry1 < miny_agg: miny_agg = ry1
        if rx2 > maxx_agg: maxx_agg = rx2
        if ry2 > maxy_agg: maxy_agg = ry2

        pid      = r["id"]
        uid_str  = str(r.get("uid") or "")
        agg_info = encroach_agg.get(uid_str, {"count": 0, "total_acre": 0.0, "structures": set(), "actions": set()})

        uid_val  = json.dumps(uid_str)
        pno      = json.dumps(r["plot_no"] or "")
        mouza    = json.dumps(r["mouza"] or "")
        jl       = json.dumps(r["jl_no"] or "")
        beat     = json.dumps(r.get("beat_name") or "")
        area     = str(r["area_acre"] or 0)
        llat     = str(r["label_lat"] or 0)
        llng     = str(r["label_lng"] or 0)
        lrad     = str(r.get("label_radius") or 0)
        cases_cnt = agg_info["count"]
        enc_acre = round(agg_info["total_acre"], 2)
        structs  = json.dumps(", ".join(sorted(agg_info["structures"])) if agg_info["structures"] else "ঘরবাড়ী")
        acts     = json.dumps("; ".join(sorted(agg_info["actions"]))   if agg_info["actions"]    else "উচ্ছেদ প্রস্তাব প্রেরণ")
        geom     = r["geojson"]
        geom_str = json.dumps(geom) if isinstance(geom, dict) else str(geom)

        feat_strs.append(
            f'{{"type":"Feature","id":{pid},'
            f'"properties":{{"id":{pid},"uid":{uid_val},"plot_no":{pno},"mouza":{mouza},"jl_no":{jl},"beat_name":{beat},'
            f'"area_acre":{area},"label_lat":{llat},"label_lng":{llng},"label_radius":{lrad},'
            f'"is_encroached":1,"encroached_cases_count":{cases_cnt},"encroached_area_acre":{enc_acre},'
            f'"structures":{structs},"actions":{acts}}},'
            f'"geometry":{geom_str}}}'
        )

    bounds_str = (f'[{round(minx_agg,5)},{round(miny_agg,5)},{round(maxx_agg,5)},{round(maxy_agg,5)}]'
                  if plot_rows else 'null')
    full_json  = f'{{"type":"FeatureCollection","count":{len(feat_strs)},"bounds":{bounds_str},"features":[{",".join(feat_strs)}]}}'
    _encroach_cache_bytes = full_json.encode("utf-8")
    return _encroach_cache_bytes


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------
def search_records(query: str, limit: int = 15) -> List[Dict[str, Any]]:
    raw_q = query.strip()
    if not raw_q:
        return []

    q = raw_q.lstrip("#").strip()
    for prefix in ["plot #", "plot ", "cs #", "cs ", "plot"]:
        if q.lower().startswith(prefix):
            q = q[len(prefix):].strip()
    if not q:
        q = raw_q

    if is_supabase_pg_enabled():
        try:
            conn = get_pg_connection()
            cur  = conn.cursor()
            cur.execute("""
            SELECT id, uid, plot_no, mouza, jl_no, area_acre, beat_name, minx, maxx, miny, maxy
            FROM cs_plots
            WHERE plot_no = %s OR plot_no LIKE %s OR uid = %s OR uid LIKE %s
               OR mouza ILIKE %s OR jl_no = %s
            ORDER BY
                (plot_no = %s) DESC,
                (uid = %s) DESC,
                (plot_no LIKE %s) DESC,
                (mouza ILIKE %s) DESC,
                id
            LIMIT %s
            """, (q, f"{q}%", q, f"{q}%", f"%{q}%", q,
                  q, q, f"{q}%", f"%{q}%", limit))
            rows = [dict(r) for r in cur.fetchall()]
            conn.close()
            return _format_search_results(rows)
        except Exception as e:
            print(f"Supabase direct PG search error ({e}), trying Cloud API...")

    if is_supabase_cloud_enabled():
        try:
            payload = json.dumps({"search_query": q, "limit_count": limit}).encode("utf-8")
            resp    = _supabase_request("rpc/search_plots", method="POST", data=payload)
            rows    = json.loads(resp.read().decode("utf-8"))
            return _format_search_results(rows)
        except Exception as e:
            print(f"Supabase Cloud API search error: {e}")

    return []


def _format_search_results(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    results = []
    for r in rows:
        center_lng = (r["minx"] + r["maxx"]) / 2
        center_lat = (r["miny"] + r["maxy"]) / 2
        mouza_str  = f"Mouza: {r['mouza']}" if r.get("mouza") else ""
        jl_str     = f"JL: {r['jl_no']}"   if r.get("jl_no") else ""
        subparts   = [p for p in [mouza_str, jl_str] if p]
        sublabel   = " | ".join(subparts) if subparts else "CS Cadastral Parcel"

        uid_val = str(r.get("uid") or "")
        if not uid_val and r.get("jl_no") and r.get("plot_no"):
            uid_val = f"{r.get('jl_no')}{r.get('plot_no')}"

        results.append({
            "type":     "cs_plot",
            "id":       r["id"],
            "uid":      uid_val,
            "label":    f"CS Plot #{r['plot_no']}",
            "sublabel": sublabel,
            "lat":      center_lat,
            "lng":      center_lng,
            "bounds":   [r["minx"], r["miny"], r["maxx"], r["maxy"]],
            "data": {
                "id": r["id"], "uid": uid_val, "plot_no": r["plot_no"],
                "mouza": r.get("mouza"), "jl_no": r.get("jl_no"), "area_acre": r.get("area_acre")
            }
        })
    return results


# ---------------------------------------------------------------------------
# CSV Export
# ---------------------------------------------------------------------------
def export_plots_to_csv() -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Survey", "Plot No", "Mouza", "JL No", "Area (Acre)", "Beat Name",
                     "MinX", "MinY", "MaxX", "MaxY"])

    if is_supabase_pg_enabled():
        try:
            with get_pg_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(r"""
                    SELECT 'CS' AS survey, plot_no, mouza, jl_no, area_acre, beat_name, minx, miny, maxx, maxy
                    FROM cs_plots
                    ORDER BY mouza, NULLIF(regexp_replace(plot_no, '\D', '', 'g'), '')::INTEGER, plot_no
                    """)
                    for r in cur.fetchall():
                        writer.writerow([r["survey"], r["plot_no"], r["mouza"], r["jl_no"],
                                         r["area_acre"], r["beat_name"],
                                         r["minx"], r["miny"], r["maxx"], r["maxy"]])
            return output.getvalue()
        except Exception as e:
            print(f"Supabase PG export error ({e}), trying Cloud API...")

    if is_supabase_cloud_enabled():
        try:
            def fetch_csv_chunk(start, end):
                r = _supabase_request(
                    "cs_plots?select=plot_no,mouza,jl_no,area_acre,beat_name,minx,miny,maxx,maxy&order=mouza,id",
                    headers_extra={"Range": f"{start}-{end}"}
                )
                return json.loads(r.read().decode("utf-8"))

            chunks   = [(i, i + 999) for i in range(0, 12000, 1000)]
            all_rows: List[Dict] = []
            with ThreadPoolExecutor(max_workers=6) as ex:
                for chunk_rows in ex.map(lambda c: fetch_csv_chunk(c[0], c[1]), chunks):
                    all_rows.extend(chunk_rows)

            for r in all_rows:
                writer.writerow(["CS", r["plot_no"], r.get("mouza"), r.get("jl_no"),
                                  r.get("area_acre"), r.get("beat_name"),
                                  r["minx"], r["miny"], r["maxx"], r["maxy"]])
            return output.getvalue()
        except Exception as e:
            print(f"Supabase Cloud API export error: {e}")

    return output.getvalue()
