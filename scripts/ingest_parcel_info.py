"""
FD-LMS: Ingest Parcel Information (Parcel_Info.xlsx)
Converts Sheet1 into `parcel_info` table and updates `beat_name` on `cs_plots`
both in local SQLite and Supabase Cloud PostgreSQL.
"""

import os
import sys
import json
import sqlite3
import urllib.request
import time
import pandas as pd
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, ".env"))

EXCEL_PATH = os.path.join(BASE_DIR, "DB", "CSV", "Parcel_Info.xlsx")
DB_PATH = os.path.join(BASE_DIR, "data", "fd_lms.db")

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://tbffjjlkmzswcmwdkulh.supabase.co").strip()
ANON_KEY = os.getenv("SUPABASE_KEY", "").strip()

def clean_float(val):
    if pd.isna(val): return None
    try:
        s = str(val).replace(',', '').strip()
        return float(s)
    except:
        return None

def clean_int_str(val):
    if pd.isna(val): return None
    try:
        return str(int(float(str(val).strip())))
    except:
        s = str(val).strip()
        return s if s else None

def clean_str(val):
    if pd.isna(val): return None
    s = str(val).strip()
    return s if s else None

def load_excel_records():
    print(f"Loading Excel file from {EXCEL_PATH}...")
    df = pd.read_excel(EXCEL_PATH, sheet_name="Sheet1")
    records = []

    for idx, row in df.iterrows():
        cs_uid = clean_int_str(row.get("UID"))
        rs_uid = clean_int_str(row.get("UID2"))
        rng = clean_str(row.get("Range"))
        beat = clean_str(row.get("Beat_Name"))
        mouza = clean_str(row.get("Mouza Name"))
        cs_jl = clean_int_str(row.get("CS_JL"))
        rs_jl = clean_int_str(row.get("JL No"))
        cs_plot = clean_int_str(row.get("CS Plot No"))
        rs_plot = clean_int_str(row.get("RS Plot No"))
        cs_area = clean_float(row.get("CS Land Area"))
        total_area = clean_float(row.get("Total Area"))
        area_fd = clean_float(row.get("Area (FD)"))
        area_others = clean_float(row.get("Area (Others)"))
        khatian = clean_str(row.get("Khatian No"))
        legal_status = clean_str(row.get("Legal Status"))
        remarks = clean_str(row.get("Remarks"))

        records.append({
            "cs_uid": cs_uid,
            "rs_uid": rs_uid,
            "range": rng,
            "beat_name": beat,
            "mouza": mouza,
            "cs_jl": cs_jl,
            "rs_jl": rs_jl,
            "cs_plot_no": cs_plot,
            "rs_plot_no": rs_plot,
            "cs_land_acre": cs_area,
            "total_area": total_area,
            "area_fd": area_fd,
            "area_others": area_others,
            "khatian_no": khatian,
            "legal_status": legal_status,
            "remarks": remarks
        })

    print(f"Loaded {len(records)} records from Sheet1.")
    return records

def ingest_sqlite(records):
    print("Ingesting parcel_info into local SQLite...")
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("DROP TABLE IF EXISTS parcel_info;")
    cur.execute("""
    CREATE TABLE parcel_info (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cs_uid TEXT,
        rs_uid TEXT,
        range TEXT,
        beat_name TEXT,
        mouza TEXT,
        cs_jl TEXT,
        rs_jl TEXT,
        cs_plot_no TEXT,
        rs_plot_no TEXT,
        cs_land_acre REAL,
        total_area REAL,
        area_fd REAL,
        area_others REAL,
        khatian_no TEXT,
        legal_status TEXT,
        remarks TEXT
    );
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_parcel_info_cs_uid ON parcel_info(cs_uid);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_parcel_info_rs_uid ON parcel_info(rs_uid);")

    insert_sql = """
    INSERT INTO parcel_info (
        cs_uid, rs_uid, range, beat_name, mouza, cs_jl, rs_jl,
        cs_plot_no, rs_plot_no, cs_land_acre, total_area,
        area_fd, area_others, khatian_no, legal_status, remarks
    ) VALUES (
        :cs_uid, :rs_uid, :range, :beat_name, :mouza, :cs_jl, :rs_jl,
        :cs_plot_no, :rs_plot_no, :cs_land_acre, :total_area,
        :area_fd, :area_others, :khatian_no, :legal_status, :remarks
    )
    """
    cur.executemany(insert_sql, records)
    conn.commit()

    # Update cs_plots.beat_name locally
    print("Updating cs_plots.beat_name in local SQLite...")
    cur.execute("""
    UPDATE cs_plots
    SET beat_name = (
        SELECT p.beat_name FROM parcel_info p 
        WHERE p.cs_uid = cs_plots.uid AND p.beat_name IS NOT NULL AND p.beat_name != ''
        LIMIT 1
    )
    WHERE uid IN (SELECT DISTINCT cs_uid FROM parcel_info WHERE beat_name IS NOT NULL AND beat_name != '');
    """)
    updated_count = cur.rowcount
    conn.commit()
    conn.close()
    print(f"Local SQLite: Inserted {len(records)} parcel_info records, updated {updated_count} cs_plots beat_names.")

def send_supabase_batch(batch, batch_num, total_batches):
    endpoint = f"{SUPABASE_URL}/rest/v1/parcel_info"
    headers = {
        "apikey": ANON_KEY,
        "Authorization": f"Bearer {ANON_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    }
    data = json.dumps(batch).encode("utf-8")
    req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")

    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status in (200, 201):
                    return len(batch)
        except Exception as e:
            time.sleep(1)
            if attempt == 3:
                print(f"Supabase batch {batch_num} error: {e}")
                raise e
    return 0

def upload_supabase(records):
    print("Uploading parcel_info records to Supabase Cloud...")
    batches = []
    current_batch = []
    batch_size = 250

    for r in records:
        current_batch.append(r)
        if len(current_batch) >= batch_size:
            batches.append(current_batch)
            current_batch = []

    if current_batch:
        batches.append(current_batch)

    t0 = time.time()
    uploaded = 0

    with ThreadPoolExecutor(max_workers=5) as ex:
        futures = {
            ex.submit(send_supabase_batch, b, idx + 1, len(batches)): idx
            for idx, b in enumerate(batches)
        }
        for f in as_completed(futures):
            uploaded += f.result()
            pct = round((uploaded / len(records)) * 100, 1)
            print(f"Progress: {uploaded}/{len(records)} ({pct}%)...")

    duration = round(time.time() - t0, 2)
    print(f"Supabase upload complete in {duration}s!")

def main():
    records = load_excel_records()
    ingest_sqlite(records)
    upload_supabase(records)
    print("SUCCESS: Ingestion completed for both local and cloud databases.")

if __name__ == "__main__":
    main()
