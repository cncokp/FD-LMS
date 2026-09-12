"""
FD-LMS Data Uploader & Ingestion Engine
Supports .geojson, .json, .xlsx, .xls, and .csv files.
Provides smart column mapping for Bengali and English headers, dry-run validation preview,
and batch commit with Append/Upsert modes for both GIS Spatial Layers and Tabular Databases.
"""

import os
import io
import csv
import json
import gzip
import re
from typing import Dict, Any, List, Tuple, Optional
try:
    import openpyxl
except ImportError:
    openpyxl = None

try:
    from server import admin_db, db
except ImportError:
    import admin_db, db

# Bengali numeral to English numeral translation table
BN_TO_EN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")

def to_english_digits(val: Any) -> str:
    if val is None:
        return ""
    return str(val).translate(BN_TO_EN_DIGITS).strip()

def clean_float(val: Any) -> Optional[float]:
    if val is None:
        return None
    s = to_english_digits(val).replace(",", "")
    m = re.search(r"[-+]?[0-9]*\.?[0-9]+", s)
    if m:
        try:
            return float(m.group(0))
        except ValueError:
            return None
    return None

# Canonical aliases for automatic detection
COLUMN_ALIASES: Dict[str, List[str]] = {
    "cs_uid": [
        "cs_uid", "csuid", "cs uid", "সিএস ইউআইডি", "সিএস_ইউআইডি"
    ],
    "rs_uid": [
        "rs_uid", "rsuid", "rs uid", "আরএস ইউআইডি", "আরএস_ইউআইডি"
    ],
    "uid": [
        "uid", "id_code", "ইউআইডি", "কোড"
    ],
    "cs_plot_no": [
        "cs_plot_no", "cs_plot", "cs plot", "cs_darg", "cs_dag",
        "সিএস দাগ", "সি এস দাগ", "সিএস দাগ নং", "সি এস দাগ নং", "cs দাগ", "সিএস"
    ],
    "rs_plot_no": [
        "rs_plot_no", "rs_plot", "rs plot", "rs_dag",
        "আরএস দাগ", "আর এস দাগ", "আরএস দাগ নং", "আর এস দাগ নং", "rs দাগ", "আরএস"
    ],
    "plot_no": [
        "plot_no", "plot", "plot_number", "দাগ নং", "দাগ নম্বর", "দাগ"
    ],
    "mouza": [
        "mouza", "mouza_name", "মৌজা", "মৌজার নাম", "মৌজার_নাম"
    ],
    "cs_jl": [
        "cs_jl", "jl_no", "jl", "cs jl", "জেএল", "জে এল", "জে.এল.", "জেএল নং", "জে এল নং", "মৌজা জে এল"
    ],
    "rs_jl": [
        "rs_jl", "rs jl", "আর এস জে এল", "আরএস জেএল", "আর এস জেএল"
    ],
    "jl_no": [
        "jl_no", "jl", "জেএল", "জে এল"
    ],
    "beat_name": [
        "beat_name", "beat", "বিট", "বীট", "বিট নাম", "বীট নাম", "বিটের নাম"
    ],
    "range": [
        "range", "range_name", "রেঞ্জ", "রেঞ্জের নাম"
    ],
    "khatian_no": [
        "khatian_no", "khatian", "rs_khatian", "khotian",
        "খতিয়ান", "খতিয়ান", "খতিয়ান নং", "খতিয়ান নং", "আরএস খতিয়ান", "খতিয়ান নম্বর"
    ],
    "legal_status": [
        "legal_status", "status", "আইনি অবস্থা", "আইনগত অবস্থা", "ধারা", "ধারাসমূহ", "গেজেট ধারা", "আইনি_অবস্থা"
    ],
    "cs_land_acre": [
        "cs_land_acre", "cs_area", "সিএস জমি", "সি এস জমি (একর)", "সিএস জমির পরিমাণ"
    ],
    "total_area": [
        "total_area", "মোট জমি", "মোট জমির পরিমাণ", "মোট পরিমাণ (একর)", "মোট জমি (একর)"
    ],
    "area_fd": [
        "area_fd", "fd_area", "বন বিভাগের জমি", "বন বিভাগের জমির পরিমাণ", "বনভূমি (একর)", "বনবিভাগের জমি"
    ],
    "area_others": [
        "area_others", "others_area", "অন্যান্য জমি", "অন্যান্য জমির পরিমাণ (একর)"
    ],
    "area_acre": [
        "area_acre", "area", "জমির পরিমাণ", "একর", "পরিমাণ (একর)"
    ],
    "remarks": [
        "remarks", "মন্তব্য", "নোট", "রিমার্কস"
    ],
    "encroacher_name": [
        "encroacher_name", "name", "encroacher",
        "দখলকারী", "দখলকারীর নাম", "জবরদখলকারী", "জবরদখলকারীর নাম",
        "জবরদখলকারীর নাম ও ঠিকানা", "দখলদারের নাম ও ঠিকানা", "দখলদার"
    ],
    "encroached_area_acre": [
        "encroached_area_acre", "encroached_area",
        "দখলকৃত জমি", "দখলীয় জমির পরিমাণ", "দখলকৃত জমির পরিমাণ (একরে)",
        "জবরদখলকৃত জমির পরিমাণ", "দখলকৃত জমির পরিমাণ"
    ],
    "structure_type": [
        "structure_type", "structure", "স্থাপনা", "স্থাপনার ধরন", "স্থাপনার বিবরণ", "দখলের ধরন"
    ],
    "action_taken": [
        "action_taken", "actions", "ব্যবস্থা", "গৃহীত ব্যবস্থা", "আইনগত ব্যবস্থা", "মামলা / উচ্ছেদ"
    ],
    "sec_20": [
        "sec_20", "২০ ধারা", "২০ ধারা ঘোষিত জমি", "২০_ধারা"
    ],
    "sec_6": [
        "sec_6", "৬ ধারা", "৬ ধারা প্রস্তাবিত জমি", "৬_ধারা"
    ]
}


def _extract_geojson_bounds(geometry: Dict[str, Any]) -> Tuple[float, float, float, float]:
    """Extracts bounding box [minx, miny, maxx, maxy] for Polygon or MultiPolygon."""
    minx, miny, maxx, maxy = 180.0, 90.0, -180.0, -90.0
    coords = geometry.get("coordinates", [])

    def scan_points(pt_list):
        nonlocal minx, miny, maxx, maxy
        if not pt_list:
            return
        if isinstance(pt_list[0], (int, float)):
            x, y = float(pt_list[0]), float(pt_list[1])
            if x < minx: minx = x
            if x > maxx: maxx = x
            if y < miny: miny = y
            if y > maxy: maxy = y
        else:
            for sub in pt_list:
                scan_points(sub)

    scan_points(coords)
    if minx > maxx:
        return 0.0, 0.0, 0.0, 0.0
    return minx, miny, maxx, maxy


def parse_file_data(file_bytes: bytes, filename: str) -> Tuple[List[str], List[Dict[str, Any]], str]:
    """
    Parses file bytes into (headers, rows, detected_type).
    detected_type is 'gis' for GeoJSON with geometry, or 'tabular' for CSV/XLSX/plain JSON.
    """
    fn = filename.lower()
    headers: List[str] = []
    rows: List[Dict[str, Any]] = []

    if fn.endswith(".geojson") or fn.endswith(".json"):
        text = file_bytes.decode("utf-8", errors="ignore")
        try:
            parsed = json.loads(text)
        except Exception as e:
            raise ValueError(f"Invalid JSON file format: {e}")

        # Check if it's a GeoJSON FeatureCollection
        if isinstance(parsed, dict) and parsed.get("type") == "FeatureCollection":
            features = parsed.get("features", [])
            all_keys = set()
            for f in features:
                props = dict(f.get("properties") or {})
                geom = f.get("geometry")
                props["_geometry"] = geom
                props["_id"] = f.get("id") or props.get("id")

                if geom:
                    b_minx, b_miny, b_maxx, b_maxy = _extract_geojson_bounds(geom)
                    props.setdefault("minx", round(b_minx, 6))
                    props.setdefault("miny", round(b_miny, 6))
                    props.setdefault("maxx", round(b_maxx, 6))
                    props.setdefault("maxy", round(b_maxy, 6))
                    props.setdefault("label_lng", round((b_minx + b_maxx) / 2.0, 6))
                    props.setdefault("label_lat", round((b_miny + b_maxy) / 2.0, 6))
                    props.setdefault("label_radius", round(max(b_maxx - b_minx, b_maxy - b_miny) / 2.0, 6))

                for k in props.keys():
                    if not k.startswith("_"):
                        all_keys.add(k)
                rows.append(props)

            headers = sorted(list(all_keys))
            return headers, rows, "gis"

        # If it's a list of dicts (tabular JSON)
        elif isinstance(parsed, list) and len(parsed) > 0 and isinstance(parsed[0], dict):
            all_keys = set()
            for item in parsed:
                for k in item.keys():
                    all_keys.add(k)
                rows.append(item)
            headers = sorted(list(all_keys))
            return headers, rows, "tabular"
        else:
            raise ValueError("Unsupported JSON structure. Expected a GeoJSON FeatureCollection or an array of objects.")

    elif fn.endswith(".xlsx") or fn.endswith(".xlsm") or fn.endswith(".xltx"):
        if openpyxl is None:
            raise RuntimeError("Excel parsing module (openpyxl) is not available. Please upload a CSV file instead.")
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        sheet = wb.active
        all_rows = list(sheet.iter_rows(values_only=True))
        if not all_rows:
            return [], [], "tabular"

        header_idx = 0
        for idx, row in enumerate(all_rows):
            if any(cell is not None and str(cell).strip() != "" for cell in row):
                header_idx = idx
                headers = [str(cell).strip() if cell is not None else f"Column_{i+1}" for i, cell in enumerate(row)]
                break

        for row in all_rows[header_idx + 1:]:
            if not any(cell is not None and str(cell).strip() != "" for cell in row):
                continue
            row_dict = {}
            for i, val in enumerate(row):
                if i < len(headers):
                    row_dict[headers[i]] = val
            rows.append(row_dict)

        return headers, rows, "tabular"

    elif fn.endswith(".csv"):
        text = None
        for enc in ["utf-8-sig", "utf-8", "cp1252", "latin-1"]:
            try:
                text = file_bytes.decode(enc)
                break
            except UnicodeDecodeError:
                continue

        if text is None:
            text = file_bytes.decode("utf-8", errors="ignore")

        reader = csv.reader(io.StringIO(text))
        all_rows = list(reader)
        if not all_rows:
            return [], [], "tabular"

        header_idx = 0
        for idx, row in enumerate(all_rows):
            if any(cell.strip() != "" for cell in row):
                header_idx = idx
                headers = [cell.strip() if cell.strip() else f"Column_{i+1}" for i, cell in enumerate(row)]
                break

        for row in all_rows[header_idx + 1:]:
            if not any(cell.strip() != "" for cell in row):
                continue
            row_dict = {}
            for i, val in enumerate(row):
                if i < len(headers):
                    row_dict[headers[i]] = val
            rows.append(row_dict)

        return headers, rows, "tabular"

    else:
        raise ValueError("Unsupported file format. Please upload .geojson, .json, .xlsx, or .csv")


def recommend_target_table(headers: List[str], file_type: str, filename: str) -> Tuple[List[Dict[str, str]], str]:
    """Returns compatible target tables list and a smart default recommendation."""
    fn = filename.lower()
    headers_lower = " ".join(headers).lower()

    if file_type == "gis":
        compatible = [
            {"value": "rs_plots", "label": "RS Plot Boundary (GIS Layer)", "is_gis": True},
            {"value": "cs_plots", "label": "CS Plot Boundary (GIS Layer)", "is_gis": True},
        ]
        # Check if filename or headers strongly indicate CS
        if "cs" in fn and "rs" not in fn:
            recommended = "cs_plots"
        else:
            recommended = "rs_plots"
        return compatible, recommended

    # Tabular data
    compatible = [
        {"value": "parcel_info", "label": "Parcel Information (CS & RS Records)", "is_gis": False},
        {"value": "encroachment_info", "label": "Encroachment Details (Cases & Hotspots)", "is_gis": False},
    ]

    is_encroach = any(
        k in headers_lower for k in [
            "encroach", "দখল", "দখলকারী", "জবরদখল", "structure", "স্থাপনা", "action_taken"
        ]
    )
    recommended = "encroachment_info" if is_encroach else "parcel_info"
    return compatible, recommended


def detect_mapping(headers: List[str], target_table: str) -> Tuple[Dict[str, str], List[str]]:
    valid_fields = set(admin_db.TABLE_FIELDS.get(target_table, []))
    mapping: Dict[str, str] = {}
    unmapped: List[str] = []

    for header in headers:
        norm = header.strip().lower()
        if norm in valid_fields:
            mapping[header] = norm
            continue

        matched_field = None
        for field, aliases in COLUMN_ALIASES.items():
            if field in valid_fields and (norm in aliases or any(alias in norm for alias in aliases)):
                matched_field = field
                break

        if matched_field and matched_field not in mapping.values():
            mapping[header] = matched_field
        else:
            unmapped.append(header)

    return mapping, unmapped


def map_row_to_schema(
    raw_row: Dict[str, Any],
    column_mapping: Dict[str, str],
    target_table: str
) -> Dict[str, Any]:
    mapped: Dict[str, Any] = {}
    for orig_col, target_field in column_mapping.items():
        if orig_col in raw_row:
            mapped[target_field] = raw_row[orig_col]

    # Numeric fields
    for fld in ["area_fd", "area_others", "total_area", "cs_land_acre", "encroached_area_acre", "area_acre"]:
        if fld in mapped:
            mapped[fld] = clean_float(mapped[fld])

    # Coordinates
    for coord in ["label_lat", "label_lng", "label_radius", "minx", "miny", "maxx", "maxy"]:
        if coord in raw_row and coord not in mapped:
            mapped[coord] = raw_row[coord]
        elif coord in mapped and mapped[coord] is not None:
            try:
                mapped[coord] = float(mapped[coord])
            except Exception:
                pass

    # Geometry preservation for GIS
    if "_geometry" in raw_row:
        mapped["_geometry"] = raw_row["_geometry"]

    # String fields normalization
    for str_field in [
        "cs_plot_no", "rs_plot_no", "plot_no", "mouza", "cs_jl", "rs_jl", "jl_no",
        "khatian_no", "rs_khatian", "beat_name", "range", "legal_status",
        "encroacher_name", "structure_type", "action_taken"
    ]:
        if str_field in mapped and mapped[str_field] is not None:
            val_str = str(mapped[str_field]).strip()
            if any(k in str_field for k in ["plot", "jl", "khatian"]):
                mapped[str_field] = to_english_digits(val_str)
            else:
                mapped[str_field] = val_str

    # Synthesize UID if needed
    jl = mapped.get("cs_jl") or mapped.get("jl_no") or mapped.get("rs_jl") or "0"
    pno = mapped.get("cs_plot_no") or mapped.get("plot_no") or mapped.get("rs_plot_no") or ""
    if pno and jl:
        gen_uid = f"{jl}{pno}"
        if "cs_uid" in admin_db.TABLE_FIELDS.get(target_table, []):
            mapped.setdefault("cs_uid", gen_uid)
        if "rs_uid" in admin_db.TABLE_FIELDS.get(target_table, []):
            mapped.setdefault("rs_uid", gen_uid)
        if "uid" in admin_db.TABLE_FIELDS.get(target_table, []):
            mapped.setdefault("uid", gen_uid)

    # Sync uid & cs_uid in encroachment_info
    if target_table == "encroachment_info":
        if "uid" in mapped and not mapped.get("cs_uid"):
            mapped["cs_uid"] = mapped["uid"]
        elif "cs_uid" in mapped and not mapped.get("uid"):
            mapped["uid"] = mapped["cs_uid"]

    return mapped


def preview_upload(
    file_bytes: bytes,
    filename: str,
    target_table: Optional[str] = None
) -> Dict[str, Any]:
    headers, rows, file_type = parse_file_data(file_bytes, filename)
    compatible_tables, recommended_table = recommend_target_table(headers, file_type, filename)

    active_table = target_table if target_table in admin_db.ALLOWED_TABLES else recommended_table
    mapping, unmapped = detect_mapping(headers, active_table)

    preview_rows = []
    for r in rows[:6]:
        mapped = map_row_to_schema(r, mapping, active_table)
        clean_view = {k: v for k, v in mapped.items() if not k.startswith("_")}
        preview_rows.append(clean_view)

    return {
        "filename": filename,
        "file_type": file_type,
        "total_rows": len(rows),
        "compatible_tables": compatible_tables,
        "recommended_table": recommended_table,
        "selected_table": active_table,
        "target_table": active_table,
        "available_target_fields": admin_db.TABLE_FIELDS.get(active_table, []),
        "detected_fields": headers,
        "columns_detected": headers,
        "suggested_mapping": mapping,
        "columns_mapped": mapping,
        "unmapped_fields": unmapped,
        "unmapped_columns": unmapped,
        "preview_rows": preview_rows
    }


def commit_upload(
    file_bytes: bytes,
    filename: str,
    target_table: str,
    mode: str = "append",
    custom_mapping: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    if target_table not in admin_db.ALLOWED_TABLES:
        raise ValueError(f"Target table '{target_table}' not supported")

    headers, raw_rows, file_type = parse_file_data(file_bytes, filename)
    mapping, _ = detect_mapping(headers, target_table)
    if custom_mapping:
        mapping.update(custom_mapping)

    admin_db._init_snapshot_records_if_needed()

    # -----------------------------------------------------------------------
    # Case A: GIS Layer Ingestion (cs_plots or rs_plots)
    # -----------------------------------------------------------------------
    if target_table in admin_db.GIS_TABLES:
        new_features = []
        next_id = 1
        existing_features = []

        cache_file = os.path.join(db.CACHE_DIR, f"{target_table}.geojson.gz")
        if os.path.exists(cache_file):
            try:
                with open(cache_file, "rb") as f:
                    existing_fc = json.loads(gzip.decompress(f.read()).decode("utf-8"))
                    existing_features = existing_fc.get("features", [])
            except Exception as e:
                print(f"[Uploader] Existing {target_table} cache read error: {e}")

        # Index existing features by UID or ID
        feat_by_uid = {}
        for ef in existing_features:
            ep = ef.get("properties", {})
            e_uid = str(ep.get("uid") or ep.get("rs_uid") or ef.get("id") or "")
            if e_uid:
                feat_by_uid[e_uid] = ef

        max_id = max([int(ef.get("id") or ef.get("properties", {}).get("id") or 0) for ef in existing_features] or [0])
        next_id = max_id + 1

        inserted = 0
        updated = 0

        for r in raw_rows:
            mapped = map_row_to_schema(r, mapping, target_table)
            geom = mapped.pop("_geometry", None) or r.get("_geometry")
            if not geom:
                continue

            uid_val = str(mapped.get("uid") or mapped.get("rs_uid") or "")
            if mode == "upsert" and uid_val and uid_val in feat_by_uid:
                target_f = feat_by_uid[uid_val]
                target_f["geometry"] = geom
                for k, v in mapped.items():
                    if not k.startswith("_"):
                        target_f["properties"][k] = v
                updated += 1
            else:
                fid = r.get("_id") or next_id
                if fid >= next_id:
                    next_id = int(fid) + 1
                mapped["id"] = fid
                minx = mapped.get("minx", 0)
                miny = mapped.get("miny", 0)
                maxx = mapped.get("maxx", 0)
                maxy = mapped.get("maxy", 0)

                clean_props = {k: v for k, v in mapped.items() if not k.startswith("_")}
                feat = {
                    "type": "Feature",
                    "id": fid,
                    "bbox": [minx, miny, maxx, maxy],
                    "properties": clean_props,
                    "geometry": geom
                }
                new_features.append(feat)
                inserted += 1

        all_final_features = existing_features + new_features if mode != "replace" else new_features

        # Recompute overall bounds
        minx_all, miny_all, maxx_all, maxy_all = 180.0, 90.0, -180.0, -90.0
        for f in all_final_features:
            fb = f.get("bbox")
            if fb and len(fb) == 4:
                if fb[0] < minx_all: minx_all = fb[0]
                if fb[1] < miny_all: miny_all = fb[1]
                if fb[2] > maxx_all: maxx_all = fb[2]
                if fb[3] > maxy_all: maxy_all = fb[3]

        bounds_val = [round(minx_all, 5), round(miny_all, 5), round(maxx_all, 5), round(maxy_all, 5)] if minx_all <= maxx_all else None
        fc_payload = {
            "type": "FeatureCollection",
            "count": len(all_final_features),
            "bounds": bounds_val,
            "features": all_final_features
        }

        # Write compressed snapshot to disk
        fc_bytes = json.dumps(fc_payload, separators=(",", ":")).encode("utf-8")
        gz_bytes = gzip.compress(fc_bytes, compresslevel=6)
        with open(cache_file, "wb") as f:
            f.write(gz_bytes)

        # Update in-memory cache and admin snapshot records
        if target_table == "rs_plots":
            db._rs_cache_bytes = fc_bytes
            db._rs_gzip_bytes = gz_bytes
            db._rs_etag = db._calc_etag(gz_bytes)
        elif target_table == "cs_plots":
            db._cs_cache_bytes = fc_bytes
            db._cs_gzip_bytes = gz_bytes
            db._cs_etag = db._calc_etag(gz_bytes)

        # Repopulate admin_db snapshot for this GIS table
        admin_records = []
        for f in all_final_features:
            p = f.get("properties", {})
            r_uid = p.get("rs_uid") or p.get("uid") or ""
            admin_records.append({
                "id": p.get("id") or f.get("id"),
                "uid": r_uid,
                "rs_uid": r_uid,
                "plot_no": p.get("plot_no") or "",
                "mouza": p.get("mouza") or "",
                "jl_no": p.get("jl_no") or "",
                "beat_name": p.get("beat_name") or "",
                "area_acre": p.get("area_acre") or 0.0,
                "label_lat": p.get("label_lat") or 0.0,
                "label_lng": p.get("label_lng") or 0.0,
                "label_radius": p.get("label_radius") or 0.0,
            })
        admin_db._snapshot_records[target_table] = admin_records
        db.invalidate_cache(target_table)

        return {
            "success": True,
            "target_table": target_table,
            "file_type": "gis",
            "mode": mode,
            "total_processed": len(raw_rows),
            "total_features": len(all_final_features),
            "inserted": inserted,
            "updated": updated
        }

    # -----------------------------------------------------------------------
    # Case B: Tabular Ingestion (parcel_info or encroachment_info)
    # -----------------------------------------------------------------------
    records = admin_db._snapshot_records.get(target_table, [])
    existing_by_uid = {}
    for r in records:
        uid = r.get("uid") or r.get("cs_uid") or r.get("rs_uid")
        if uid:
            existing_by_uid[str(uid)] = r

    inserted = 0
    updated = 0

    for raw in raw_rows:
        mapped = map_row_to_schema(raw, mapping, target_table)
        uid = mapped.get("uid") or mapped.get("cs_uid") or mapped.get("rs_uid")

        if mode == "upsert" and uid and str(uid) in existing_by_uid:
            existing_rec = existing_by_uid[str(uid)]
            for k, v in mapped.items():
                if v is not None and not k.startswith("_"):
                    existing_rec[k] = v
            updated += 1
        else:
            clean_rec = {k: v for k, v in mapped.items() if not k.startswith("_")}
            admin_db.create_record(target_table, clean_rec)
            inserted += 1

    # Rebuild bulk dossier so by_uid and by_rs_uid are immediately updated
    db.rebuild_snapshots()
    db.invalidate_cache()

    return {
        "success": True,
        "target_table": target_table,
        "file_type": "tabular",
        "mode": mode,
        "total_processed": len(raw_rows),
        "inserted": inserted,
        "updated": updated
    }
