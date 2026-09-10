"""
FD-LMS: Ingest Encroachment Information (Encroachment_Info.xlsx)
Converts Sheet1 into `encroachment_info` table both in local SQLite and Supabase Cloud PostgreSQL.
"""

import os
import sys
import json
import sqlite3
import urllib.request
import time
import pandas as pd
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, ".env"))

EXCEL_PATH = os.path.join(BASE_DIR, "DB", "CSV", "Encroachment_Info.xlsx")
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

def load_encroachment_records():
    print(f"Loading Excel file from {EXCEL_PATH}...")
    df = pd.read_excel(EXCEL_PATH, sheet_name=0)
    records = []

    for idx, row in df.iterrows():
        uid = clean_int_str(row.get("UID"))
        district = clean_str(row.get("জেলা"))
        upazila = clean_str(row.get("উপজেলা"))
        rng = clean_str(row.get("রেঞ্জ"))
        beat = clean_str(row.get("বিট"))
        mouza = clean_str(row.get("মৌজা"))
        encroacher = clean_str(row.get("জবরদখলকারীর নাম ও ঠিকানা"))
        cs_plot = clean_int_str(row.get("সিএস দাগ"))
        rs_plot = clean_int_str(row.get("আরএস দাগ"))
        rs_khatian = clean_str(row.get("আরএস খতিয়ান"))
        sec_20 = clean_str(row.get("জবরদখলের ধরন_২০ ধারা"))
        sec_6 = clean_str(row.get("জবরদখলের ধরন_৬ ধারা"))
        area_acre = clean_float(row.get("Unnamed: 12"))
        structure = clean_str(row.get("স্থাপনার ধরণ"))
        action = clean_str(row.get("গৃহীত ব্যবস্থা"))

        # Normalize sec_20 and sec_6 placeholder
        if sec_20 in ["--", "-", "None"]: sec_20 = None
        if sec_6 in ["--", "-", "None"]: sec_6 = None

        records.append({
            "uid": uid,
            "district": district,
            "upazila": upazila,
            "range": rng,
            "beat_name": beat,
            "mouza": mouza,
            "encroacher_name": encroacher,
            "cs_plot_no": cs_plot,
            "rs_plot_no": rs_plot,
            "rs_khatian": rs_khatian,
            "sec_20": sec_20,
            "sec_6": sec_6,
            "encroached_area_acre": area_acre,
            "structure_type": structure,
            "action_taken": action
        })

    print(f"Loaded {len(records)} encroachment records.")
    return records

def ingest_sqlite(records):
    print("Ingesting encroachment_info into local SQLite...")
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("DROP TABLE IF EXISTS encroachment_info;")
    cur.execute("""
    CREATE TABLE encroachment_info (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL,
        district TEXT,
        upazila TEXT,
        range TEXT,
        beat_name TEXT,
        mouza TEXT,
        encroacher_name TEXT,
        cs_plot_no TEXT,
        rs_plot_no TEXT,
        rs_khatian TEXT,
        sec_20 TEXT,
        sec_6 TEXT,
        encroached_area_acre REAL,
        structure_type TEXT,
        action_taken TEXT
    );
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_encroach_uid ON encroachment_info(uid);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_encroach_cs_plot ON encroachment_info(cs_plot_no);")

    insert_sql = """
    INSERT INTO encroachment_info (
        uid, district, upazila, range, beat_name, mouza, encroacher_name,
        cs_plot_no, rs_plot_no, rs_khatian, sec_20, sec_6,
        encroached_area_acre, structure_type, action_taken
    ) VALUES (
        :uid, :district, :upazila, :range, :beat_name, :mouza, :encroacher_name,
        :cs_plot_no, :rs_plot_no, :rs_khatian, :sec_20, :sec_6,
        :encroached_area_acre, :structure_type, :action_taken
    )
    """
    cur.executemany(insert_sql, records)
    conn.commit()

    # Check is_encroached column on cs_plots
    cur.execute("PRAGMA table_info(cs_plots);")
    cols = [r[1] for r in cur.fetchall()]
    if "is_encroached" not in cols:
        cur.execute("ALTER TABLE cs_plots ADD COLUMN is_encroached INTEGER DEFAULT 0;")
        conn.commit()

    cur.execute("UPDATE cs_plots SET is_encroached = 0;")
    cur.execute("""
    UPDATE cs_plots 
    SET is_encroached = 1 
    WHERE uid IN (SELECT DISTINCT uid FROM encroachment_info);
    """)
    encroached_plots = cur.rowcount
    conn.commit()
    conn.close()
    print(f"Local SQLite: Inserted {len(records)} encroachment records, flagged {encroached_plots} encroached plots.")

def send_supabase_batch(batch):
    endpoint = f"{SUPABASE_URL}/rest/v1/encroachment_info"
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
                    return True
        except Exception as e:
            if attempt == 3:
                print(f"Error uploading batch: {e}")
                return False
            time.sleep(1.0)
    return False

def ingest_supabase(records):
    print("Uploading encroachment_info to Supabase REST API...")
    batch_size = 100
    batches = [records[i:i + batch_size] for i in range(0, len(records), batch_size)]
    success = 0
    for idx, b in enumerate(batches):
        if send_supabase_batch(b):
            success += len(b)
            print(f"Uploaded batch {idx+1}/{len(batches)} ({len(b)} rows)")
        else:
            print(f"Failed batch {idx+1}")
    print(f"Supabase REST API: Uploaded {success}/{len(records)} records.")

if __name__ == "__main__":
    records = load_encroachment_records()
    ingest_sqlite(records)
    ingest_supabase(records)
