"""
FD-LMS Data Uploader & Ingestion Engine
Supports .xlsx, .xls, and .csv files.
Provides smart column mapping for Bengali and English headers, dry-run validation preview,
and batch commit with Append/Upsert modes.
"""

import io
import csv
import re
from typing import Dict, Any, List, Tuple, Optional
import openpyxl

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
    # extract first numeric float pattern
    m = re.search(r"[-+]?[0-9]*\.?[0-9]+", s)
    if m:
        try:
            return float(m.group(0))
        except ValueError:
            return None
    return None

# Canonical aliases for automatic detection
COLUMN_ALIASES: Dict[str, List[str]] = {
    "cs_plot_no": [
        "cs_plot_no", "cs_plot", "cs plot", "cs_darg", "cs_dag",
        "সিএস দাগ", "সি এস দাগ", "সিএস দাগ নং", "সি এস দাগ নং", "cs দাগ", "সিএস"
    ],
    "rs_plot_no": [
        "rs_plot_no", "rs_plot", "rs plot", "rs_dag",
        "আরএস দাগ", "আর এস দাগ", "আরএস দাগ নং", "আর এস দাগ নং", "rs দাগ", "আরএস"
    ],
    "plot_no": [
        "plot_no", "plot", "দাগ নং", "দাগ নম্বর", "দাগ"
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


def parse_file_data(file_bytes: bytes, filename: str) -> Tuple[List[str], List[Dict[str, Any]]]:
    fn = filename.lower()
    headers: List[str] = []
    rows: List[Dict[str, Any]] = []

    if fn.endswith(".xlsx") or fn.endswith(".xlsm") or fn.endswith(".xltx"):
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        sheet = wb.active
        all_rows = list(sheet.iter_rows(values_only=True))
        if not all_rows:
            return [], []

        # Find header row (first non-empty row)
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

    elif fn.endswith(".csv"):
        # Try UTF-8 with BOM or plain UTF-8, then fallback to latin-1
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
            return [], []

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

    else:
        raise ValueError("Unsupported file format. Please upload .xlsx, .xls, or .csv")

    return headers, rows


def detect_mapping(headers: List[str], target_table: str) -> Tuple[Dict[str, str], List[str]]:
    valid_fields = set(admin_db.TABLE_FIELDS.get(target_table, []))
    mapping: Dict[str, str] = {}
    unmapped: List[str] = []

    for header in headers:
        norm = header.strip().lower()
        # Direct field match
        if norm in valid_fields:
            mapping[header] = norm
            continue

        # Alias lookup
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

    # Type sanitation
    if "area_fd" in mapped:
        mapped["area_fd"] = clean_float(mapped["area_fd"])
    if "area_others" in mapped:
        mapped["area_others"] = clean_float(mapped["area_others"])
    if "total_area" in mapped:
        mapped["total_area"] = clean_float(mapped["total_area"])
    if "cs_land_acre" in mapped:
        mapped["cs_land_acre"] = clean_float(mapped["cs_land_acre"])
    if "encroached_area_acre" in mapped:
        mapped["encroached_area_acre"] = clean_float(mapped["encroached_area_acre"])
    if "area_acre" in mapped:
        mapped["area_acre"] = clean_float(mapped["area_acre"])

    # String fields normalization
    for str_field in ["cs_plot_no", "rs_plot_no", "plot_no", "mouza", "cs_jl", "rs_jl", "jl_no", "khatian_no", "beat_name", "range", "legal_status", "encroacher_name", "structure_type", "action_taken"]:
        if str_field in mapped and mapped[str_field] is not None:
            mapped[str_field] = to_english_digits(mapped[str_field]) if "plot" in str_field or "jl" in str_field or "khatian" in str_field else str(mapped[str_field]).strip()

    # Generate UID if missing
    jl = mapped.get("cs_jl") or mapped.get("jl_no") or "0"
    pno = mapped.get("cs_plot_no") or mapped.get("plot_no") or ""
    if pno and jl:
        uid = f"{jl}{pno}"
        if "cs_uid" in admin_db.TABLE_FIELDS.get(target_table, []):
            mapped.setdefault("cs_uid", uid)
        if "uid" in admin_db.TABLE_FIELDS.get(target_table, []):
            mapped.setdefault("uid", uid)

    return mapped


def preview_upload(file_bytes: bytes, filename: str, target_table: str) -> Dict[str, Any]:
    if target_table not in admin_db.ALLOWED_TABLES:
        raise ValueError(f"Target table '{target_table}' not supported")

    headers, rows = parse_file_data(file_bytes, filename)
    mapping, unmapped = detect_mapping(headers, target_table)

    preview_rows = []
    for r in rows[:10]:
        preview_rows.append(map_row_to_schema(r, mapping, target_table))

    return {
        "filename": filename,
        "total_rows": len(rows),
        "columns_detected": headers,
        "columns_mapped": mapping,
        "unmapped_columns": unmapped,
        "target_table": target_table,
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

    headers, raw_rows = parse_file_data(file_bytes, filename)
    mapping, _ = detect_mapping(headers, target_table)

    if custom_mapping:
        mapping.update(custom_mapping)

    inserted = 0
    updated = 0

    # Ensure existing snapshot is loaded
    admin_db._init_snapshot_records_if_needed()
    records = admin_db._snapshot_records.get(target_table, [])

    # Index by UID for upsert
    existing_by_uid = {}
    for r in records:
        uid = r.get("uid") or r.get("cs_uid")
        if uid:
            existing_by_uid[str(uid)] = r

    for raw in raw_rows:
        mapped = map_row_to_schema(raw, mapping, target_table)
        uid = mapped.get("uid") or mapped.get("cs_uid")

        if mode == "upsert" and uid and str(uid) in existing_by_uid:
            existing_rec = existing_by_uid[str(uid)]
            for k, v in mapped.items():
                if v is not None:
                    existing_rec[k] = v
            updated += 1
        else:
            admin_db.create_record(target_table, mapped)
            inserted += 1

    # Invalidate cache so changes take effect
    db.invalidate_cache()

    return {
        "success": True,
        "target_table": target_table,
        "mode": mode,
        "total_processed": len(raw_rows),
        "inserted": inserted,
        "updated": updated
    }
