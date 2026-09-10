"""
FD-LMS: Clear Database Script
Clears all table rows and spatial indexes in data/fd_lms.db
while keeping all schemas, tables, and virtual tables intact.
"""

import os
import json
import sqlite3

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "data", "fd_lms.db")

def clear_database():
    if not os.path.exists(DB_PATH):
        print("Database file does not exist.")
        return

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    tables_to_clear = [
        "boundary_pillars",
        "rs_plots",
        "rs_plots_idx",
        "cs_rs_reconciliation",
        "encroachments",
        "encroachments_idx",
        "mouza_boundaries",
        "beat_boundaries",
        "dashboard_stats"
    ]

    print("Clearing all data tables...")
    for table in tables_to_clear:
        try:
            cur.execute(f"DELETE FROM {table};")
            print(f"Cleared table: {table}")
        except Exception as e:
            print(f"Error clearing {table}: {e}")

    # Vacuum and re-index
    try:
        cur.execute("DELETE FROM sqlite_sequence;")
    except Exception:
        pass

    # Insert empty baseline stats
    empty_stats = {
        "total_plots": 0,
        "total_area_acre": 0.0,
        "total_fd_acre": 0.0,
        "total_other_acre": 0.0,
        "total_pillars": 0,
        "legal_stats": [],
        "mouza_stats": [],
        "beat_stats": [],
        "risk_stats": {
            "CRITICAL": {"count": 0, "acre": 0.0},
            "HIGH": {"count": 0, "acre": 0.0},
            "MEDIUM": {"count": 0, "acre": 0.0},
            "LOW": {"count": 0, "acre": 0.0}
        },
        "lulc_stats": [],
        "critical_by_mouza": []
    }

    cur.execute("INSERT INTO dashboard_stats (key, value_json) VALUES (?, ?)",
                ("summary", json.dumps(empty_stats)))

    conn.commit()
    conn.close()

    # Run vacuum on fresh connection to free disk space
    conn = sqlite3.connect(DB_PATH)
    conn.execute("VACUUM;")
    conn.close()

    size_mb = os.path.getsize(DB_PATH) / (1024 * 1024)
    print(f"\nAll data dropped successfully! Database size is now: {size_mb:.2f} MB")
    print("The interface and schema remain completely intact and ready for new data.")

if __name__ == "__main__":
    clear_database()
