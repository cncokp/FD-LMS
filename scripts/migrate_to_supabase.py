"""
FD-LMS: Supabase PostgreSQL Migration Utility
Migrates CS (and RS) cadastral plots from local SQLite to Supabase Free Tier (PostgreSQL).

Usage:
  1. Add SUPABASE_DB_URL to your .env file:
     SUPABASE_DB_URL="postgresql://postgres.[REF]:[PASS]@aws-0-[REGION].pooler.supabase.com:6543/postgres?sslmode=require"
  2. Run:
     python scripts/migrate_to_supabase.py
"""

import os
import sys
import json
import sqlite3
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, ".env"))

DB_PATH = os.path.join(BASE_DIR, "data", "fd_lms.db")

def migrate():
    # Accept URL from CLI argument or .env
    supabase_url = sys.argv[1] if len(sys.argv) > 1 else os.getenv("SUPABASE_DB_URL", "").strip()

    if not supabase_url:
        print("=" * 70)
        print("ERROR: SUPABASE_DB_URL is not set!")
        print("Please set SUPABASE_DB_URL in D:\\Software\\FD-LMS\\.env or pass it as an argument:")
        print("python scripts/migrate_to_supabase.py \"postgresql://postgres.xxx:pass@aws-0-xx.pooler.supabase.com:6543/postgres?sslmode=require\"")
        print("=" * 70)
        sys.exit(1)

    try:
        import psycopg2
        from psycopg2.extras import execute_batch
    except ImportError:
        print("psycopg2 is not installed. Please run: pip install psycopg2-binary")
        sys.exit(1)

    print(f"Connecting to Supabase PostgreSQL...")
    try:
        pg_conn = psycopg2.connect(supabase_url)
        pg_cur = pg_conn.cursor()
        pg_cur.execute("SELECT version();")
        pg_version = pg_cur.fetchone()[0]
        print(f"Connected to Supabase PostgreSQL: {pg_version[:60]}...")
    except Exception as e:
        print(f"Failed to connect to Supabase: {e}")
        sys.exit(1)

    # 1. Setup Schema
    print("Setting up schema on Supabase...")
    try:
        pg_cur.execute("CREATE EXTENSION IF NOT EXISTS postgis;")
    except Exception as e:
        pg_conn.rollback()
        print(f"Notice: PostGIS extension skipped ({e}). Continuing with JSONB...")

    pg_cur.execute("""
    CREATE TABLE IF NOT EXISTS cs_plots (
        id SERIAL PRIMARY KEY,
        uid TEXT NOT NULL,
        plot_no TEXT NOT NULL,
        mouza TEXT,
        jl_no TEXT,
        area_acre DOUBLE PRECISION,
        beat_name TEXT,
        label_lat DOUBLE PRECISION,
        label_lng DOUBLE PRECISION,
        label_radius DOUBLE PRECISION,
        minx DOUBLE PRECISION,
        maxx DOUBLE PRECISION,
        miny DOUBLE PRECISION,
        maxy DOUBLE PRECISION,
        geojson JSONB NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cs_plots_plot_no ON cs_plots(plot_no);
    CREATE INDEX IF NOT EXISTS idx_cs_plots_mouza ON cs_plots(mouza);
    CREATE INDEX IF NOT EXISTS idx_cs_plots_uid ON cs_plots(uid);

    CREATE TABLE IF NOT EXISTS rs_plots (
        id SERIAL PRIMARY KEY,
        uid TEXT,
        plot_no TEXT,
        mouza TEXT,
        jl_no TEXT,
        area_acre DOUBLE PRECISION,
        beat_name TEXT,
        minx DOUBLE PRECISION,
        maxx DOUBLE PRECISION,
        miny DOUBLE PRECISION,
        maxy DOUBLE PRECISION,
        geojson JSONB
    );
    """)
    pg_conn.commit()
    print("Schema verified on Supabase.")

    # 2. Read from local SQLite
    if not os.path.exists(DB_PATH):
        print(f"Local database not found at {DB_PATH}.")
        sys.exit(1)

    sqlite_conn = sqlite3.connect(DB_PATH)
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_cur = sqlite_conn.cursor()

    sqlite_cur.execute("SELECT COUNT(*) FROM cs_plots")
    total_local = sqlite_cur.fetchone()[0]
    print(f"Found {total_local} CS parcels in local SQLite.")

    # Clear existing rows on Supabase if re-migrating
    pg_cur.execute("TRUNCATE TABLE cs_plots RESTART IDENTITY;")
    pg_conn.commit()

    # 3. Batch migrate
    sqlite_cur.execute("""
    SELECT id, uid, plot_no, mouza, jl_no, area_acre, beat_name,
           label_lat, label_lng, label_radius, minx, maxx, miny, maxy, geojson
    FROM cs_plots
    ORDER BY id
    """)

    batch_size = 1000
    batch = []
    inserted = 0

    insert_sql = """
    INSERT INTO cs_plots (
        id, uid, plot_no, mouza, jl_no, area_acre, beat_name,
        label_lat, label_lng, label_radius, minx, maxx, miny, maxy, geojson
    ) VALUES (
        %s, %s, %s, %s, %s, %s, %s,
        %s, %s, %s, %s, %s, %s, %s, %s::jsonb
    )
    """

    print("Uploading parcels to Supabase in batches...")
    for row in sqlite_cur:
        batch.append((
            row["id"], row["uid"], row["plot_no"], row["mouza"], row["jl_no"],
            row["area_acre"], row["beat_name"],
            row["label_lat"], row["label_lng"], row["label_radius"],
            row["minx"], row["maxx"], row["miny"], row["maxy"],
            row["geojson"]
        ))

        if len(batch) >= batch_size:
            execute_batch(pg_cur, insert_sql, batch)
            pg_conn.commit()
            inserted += len(batch)
            print(f"Uploaded {inserted}/{total_local} parcels...")
            batch = []

    if batch:
        execute_batch(pg_cur, insert_sql, batch)
        pg_conn.commit()
        inserted += len(batch)
        print(f"Uploaded {inserted}/{total_local} parcels.")

    # Reset sequence
    pg_cur.execute("SELECT setval('cs_plots_id_seq', (SELECT MAX(id) FROM cs_plots));")
    pg_conn.commit()

    # Verify count
    pg_cur.execute("SELECT COUNT(*) FROM cs_plots;")
    remote_count = pg_cur.fetchone()[0]
    print("=" * 70)
    print(f"SUCCESS! Verified {remote_count:,} parcels in Supabase PostgreSQL.")
    print("=" * 70)

    sqlite_conn.close()
    pg_conn.close()

if __name__ == "__main__":
    migrate()
