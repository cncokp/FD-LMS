import os
import sys
import json
import sqlite3
import urllib.request
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "data", "fd_lms.db")

SUPABASE_URL = "https://tbffjjlkmzswcmwdkulh.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiZmZqamxrbXpzd2Ntd2RrdWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwMTgwODMsImV4cCI6MjEwNDU5NDA4M30.8QTxmJNbuA91yfNyztrZqq4kvMniN0t9j6C6TaiQyYg"

def send_batch(batch, batch_num, total_batches):
    endpoint = f"{SUPABASE_URL}/rest/v1/cs_plots"
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
            with urllib.request.urlopen(req, timeout=45) as resp:
                if resp.status in (200, 201):
                    return len(batch)
        except Exception as e:
            time.sleep(1.5)
            if attempt == 3:
                print(f"Batch {batch_num} error: {e}")
                raise e
    return 0

def main():
    print("Reading parcels from local database...")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("""
    SELECT id, uid, plot_no, mouza, jl_no, area_acre, beat_name,
           label_lat, label_lng, label_radius, minx, maxx, miny, maxy, geojson
    FROM cs_plots
    ORDER BY id
    """)

    batches = []
    current_batch = []
    batch_size = 250

    for r in cur:
        current_batch.append({
            "id": r["id"],
            "uid": r["uid"],
            "plot_no": r["plot_no"],
            "mouza": r["mouza"],
            "jl_no": r["jl_no"],
            "area_acre": r["area_acre"],
            "beat_name": r["beat_name"],
            "label_lat": r["label_lat"],
            "label_lng": r["label_lng"],
            "label_radius": r["label_radius"],
            "minx": r["minx"],
            "maxx": r["maxx"],
            "miny": r["miny"],
            "maxy": r["maxy"],
            "geojson": json.loads(r["geojson"])
        })
        if len(current_batch) >= batch_size:
            batches.append(current_batch)
            current_batch = []

    if current_batch:
        batches.append(current_batch)

    conn.close()
    total_parcels = sum(len(b) for b in batches)
    print(f"Loaded {total_parcels} parcels into {len(batches)} batches.")
    print("Starting upload to Supabase cloud...")

    t0 = time.time()
    uploaded = 0

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {
            executor.submit(send_batch, b, idx + 1, len(batches)): idx
            for idx, b in enumerate(batches)
        }
        for future in as_completed(futures):
            count = future.result()
            uploaded += count
            pct = round((uploaded / total_parcels) * 100, 1)
            print(f"Uploaded {uploaded}/{total_parcels} ({pct}%)...")

    duration = round(time.time() - t0, 2)
    print(f"SUCCESS: Uploaded {uploaded} parcels to Supabase in {duration}s!")

if __name__ == "__main__":
    main()
