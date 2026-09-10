"""
Ingest CS_Plot_BND.json into SQLite database data/fd_lms.db
Retains Plot No, Mouza, JL No, Area (Acre), geometry, and UID (for backend process).
Beat Name column added, awaiting user's separate dataset.
"""

import os
import json
import sqlite3
import pyproj
from shapely.geometry import Polygon, LinearRing, mapping
from shapely.ops import transform, unary_union

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "data", "fd_lms.db")
JSON_PATH = os.path.join(BASE_DIR, "DB", "SHP2", "CS_Plot_BND.json")

def round_coords(geom_dict, precision=6):
    """Round coordinates to 6 decimal places (~0.1m accuracy) for compact storage."""
    def _round(coords):
        if isinstance(coords[0], (int, float)):
            return [round(coords[0], precision), round(coords[1], precision)]
        return [_round(c) for c in coords]
    
    geom_dict["coordinates"] = _round(geom_dict["coordinates"])
    return geom_dict

def ingest_cs():
    if not os.path.exists(JSON_PATH):
        raise FileNotFoundError(f"Input file not found: {JSON_PATH}")

    print(f"Reading {JSON_PATH}...")
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])
    total_features = len(features)
    print(f"Loaded {total_features} features.")

    transformer = pyproj.Transformer.from_crs("EPSG:32646", "EPSG:4326", always_xy=True)

    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("DROP TABLE IF EXISTS cs_plots_idx")
    cur.execute("DROP TABLE IF EXISTS cs_plots")

    cur.execute("""
    CREATE TABLE cs_plots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT NOT NULL,
        plot_no TEXT NOT NULL,
        mouza TEXT,
        jl_no TEXT,
        area_acre REAL,
        beat_name TEXT,
        minx REAL NOT NULL,
        maxx REAL NOT NULL,
        miny REAL NOT NULL,
        maxy REAL NOT NULL,
        geojson TEXT NOT NULL
    )
    """)
    cur.execute("CREATE INDEX idx_cs_uid ON cs_plots(uid)")
    cur.execute("CREATE INDEX idx_cs_plot_no ON cs_plots(plot_no)")
    cur.execute("CREATE INDEX idx_cs_mouza ON cs_plots(mouza)")
    cur.execute("CREATE VIRTUAL TABLE cs_plots_idx USING rtree(id, minx, maxx, miny, maxy)")

    # Ensure rs_plots schema exists if empty
    cur.execute("""
    CREATE TABLE IF NOT EXISTS rs_plots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT,
        plot_no TEXT,
        mouza TEXT,
        jl_no TEXT,
        area_acre REAL,
        beat_name TEXT,
        minx REAL,
        maxx REAL,
        miny REAL,
        maxy REAL,
        geojson TEXT
    )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rs_uid ON rs_plots(uid)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_rs_plot_no ON rs_plots(plot_no)")
    cur.execute("CREATE VIRTUAL TABLE IF NOT EXISTS rs_plots_idx USING rtree(id, minx, maxx, miny, maxy)")

    insert_records = []
    rtree_records = []
    
    print("Reprojecting geometries and preparing records...")
    for idx, feat in enumerate(features, 1):
        attrs = feat.get("attributes", {})
        uid = str(attrs.get("UID", "")).strip()
        plot_no = str(attrs.get("Plot_No", "")).strip()
        mouza = str(attrs.get("Mouza", "")).strip()
        jl_no = str(attrs.get("JL_No", "")).strip()
        raw_area = attrs.get("Area")
        area_acre = round(float(raw_area), 4) if raw_area is not None else 0.0
        beat_name = None  # To be linked when user shares separate dataset

        rings = feat.get("geometry", {}).get("rings", [])
        if not rings:
            continue

        polys = []
        for r in rings:
            if len(r) >= 4:
                polys.append(Polygon(r))
        if not polys:
            continue

        if len(polys) == 1:
            geom = polys[0]
        else:
            exteriors = [p for p in polys if not p.exterior.is_ccw]
            holes = [p for p in polys if p.exterior.is_ccw]
            if not exteriors:
                polys.sort(key=lambda x: x.area, reverse=True)
                exteriors = [polys[0]]
                holes = polys[1:]
            result_polys = []
            for ext in exteriors:
                cur_poly = ext
                for h in holes:
                    if ext.contains(h.representative_point()):
                        cur_poly = cur_poly.difference(h)
                result_polys.append(cur_poly)
            geom = unary_union(result_polys)

        geom_wgs84 = transform(transformer.transform, geom)
        if not geom_wgs84.is_valid:
            geom_wgs84 = geom_wgs84.buffer(0)

        minx, miny, maxx, maxy = geom_wgs84.bounds
        geom_dict = round_coords(mapping(geom_wgs84))
        geojson_str = json.dumps(geom_dict, separators=(",", ":"))

        insert_records.append((idx, uid, plot_no, mouza, jl_no, area_acre, beat_name, minx, maxx, miny, maxy, geojson_str))
        rtree_records.append((idx, minx, maxx, miny, maxy))

        if idx % 2000 == 0 or idx == total_features:
            print(f"Processed {idx}/{total_features} features...")

    print(f"Inserting {len(insert_records)} records into cs_plots...")
    cur.executemany("""
    INSERT INTO cs_plots (id, uid, plot_no, mouza, jl_no, area_acre, beat_name, minx, maxx, miny, maxy, geojson)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, insert_records)

    print(f"Inserting {len(rtree_records)} records into cs_plots_idx...")
    cur.executemany("""
    INSERT INTO cs_plots_idx (id, minx, maxx, miny, maxy)
    VALUES (?, ?, ?, ?, ?)
    """, rtree_records)

    conn.commit()
    conn.execute("VACUUM")
    conn.close()

    print("CS Plot ingestion complete!")
    print(f"Total parcels inserted: {len(insert_records)}")
    print(f"Database size: {os.path.getsize(DB_PATH):,} bytes")

if __name__ == "__main__":
    ingest_cs()
