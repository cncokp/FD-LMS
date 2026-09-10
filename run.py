"""
FD-LMS: Forest Department Land Management System Launcher
Verifies database integrity and launches the FastAPI WebGIS server.
"""

import os
import sys
import webbrowser
import threading
import time
import uvicorn

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "fd_lms.db")

def ensure_database():
    if not os.path.exists(DB_PATH) or os.path.getsize(DB_PATH) < 1024 * 1024:
        print("Notice: Spatial database not found or incomplete. Generating from shapefiles...")
        import subprocess
        script_path = os.path.join(BASE_DIR, "scripts", "build_spatial_db.py")
        subprocess.run([sys.executable, script_path], check=True)
    else:
        print(f"Spatial database verified: {DB_PATH}")

def open_browser():
    time.sleep(1.2)
    url = "http://127.0.0.1:8000"
    print(f"\nOpening FD-LMS WebGIS Portal in browser: {url}\n")
    webbrowser.open(url)

if __name__ == "__main__":
    ensure_database()
    threading.Thread(target=open_browser, daemon=True).start()
    print("Starting FD-LMS WebGIS Server on http://127.0.0.1:8000 (and LAN/network at http://0.0.0.0:8000) ...")
    uvicorn.run("server.main:app", host="0.0.0.0", port=8000, reload=True)
