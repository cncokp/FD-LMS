import os
import json
import gzip
import urllib.request

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(BASE_DIR, "data", "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

PROD_URL = "https://fd-lms.vercel.app"

def build_cache():
    # 1. CS Plots
    cs_cache_path = os.path.join(CACHE_DIR, "cs_plots.geojson.gz")
    print("Fetching CS plots from production...")
    req = urllib.request.Request(f"{PROD_URL}/api/plots/cs?limit=35000", headers={"User-Agent": "FD-LMS-Sync/1.0"})
    with urllib.request.urlopen(req, timeout=40) as resp:
        cs_raw = resp.read()
    print(f"CS plots raw received: {len(cs_raw):,} bytes")

    cs_data = json.loads(cs_raw.decode("utf-8"))
    features = cs_data.get("features", [])
    print(f"Features count: {len(features)}")

    for f in features:
        if "bbox" not in f:
            g = f.get("geometry", {})
            coords = g.get("coordinates", [])
            min_x, min_y, max_x, max_y = 180.0, 90.0, -180.0, -90.0
            def _expand(ring):
                nonlocal min_x, min_y, max_x, max_y
                for pt in ring:
                    if pt[0] < min_x: min_x = pt[0]
                    if pt[0] > max_x: max_x = pt[0]
                    if pt[1] < min_y: min_y = pt[1]
                    if pt[1] > max_y: max_y = pt[1]
            if g.get("type") == "Polygon" and coords:
                _expand(coords[0])
            elif g.get("type") == "MultiPolygon" and coords:
                for poly in coords:
                    if poly: _expand(poly[0])
            f["bbox"] = [round(min_x, 6), round(min_y, 6), round(max_x, 6), round(max_y, 6)]

    compact_json = json.dumps(cs_data, separators=(",", ":")).encode("utf-8")
    cs_gz = gzip.compress(compact_json, compresslevel=6)
    with open(cs_cache_path, "wb") as out:
        out.write(cs_gz)
    print(f"CS plots saved to {cs_cache_path}: {len(cs_gz):,} bytes ({len(cs_gz)/1024/1024:.2f} MB)")

    # 2. Bulk Dossier
    bulk_cache_path = os.path.join(CACHE_DIR, "bulk_dossier.json.gz")
    print("Fetching bulk dossier from production...")
    req = urllib.request.Request(f"{PROD_URL}/api/dossier/bulk", headers={"User-Agent": "FD-LMS-Sync/1.0"})
    with urllib.request.urlopen(req, timeout=40) as resp:
        bulk_raw = resp.read()
    print(f"Bulk dossier received: {len(bulk_raw):,} bytes")
    bulk_gz = gzip.compress(bulk_raw, compresslevel=6)
    with open(bulk_cache_path, "wb") as out:
        out.write(bulk_gz)
    print(f"Bulk dossier saved to {bulk_cache_path}: {len(bulk_gz):,} bytes ({len(bulk_gz)/1024/1024:.2f} MB)")

    # 3. Encroachments
    encroach_cache_path = os.path.join(CACHE_DIR, "encroachments.geojson.gz")
    print("Fetching encroachments from production...")
    req = urllib.request.Request(f"{PROD_URL}/api/encroachments/geojson", headers={"User-Agent": "FD-LMS-Sync/1.0"})
    with urllib.request.urlopen(req, timeout=40) as resp:
        encroach_raw = resp.read()
    print(f"Encroachments received: {len(encroach_raw):,} bytes")
    encroach_gz = gzip.compress(encroach_raw, compresslevel=6)
    with open(encroach_cache_path, "wb") as out:
        out.write(encroach_gz)
    print(f"Encroachments saved to {encroach_cache_path}: {len(encroach_gz):,} bytes")

    print("\nALL DISK CACHE SNAPSHOTS GENERATED SUCCESSFULLY!")

if __name__ == "__main__":
    build_cache()
