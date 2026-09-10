"""
FD-LMS Database Access & Spatial Query Layer
Dual-mode:
- Connects to Supabase Cloud PostgreSQL (via Direct PG or Supabase Cloud API)
- Automatically falls back to local SQLite when running offline / locally
"""

import os
import re
import json
import sqlite3
import csv
import io
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from typing import Optional, List, Dict, Any
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, ".env"))

DB_PATH = os.path.join(BASE_DIR, "data", "fd_lms.db")
SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL", "").strip()
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://tbffjjlkmzswcmwdkulh.supabase.co").strip()
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiZmZqamxrbXpzd2Ntd2RrdWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwMTgwODMsImV4cCI6MjEwNDU5NDA4M30.8QTxmJNbuA91yfNyztrZqq4kvMniN0t9j6C6TaiQyYg").strip()

# In-memory cached JSON bytes for CS plots
_cs_cache_bytes: Optional[bytes] = None
_rs_cache_bytes: Optional[bytes] = None

def is_supabase_pg_enabled() -> bool:
    return bool(SUPABASE_DB_URL)

def is_supabase_cloud_enabled() -> bool:
    return bool(SUPABASE_URL and SUPABASE_KEY)

def is_supabase_enabled() -> bool:
    return is_supabase_pg_enabled() or is_supabase_cloud_enabled()

def get_pg_connection():
    import psycopg2
    from psycopg2.extras import RealDictCursor
    return psycopg2.connect(SUPABASE_DB_URL, cursor_factory=RealDictCursor)

def get_sqlite_connection():
    if not os.path.exists(DB_PATH):
        raise FileNotFoundError(f"Local SQLite database not found at {DB_PATH}.")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def _supabase_request(path: str, method: str = "GET", data: Optional[bytes] = None, headers_extra: Optional[dict] = None) -> Any:
    url = f"{SUPABASE_URL}/rest/v1/{path.lstrip('/')}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }
    if headers_extra:
        headers.update(headers_extra)
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    return urllib.request.urlopen(req, timeout=35)

def get_stats() -> Dict[str, Any]:
    if is_supabase_pg_enabled():
        try:
            with get_pg_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT COUNT(*) FROM cs_plots;")
                    cs_count = cur.fetchone()["count"]
                    cur.execute("SELECT COUNT(*) FROM rs_plots;")
                    rs_count = cur.fetchone()["count"]
                    return {
                        "cs_plots_count": cs_count,
                        "rs_plots_count": rs_count,
                        "total_parcels": cs_count + rs_count,
                        "backend": "Supabase PostgreSQL (Direct)",
                        "status": "Active" if (cs_count + rs_count) > 0 else "Ready",
                        "linked_key": "uid"
                    }
        except Exception as e:
            print(f"Supabase PG stats error ({e}), trying Cloud API...")

    if is_supabase_cloud_enabled():
        try:
            resp = _supabase_request("cs_plots?select=id", method="HEAD", headers_extra={"Range": "0-0", "Prefer": "count=exact"})
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
            print(f"Supabase Cloud API stats error ({e}), falling back to SQLite...")

    # Fallback to local SQLite if remote is unreachable
    with get_sqlite_connection() as conn:
        cur = conn.cursor()
        cs_count = cur.execute("SELECT COUNT(*) FROM cs_plots").fetchone()[0]
        rs_count = cur.execute("SELECT COUNT(*) FROM rs_plots").fetchone()[0]
        return {
            "cs_plots_count": cs_count,
            "rs_plots_count": rs_count,
            "total_parcels": cs_count + rs_count,
            "backend": "Local SQLite (Offline)",
            "status": "Active" if (cs_count + rs_count) > 0 else "Ready",
            "linked_key": "uid"
        }

def get_mouza_boundaries() -> Dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "features": []
    }

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

        pid = r["id"]
        uid_val = json.dumps(str(r["uid"]) if r.get("uid") is not None else "")
        pno = json.dumps(r["plot_no"] or "")
        mouza = json.dumps(r["mouza"] or "")
        jl = json.dumps(r["jl_no"] or "")
        beat = json.dumps(r.get("beat_name") or "")
        area = str(r["area_acre"] or 0)
        llat = str(r["label_lat"] or 0)
        llng = str(r["label_lng"] or 0)
        lrad = str(r["label_radius"] or 0)
        geom = r["geojson"]
        geom_str = json.dumps(geom) if isinstance(geom, dict) else str(geom)

        feat_strs.append(
            f'{{"type":"Feature","id":{pid},'
            f'"properties":{{"id":{pid},"uid":{uid_val},"plot_no":{pno},"mouza":{mouza},"jl_no":{jl},"beat_name":{beat},'
            f'"area_acre":{area},"label_lat":{llat},"label_lng":{llng},"label_radius":{lrad}}},'
            f'"geometry":{geom_str}}}'
        )

    bounds_str = f'[{round(minx_agg, 5)},{round(miny_agg, 5)},{round(maxx_agg, 5)},{round(maxy_agg, 5)}]'
    full_json = f'{{"type":"FeatureCollection","count":{len(feat_strs)},"bounds":{bounds_str},"features":[{",".join(feat_strs)}]}}'
    return full_json.encode("utf-8")

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
            print(f"Supabase Cloud API error ({e}), falling back to SQLite...")

    return _get_cs_plots_sqlite(bbox, plot_no, uid, limit, is_unfiltered)

def _get_cs_plots_supabase_api(bbox, plot_no, uid, limit, is_unfiltered) -> bytes:
    global _cs_cache_bytes

    if plot_no or uid:
        query_param = f"plot_no=eq.{urllib.parse.quote(plot_no)}" if plot_no else f"uid=eq.{urllib.parse.quote(uid)}"
        url_path = f"cs_plots?{query_param}&select=id,uid,plot_no,mouza,jl_no,area_acre,beat_name,label_lat,label_lng,label_radius,minx,maxx,miny,maxy,geojson"
        resp = _supabase_request(url_path)
        rows = json.loads(resp.read().decode("utf-8"))
        return _assemble_features_json(rows)

    if bbox:
        try:
            minx, miny, maxx, maxy = map(float, bbox.split(","))
            url_path = f"cs_plots?minx=lte.{maxx}&maxx=gte.{minx}&miny=lte.{maxy}&maxy=gte.{miny}&select=id,uid,plot_no,mouza,jl_no,area_acre,beat_name,label_lat,label_lng,label_radius,minx,maxx,miny,maxy,geojson&limit={limit}"
            resp = _supabase_request(url_path)
            rows = json.loads(resp.read().decode("utf-8"))
            return _assemble_features_json(rows)
        except Exception:
            pass

    # Full unfiltered dataset: fetch in concurrent chunks of 1000
    def fetch_chunk(start, end):
        r = _supabase_request(
            "cs_plots?select=id,uid,plot_no,mouza,jl_no,area_acre,beat_name,label_lat,label_lng,label_radius,minx,maxx,miny,maxy,geojson&order=id",
            headers_extra={"Range": f"{start}-{end}"}
        )
        return json.loads(r.read().decode("utf-8"))

    chunks = [(i, i + 999) for i in range(0, 12000, 1000)]
    all_rows = []
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
            clauses = []
            params = []

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

def _get_cs_plots_sqlite(bbox, plot_no, uid, limit, is_unfiltered) -> bytes:
    global _cs_cache_bytes
    with get_sqlite_connection() as conn:
        cur = conn.cursor()
        params = {}
        where_clauses = []

        if bbox:
            try:
                minx, miny, maxx, maxy = map(float, bbox.split(","))
                params.update({"minx": minx, "maxx": maxx, "miny": miny, "maxy": maxy})
                where_clauses.append("""
                p.id IN (
                    SELECT id FROM cs_plots_idx 
                    WHERE minx <= :maxx AND maxx >= :minx 
                      AND miny <= :maxy AND maxy >= :miny
                )
                """)
            except ValueError:
                pass

        if plot_no:
            where_clauses.append("p.plot_no = :plot_no")
            params["plot_no"] = plot_no

        if uid:
            where_clauses.append("p.uid = :uid")
            params["uid"] = uid

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        query = f"""
        SELECT p.id, p.uid, p.plot_no, p.mouza, p.jl_no, p.area_acre, p.beat_name,
               p.label_lat, p.label_lng, p.label_radius,
               p.minx, p.maxx, p.miny, p.maxy, p.geojson
        FROM cs_plots p
        {where_sql}
        ORDER BY p.id
        LIMIT {max(1, min(limit, 50000))}
        """

        cur.execute(query, params)
        rows = cur.fetchall()

        parsed_rows = []
        for r in rows:
            parsed_rows.append({
                "id": r[0], "uid": r[1], "plot_no": r[2], "mouza": r[3], "jl_no": r[4],
                "area_acre": r[5], "beat_name": r[6], "label_lat": r[7],
                "label_lng": r[8], "label_radius": r[9], "minx": r[10],
                "maxx": r[11], "miny": r[12], "maxy": r[13], "geojson": r[14]
            })

        result_bytes = _assemble_features_json(parsed_rows)
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

def _build_parcel_dossier_payload(plot: Dict[str, Any], parcel_records: List[Dict[str, Any]]) -> Dict[str, Any]:
    bounds = [plot["minx"], plot["miny"], plot["maxx"], plot["maxy"]]
    beat_name = plot.get("beat_name")
    plot_uid = str(plot.get("uid") or "")

    if not parcel_records:
        return {
            "plot": {
                "id": plot["id"],
                "uid": plot_uid,
                "plot_no": plot["plot_no"],
                "mouza": plot["mouza"] or "N/A",
                "jl_no": plot["jl_no"] or "N/A",
                "area_acre": plot["area_acre"],
                "beat_name": beat_name or None,
                "type": "CS Cadastral Survey"
            },
            "bounds": bounds,
            "parcel_info": {
                "has_record": False,
                "cs_uid": plot_uid,
                "cs_plot_no": plot["plot_no"],
                "mouza": plot["mouza"],
                "cs_jl": plot["jl_no"],
                "beat_name": beat_name,
                "range": None,
                "total_area": plot["area_acre"],
                "total_area_fd": None,
                "total_area_others": None,
                "linked_rs_plots": []
            }
        }

    first_rec = parcel_records[0]
    effective_beat = first_rec.get("beat_name") or beat_name
    range_val = first_rec.get("range")
    cs_plot_no = first_rec.get("cs_plot_no") or plot["plot_no"]
    mouza = first_rec.get("mouza") or plot["mouza"] or "N/A"
    cs_jl = first_rec.get("cs_jl") or plot["jl_no"] or "N/A"

    # Find recorded CS land acreage from Parcel Info db
    cs_land_acre = next((r["cs_land_acre"] for r in parcel_records if r.get("cs_land_acre") is not None), None)

    # Collect unique legal statuses, khatians, remarks
    legal_statuses = list(dict.fromkeys(r.get("legal_status") for r in parcel_records if r.get("legal_status")))
    khatians = list(dict.fromkeys(r.get("khatian_no") for r in parcel_records if r.get("khatian_no")))
    remarks_list = list(dict.fromkeys(r.get("remarks") for r in parcel_records if r.get("remarks")))

    # Aggregate areas from Parcel Info db
    fd_areas = [r["area_fd"] for r in parcel_records if r.get("area_fd") is not None]
    others_areas = [r["area_others"] for r in parcel_records if r.get("area_others") is not None]
    total_area_fd = round(sum(fd_areas), 4) if fd_areas else None
    total_area_others = round(sum(others_areas), 4) if others_areas else None

    # Total recorded area calculation
    rs_total_areas = [r["total_area"] for r in parcel_records if r.get("total_area") is not None]
    if cs_land_acre is not None:
        recorded_total_area = cs_land_acre
    elif rs_total_areas:
        recorded_total_area = round(sum(rs_total_areas), 4)
    elif total_area_fd is not None or total_area_others is not None:
        recorded_total_area = round((total_area_fd or 0) + (total_area_others or 0), 4)
    else:
        recorded_total_area = plot.get("area_acre")

    # Linked RS survey plots list
    linked_rs = []
    for r in parcel_records:
        if r.get("rs_plot_no"):
            linked_rs.append({
                "rs_plot_no": r.get("rs_plot_no"),
                "rs_jl": r.get("rs_jl"),
                "legal_status": r.get("legal_status"),
                "khatian_no": r.get("khatian_no"),
                "area_fd": r.get("area_fd"),
                "area_others": r.get("area_others"),
                "total_area": r.get("total_area"),
                "remarks": r.get("remarks")
            })

    return {
        "plot": {
            "id": plot["id"],
            "uid": plot_uid,
            "plot_no": plot["plot_no"],
            "mouza": plot["mouza"] or "N/A",
            "jl_no": plot["jl_no"] or "N/A",
            "area_acre": plot["area_acre"],
            "beat_name": effective_beat,
            "type": "CS Cadastral Survey"
        },
        "bounds": bounds,
        "parcel_info": {
            "has_record": True,
            "cs_uid": first_rec.get("cs_uid") or plot_uid,
            "cs_plot_no": cs_plot_no,
            "mouza": mouza,
            "cs_jl": cs_jl,
            "beat_name": effective_beat,
            "range": range_val,
            "cs_land_acre": recorded_total_area,
            "total_area": recorded_total_area,
            "total_area_fd": total_area_fd,
            "total_area_others": total_area_others,
            "legal_status": ", ".join(legal_statuses) if legal_statuses else None,
            "khatian_no": ", ".join(khatians) if khatians else None,
            "remarks": "; ".join(remarks_list) if remarks_list else None,
            "linked_rs_plots": linked_rs
        }
    }

def get_cs_plot_dossier(plot_id: int) -> Optional[Dict[str, Any]]:
    if is_supabase_pg_enabled():
        try:
            with get_pg_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                    SELECT id, uid, plot_no, mouza, jl_no, area_acre, beat_name, minx, miny, maxx, maxy
                    FROM cs_plots WHERE id = %s
                    """, (plot_id,))
                    plot = cur.fetchone()
                    if plot:
                        parcel_records = []
                        if plot.get("uid"):
                            cur.execute("""
                            SELECT cs_uid, rs_uid, range, beat_name, mouza, cs_jl, rs_jl,
                                   cs_plot_no, rs_plot_no, cs_land_acre, total_area,
                                   area_fd, area_others, khatian_no, legal_status, remarks
                            FROM parcel_info
                            WHERE cs_uid = %s
                            ORDER BY id
                            """, (plot["uid"],))
                            parcel_records = [dict(r) for r in cur.fetchall()]
                        return _build_parcel_dossier_payload(plot, parcel_records)
        except Exception as e:
            print(f"Supabase PG dossier error ({e}), trying Cloud API...")

    if is_supabase_cloud_enabled():
        try:
            resp = _supabase_request(f"cs_plots?id=eq.{plot_id}&select=id,uid,plot_no,mouza,jl_no,area_acre,beat_name,minx,miny,maxx,maxy")
            rows = json.loads(resp.read().decode("utf-8"))
            if rows:
                plot = rows[0]
                parcel_records = []
                if plot.get("uid"):
                    p_resp = _supabase_request(f"parcel_info?cs_uid=eq.{urllib.parse.quote(str(plot['uid']))}&select=*&order=id")
                    parcel_records = json.loads(p_resp.read().decode("utf-8"))
                return _build_parcel_dossier_payload(plot, parcel_records)
        except Exception as e:
            print(f"Supabase Cloud API dossier error ({e}), falling back to SQLite...")

    with get_sqlite_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
        SELECT id, uid, plot_no, mouza, jl_no, area_acre, beat_name, minx, miny, maxx, maxy
        FROM cs_plots WHERE id = ?
        """, (plot_id,))
        row = cur.fetchone()
        if not row:
            return None
        plot = dict(row)
        parcel_records = []
        if plot.get("uid"):
            cur.execute("""
            SELECT cs_uid, rs_uid, range, beat_name, mouza, cs_jl, rs_jl,
                   cs_plot_no, rs_plot_no, cs_land_acre, total_area,
                   area_fd, area_others, khatian_no, legal_status, remarks
            FROM parcel_info
            WHERE cs_uid = ?
            ORDER BY id
            """, (plot["uid"],))
            parcel_records = [dict(r) for r in cur.fetchall()]
        return _build_parcel_dossier_payload(plot, parcel_records)

def get_plot_dossier(plot_id: int) -> Optional[Dict[str, Any]]:
    return get_cs_plot_dossier(plot_id)

def search_records(query: str, limit: int = 15) -> List[Dict[str, Any]]:
    raw_q = query.strip()
    if not raw_q:
        return []

    # Clean query: strip leading '#', 'plot ', 'cs '
    q = raw_q.lstrip("#").strip()
    for prefix in ["plot #", "plot ", "cs #", "cs ", "plot"]:
        if q.lower().startswith(prefix):
            q = q[len(prefix):].strip()

    if not q:
        q = raw_q

    results = []

    # 1. Direct PG search
    if is_supabase_pg_enabled():
        try:
            conn = get_pg_connection()
            cur = conn.cursor()
            cur.execute("""
            SELECT id, uid, plot_no, mouza, jl_no, area_acre, beat_name, minx, maxx, miny, maxy
            FROM cs_plots 
            WHERE plot_no = %s OR plot_no LIKE %s OR uid = %s OR uid LIKE %s OR mouza ILIKE %s OR jl_no = %s
            ORDER BY 
                (plot_no = %s) DESC,
                (uid = %s) DESC,
                (plot_no LIKE %s) DESC,
                (mouza ILIKE %s) DESC,
                id
            LIMIT %s
            """, (q, f"{q}%", q, f"{q}%", f"%{q}%", q, q, q, f"{q}%", f"%{q}%", limit))
            rows = [dict(r) for r in cur.fetchall()]
            conn.close()
            return _format_search_results(rows)
        except Exception as e:
            print(f"Supabase direct PG search error ({e}), trying Cloud API...")

    # 2. Supabase Cloud API search via search_plots RPC
    if is_supabase_cloud_enabled():
        try:
            payload = json.dumps({"search_query": q, "limit_count": limit}).encode("utf-8")
            resp = _supabase_request("rpc/search_plots", method="POST", data=payload)
            rows = json.loads(resp.read().decode("utf-8"))
            return _format_search_results(rows)
        except Exception as e:
            print(f"Supabase Cloud API search error ({e}), falling back to SQLite...")

    # 3. Fallback SQLite search
    with get_sqlite_connection() as conn:
        cur = conn.cursor()
        cur.execute("""
        SELECT id, uid, plot_no, mouza, jl_no, area_acre, beat_name, minx, maxx, miny, maxy
        FROM cs_plots 
        WHERE plot_no = ? OR plot_no LIKE ? OR uid = ? OR uid LIKE ? OR mouza LIKE ? OR jl_no = ?
        ORDER BY 
            (plot_no = ?) DESC,
            (uid = ?) DESC,
            (plot_no LIKE ?) DESC,
            (mouza LIKE ?) DESC,
            id
        LIMIT ?
        """, (q, f"{q}%", q, f"{q}%", f"%{q}%", q, q, q, f"{q}%", f"%{q}%", limit))
        rows = [dict(r) for r in cur.fetchall()]
        return _format_search_results(rows)

def _format_search_results(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    results = []
    for r in rows:
        center_lng = (r["minx"] + r["maxx"]) / 2
        center_lat = (r["miny"] + r["maxy"]) / 2
        mouza_str = f"Mouza: {r['mouza']}" if r.get("mouza") else ""
        jl_str = f"JL: {r['jl_no']}" if r.get("jl_no") else ""
        subparts = [p for p in [mouza_str, jl_str] if p]
        sublabel = " | ".join(subparts) if subparts else "CS Cadastral Parcel"

        uid_val = str(r.get("uid") or "")
        if not uid_val and r.get("jl_no") and r.get("plot_no"):
            uid_val = f"{r.get('jl_no')}{r.get('plot_no')}"

        results.append({
            "type": "cs_plot",
            "id": r["id"],
            "uid": uid_val,
            "label": f"CS Plot #{r['plot_no']}",
            "sublabel": sublabel,
            "lat": center_lat,
            "lng": center_lng,
            "bounds": [r["minx"], r["miny"], r["maxx"], r["maxy"]],
            "data": {
                "id": r["id"],
                "uid": uid_val,
                "plot_no": r["plot_no"],
                "mouza": r.get("mouza"),
                "jl_no": r.get("jl_no"),
                "area_acre": r.get("area_acre")
            }
        })
    return results

def export_plots_to_csv() -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Survey", "Plot No", "Mouza", "JL No", "Area (Acre)", "Beat Name", "MinX", "MinY", "MaxX", "MaxY"])

    if is_supabase_pg_enabled():
        try:
            with get_pg_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(r"""
                    SELECT 'CS' as survey, plot_no, mouza, jl_no, area_acre, beat_name, minx, miny, maxx, maxy 
                    FROM cs_plots 
                    ORDER BY mouza, NULLIF(regexp_replace(plot_no, '\D', '', 'g'), '')::INTEGER, plot_no
                    """)
                    for r in cur.fetchall():
                        writer.writerow([r["survey"], r["plot_no"], r["mouza"], r["jl_no"], r["area_acre"], r["beat_name"], r["minx"], r["miny"], r["maxx"], r["maxy"]])
                    return output.getvalue()
        except Exception as e:
            print(f"Supabase export PG error ({e}), trying Cloud API...")

    if is_supabase_cloud_enabled():
        try:
            def fetch_csv_chunk(start, end):
                r = _supabase_request(
                    "cs_plots?select=plot_no,mouza,jl_no,area_acre,beat_name,minx,miny,maxx,maxy&order=mouza,id",
                    headers_extra={"Range": f"{start}-{end}"}
                )
                return json.loads(r.read().decode("utf-8"))

            chunks = [(i, i + 999) for i in range(0, 12000, 1000)]
            all_rows = []
            with ThreadPoolExecutor(max_workers=6) as ex:
                for chunk_rows in ex.map(lambda c: fetch_csv_chunk(c[0], c[1]), chunks):
                    all_rows.extend(chunk_rows)

            for r in all_rows:
                writer.writerow(["CS", r["plot_no"], r.get("mouza"), r.get("jl_no"), r.get("area_acre"), r.get("beat_name"), r["minx"], r["miny"], r["maxx"], r["maxy"]])
            return output.getvalue()
        except Exception as e:
            print(f"Supabase Cloud API export error ({e}), falling back to SQLite...")

    with get_sqlite_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 'CS' as survey, plot_no, mouza, jl_no, area_acre, beat_name, minx, miny, maxx, maxy FROM cs_plots ORDER BY mouza, CAST(plot_no AS INTEGER)")
        for r in cur.fetchall():
            writer.writerow(list(r))

        return output.getvalue()
