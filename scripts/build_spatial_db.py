"""
FD-LMS: Spatial Database Builder
Reads GIS Shapefiles from DB/SHP/, reprojects to WGS84 (EPSG:4326),
generates dissolved boundaries, risk-scored encroachment classifications,
and builds an indexed SQLite database with R-Tree spatial index.
"""

import os
import json
import sqlite3
import time
import geopandas as gpd
from shapely.geometry import mapping

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHP_DIR = os.path.join(BASE_DIR, "DB", "SHP")
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "fd_lms.db")

def ensure_dirs():
    os.makedirs(DATA_DIR, exist_ok=True)
    if os.path.exists(DB_PATH):
        try:
            os.remove(DB_PATH)
            print(f"Removed previous database at {DB_PATH}")
        except Exception as e:
            print(f"Notice: could not delete old db: {e}")

def create_schema(conn):
    cur = conn.cursor()
    
    # Enable WAL mode for high read concurrency
    cur.execute("PRAGMA journal_mode = WAL;")
    cur.execute("PRAGMA synchronous = NORMAL;")
    
    # 1. Boundary Pillars
    cur.execute("""
    CREATE TABLE boundary_pillars (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pillar_id TEXT NOT NULL,
        easting REAL,
        northing REAL,
        remarks TEXT,
        lat REAL,
        lng REAL,
        geojson TEXT
    );
    """)
    cur.execute("CREATE INDEX idx_pillar_id ON boundary_pillars(pillar_id);")

    # 2. RS Cadastral Plots
    cur.execute("""
    CREATE TABLE rs_plots (
        id INTEGER PRIMARY KEY,
        plot_no TEXT,
        plot_type TEXT,
        sheet_no INTEGER,
        jl_no INTEGER,
        mouza TEXT,
        thana TEXT,
        district TEXT,
        s_type TEXT,
        beat_name TEXT,
        area_total REAL,
        area_fd REAL,
        area_other REAL,
        khatian_no TEXT,
        legal_stat TEXT,
        remarks_1 TEXT,
        uid TEXT,
        is_park_plot INTEGER DEFAULT 0,
        minx REAL,
        maxx REAL,
        miny REAL,
        maxy REAL,
        geojson TEXT
    );
    """)
    cur.execute("CREATE INDEX idx_rs_mouza ON rs_plots(mouza);")
    cur.execute("CREATE INDEX idx_rs_beat ON rs_plots(beat_name);")
    cur.execute("CREATE INDEX idx_rs_plot_no ON rs_plots(plot_no);")
    cur.execute("CREATE INDEX idx_rs_legal ON rs_plots(legal_stat);")
    cur.execute("CREATE INDEX idx_rs_khatian ON rs_plots(khatian_no);")
    cur.execute("CREATE INDEX idx_rs_park_plot ON rs_plots(is_park_plot);")

    # R*Tree Spatial Index for RS Plots
    cur.execute("CREATE VIRTUAL TABLE rs_plots_idx USING rtree(id, minx, maxx, miny, maxy);")

    # 3. CS Cadastral Plots (Plot Boundary CS)
    cur.execute("""
    CREATE TABLE cs_plots (
        id INTEGER PRIMARY KEY,
        plot_no TEXT,
        plot_type TEXT,
        sheet_no INTEGER,
        jl_no INTEGER,
        mouza TEXT,
        thana TEXT,
        district TEXT,
        s_type TEXT,
        beat_name TEXT,
        area REAL,
        area_reg REAL,
        area_gazza REAL,
        gzaate_clu TEXT,
        gazzate_re TEXT,
        forest_category TEXT,
        is_forest INTEGER DEFAULT 0,
        uid TEXT,
        minx REAL,
        maxx REAL,
        miny REAL,
        maxy REAL,
        geojson TEXT
    );
    """)
    cur.execute("CREATE INDEX idx_cs_plots_mouza ON cs_plots(mouza);")
    cur.execute("CREATE INDEX idx_cs_plots_beat ON cs_plots(beat_name);")
    cur.execute("CREATE INDEX idx_cs_plots_plot_no ON cs_plots(plot_no);")
    cur.execute("CREATE INDEX idx_cs_plots_gazzate ON cs_plots(gazzate_re);")
    cur.execute("CREATE INDEX idx_cs_plots_forest_cat ON cs_plots(forest_category);")
    cur.execute("CREATE INDEX idx_cs_plots_is_forest ON cs_plots(is_forest);")

    # R*Tree Spatial Index for CS Plots
    cur.execute("CREATE VIRTUAL TABLE cs_plots_idx USING rtree(id, minx, maxx, miny, maxy);")

    # 4. CS-RS Reconciliation
    cur.execute("""
    CREATE TABLE cs_rs_reconciliation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rs_plot_no TEXT,
        rs_mouza TEXT,
        rs_sheet_no INTEGER,
        rs_jl_no INTEGER,
        rs_ownership TEXT,
        rs_beat_name TEXT,
        rs_acre REAL,
        record_fd REAL,
        record_per REAL,
        cs_plot_no TEXT,
        cs_sheet_no INTEGER,
        cs_jl_no INTEGER,
        cs_mouza TEXT,
        cs_ownership TEXT,
        cs_acre REAL
    );
    """)
    cur.execute("CREATE INDEX idx_cs_rs_plot ON cs_rs_reconciliation(rs_plot_no, rs_mouza);")
    cur.execute("CREATE INDEX idx_cs_recon_plot_no ON cs_rs_reconciliation(cs_plot_no);")

    # 4. Encroachments & Land Use Intersect
    cur.execute("""
    CREATE TABLE encroachments (
        id INTEGER PRIMARY KEY,
        plot_no TEXT,
        mouza TEXT,
        beat_name TEXT,
        legal_stat TEXT,
        lulc_type TEXT,
        risk_level TEXT,
        area_total REAL,
        area_fd REAL,
        area_other REAL,
        khatian_no TEXT,
        remarks_1 TEXT,
        minx REAL,
        maxx REAL,
        miny REAL,
        maxy REAL,
        geojson TEXT
    );
    """)
    cur.execute("CREATE INDEX idx_enc_risk ON encroachments(risk_level);")
    cur.execute("CREATE INDEX idx_enc_mouza ON encroachments(mouza);")
    cur.execute("CREATE INDEX idx_enc_type ON encroachments(lulc_type);")
    cur.execute("CREATE VIRTUAL TABLE encroachments_idx USING rtree(id, minx, maxx, miny, maxy);")

    # 5. Dissolved Mouza Boundaries (Zoom-out overview)
    cur.execute("""
    CREATE TABLE mouza_boundaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mouza TEXT NOT NULL,
        plot_count INTEGER,
        total_acre REAL,
        fd_acre REAL,
        geojson TEXT
    );
    """)

    # 7. Precomputed Stats
    cur.execute("""
    CREATE TABLE dashboard_stats (
        key TEXT PRIMARY KEY,
        value_json TEXT
    );
    """)

    conn.commit()

def process_boundary_pillars(conn):
    print("Processing Boundary Pillars...")
    shp_path = os.path.join(SHP_DIR, "Boundary_Pillar.shp")
    if not os.path.exists(shp_path):
        print("Notice: Boundary_Pillar.shp not found, skipping pillars.")
        return
    gdf = gpd.read_file(shp_path)
    gdf_4326 = gdf.to_crs(epsg=4326)

    cur = conn.cursor()
    for _, row in gdf_4326.iterrows():
        geom = row.geometry
        lng = float(geom.x) if geom else 0.0
        lat = float(geom.y) if geom else 0.0
        p_id = str(row.get('Field1', '') or f"BP-{row.name+1}")
        easting = float(row.get('Easting') or 0.0)
        northing = float(row.get('Northing') or 0.0)
        remarks = str(row.get('Remarks', '') or 'Boundary Pillar')
        gjson = json.dumps(mapping(geom)) if geom else "{}"

        cur.execute("""
        INSERT INTO boundary_pillars (pillar_id, easting, northing, remarks, lat, lng, geojson)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (p_id, easting, northing, remarks, lat, lng, gjson))
    
    conn.commit()
    print(f"Inserted {len(gdf_4326)} boundary pillars.")

def process_rs_plots(conn):
    print("Processing RS Plots (19,463 records)...")
    shp_path = os.path.join(SHP_DIR, "RS_Plot_BND_AA_Join_260217.shp")
    gdf = gpd.read_file(shp_path)
    gdf_4326 = gdf.to_crs(epsg=4326)

    cur = conn.cursor()
    plots_to_insert = []
    idx_to_insert = []

    for idx, row in gdf_4326.iterrows():
        plot_id = int(idx + 1)
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        
        simplified = geom.simplify(0.000008, preserve_topology=True)
        bounds = geom.bounds
        minx, miny, maxx, maxy = float(bounds[0]), float(bounds[1]), float(bounds[2]), float(bounds[3])
        gjson = json.dumps(mapping(simplified))

        plot_no = str(row.get('Plot_No') if row.get('Plot_No') is not None else '')
        plot_type = str(row.get('Plot_Type') or 'Plot')
        sheet_no = int(row.get('Sheet_No')) if row.get('Sheet_No') is not None and str(row.get('Sheet_No')).isdigit() else None
        jl_no = int(row.get('JL_No')) if row.get('JL_No') is not None and str(row.get('JL_No')).isdigit() else None
        mouza = str(row.get('Mouza') or '')
        thana = str(row.get('Thana') or '')
        district = str(row.get('District') or '')
        s_type = str(row.get('S_Type') or 'RS')
        beat_name = str(row.get('Beat_Name') or '')
        area_total = float(row.get('Area_Total') or 0.0)
        area_fd = float(row.get('Area_FD') or 0.0)
        area_other = float(row.get('Area_Other') or 0.0)
        khatian_no = str(row.get('Khatian_No') or '')
        legal_stat = str(row.get('Legal_Stat') or '').strip()
        if legal_stat == 'None':
            legal_stat = ''
        remarks_1 = str(row.get('Remarks_1') or '')
        uid = str(row.get('UID') or '')
        is_park_plot = 1 if legal_stat in ('20 Dhara', '6 Dhara') else 0

        plots_to_insert.append((
            plot_id, plot_no, plot_type, sheet_no, jl_no, mouza, thana, district,
            s_type, beat_name, area_total, area_fd, area_other, khatian_no,
            legal_stat, remarks_1, uid, is_park_plot, minx, maxx, miny, maxy, gjson
        ))
        idx_to_insert.append((plot_id, minx, maxx, miny, maxy))

        if len(plots_to_insert) >= 2000:
            cur.executemany("""
            INSERT INTO rs_plots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, plots_to_insert)
            cur.executemany("""
            INSERT INTO rs_plots_idx VALUES (?, ?, ?, ?, ?)
            """, idx_to_insert)
            plots_to_insert = []
            idx_to_insert = []

    if plots_to_insert:
        cur.executemany("""
        INSERT INTO rs_plots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, plots_to_insert)
        cur.executemany("""
        INSERT INTO rs_plots_idx VALUES (?, ?, ?, ?, ?)
        """, idx_to_insert)

    conn.commit()
    print(f"Inserted {len(gdf_4326)} RS plots and built R*Tree spatial index.")
    return gdf_4326

def process_cs_plots(conn):
    print("Processing CS Plots (CS_Plot_BND_AA_Join_260202.shp - 11,312 records)...")
    shp_path = os.path.join(SHP_DIR, "CS_Plot_BND_AA_Join_260202.shp")
    gdf = gpd.read_file(shp_path)
    gdf_4326 = gdf.to_crs(epsg=4326)

    cur = conn.cursor()
    plots_to_insert = []
    idx_to_insert = []

    for idx, row in gdf_4326.iterrows():
        plot_id = int(idx + 1)
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        
        simplified = geom.simplify(0.000008, preserve_topology=True)
        bounds = geom.bounds
        minx, miny, maxx, maxy = float(bounds[0]), float(bounds[1]), float(bounds[2]), float(bounds[3])
        gjson = json.dumps(mapping(simplified))

        plot_no = str(row.get('Plot_No') if row.get('Plot_No') is not None else '')
        plot_type = str(row.get('Plot_Type') or 'Plot')
        sheet_no = int(row.get('Sheet_No')) if row.get('Sheet_No') is not None and str(row.get('Sheet_No')).isdigit() else None
        jl_no = int(row.get('JL_No')) if row.get('JL_No') is not None and str(row.get('JL_No')).isdigit() else None
        mouza = str(row.get('Mouza') or '')
        thana = str(row.get('Thana') or '')
        district = str(row.get('District') or '')
        s_type = str(row.get('S_Type') or 'CS')
        beat_name = str(row.get('Beat_Name') or '')
        area = float(row.get('Area') or 0.0)
        area_reg = float(row.get('Area_Reg') or 0.0)
        area_gazza = float(row.get('Area_Gazza') or 0.0)
        gzaate_clu = str(row.get('Gzaate_Clu') or '')
        
        gazzate_re_raw = row.get('Gazzate_Re')
        gazzate_re = str(gazzate_re_raw).strip() if gazzate_re_raw is not None else ''
        if gazzate_re == 'None':
            gazzate_re = ''

        # Forest Land Classification:
        # if Gazzate_Re is "FD" and "FD (Out of Gazzate)" -> "Forest Land"
        # if "Part" -> "Partially Forest Land"
        if gazzate_re in ['FD', 'FD (Out of Gazzate)']:
            forest_category = 'Forest Land'
            is_forest = 1
        elif gazzate_re == 'Part':
            forest_category = 'Partially Forest Land'
            is_forest = 1
        else:
            forest_category = 'Other'
            is_forest = 0

        uid = str(row.get('UID') or '')

        plots_to_insert.append((
            plot_id, plot_no, plot_type, sheet_no, jl_no, mouza, thana, district,
            s_type, beat_name, area, area_reg, area_gazza, gzaate_clu, gazzate_re,
            forest_category, is_forest, uid, minx, maxx, miny, maxy, gjson
        ))
        idx_to_insert.append((plot_id, minx, maxx, miny, maxy))

        if len(plots_to_insert) >= 2000:
            cur.executemany("""
            INSERT INTO cs_plots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, plots_to_insert)
            cur.executemany("""
            INSERT INTO cs_plots_idx VALUES (?, ?, ?, ?, ?)
            """, idx_to_insert)
            plots_to_insert = []
            idx_to_insert = []

    if plots_to_insert:
        cur.executemany("""
        INSERT INTO cs_plots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, plots_to_insert)
        cur.executemany("""
        INSERT INTO cs_plots_idx VALUES (?, ?, ?, ?, ?)
        """, idx_to_insert)

    conn.commit()
    print(f"Inserted {len(gdf_4326)} CS plots and built R*Tree spatial index.")

def process_cs_rs_join(conn):
    print("Processing CS-RS Reconciliation...")
    shp_path = os.path.join(SHP_DIR, "CS_RS_Plot_Join.shp")
    gdf = gpd.read_file(shp_path, ignore_geometry=True)

    cur = conn.cursor()
    records = []
    for _, row in gdf.iterrows():
        rs_plot_no = str(row.get('Plot_No') or '')
        rs_mouza = str(row.get('Mouza') or '')
        rs_sheet_no = int(row.get('Sheet_No')) if str(row.get('Sheet_No', '')).isdigit() else None
        rs_jl_no = int(row.get('JL_No')) if str(row.get('JL_No', '')).isdigit() else None
        rs_ownership = str(row.get('Ownership') or '')
        rs_beat_name = str(row.get('Beat_Name') or '')
        rs_acre = float(row.get('RS_La_Acre') or 0.0)
        record_fd = float(row.get('Record_FD') or 0.0)
        record_per = float(row.get('Record_Per') or 0.0)
        cs_plot_no = str(row.get('CS_Plot_No') or '')
        cs_sheet_no = int(row.get('CS_Sheet_N')) if str(row.get('CS_Sheet_N', '')).isdigit() else None
        cs_jl_no = int(row.get('CS_JL_No')) if str(row.get('CS_JL_No', '')).isdigit() else None
        cs_mouza = str(row.get('CS_Mouza') or '')
        cs_ownership = str(row.get('CS_Ownersh') or '')
        cs_acre = float(row.get('CS_La_Acre') or 0.0)

        records.append((
            rs_plot_no, rs_mouza, rs_sheet_no, rs_jl_no, rs_ownership, rs_beat_name,
            rs_acre, record_fd, record_per, cs_plot_no, cs_sheet_no, cs_jl_no,
            cs_mouza, cs_ownership, cs_acre
        ))

        if len(records) >= 2000:
            cur.executemany("""
            INSERT INTO cs_rs_reconciliation (
                rs_plot_no, rs_mouza, rs_sheet_no, rs_jl_no, rs_ownership, rs_beat_name,
                rs_acre, record_fd, record_per, cs_plot_no, cs_sheet_no, cs_jl_no,
                cs_mouza, cs_ownership, cs_acre
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, records)
            records = []

    if records:
        cur.executemany("""
        INSERT INTO cs_rs_reconciliation (
            rs_plot_no, rs_mouza, rs_sheet_no, rs_jl_no, rs_ownership, rs_beat_name,
            rs_acre, record_fd, record_per, cs_plot_no, cs_sheet_no, cs_jl_no,
            cs_mouza, cs_ownership, cs_acre
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, records)

    conn.commit()
    print(f"Inserted {len(gdf)} CS-RS reconciliation records.")

def process_encroachments(conn):
    print("Processing Encroachments & Land Cover (31,348 records)...")
    shp_path = os.path.join(SHP_DIR, "LULC_v05_Intersect_RS.shp")
    gdf = gpd.read_file(shp_path)
    gdf_4326 = gdf.to_crs(epsg=4326)

    cur = conn.cursor()
    enc_records = []
    enc_idx = []

    for idx, row in gdf_4326.iterrows():
        enc_id = int(idx + 1)
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue

        bounds = geom.bounds
        minx, miny, maxx, maxy = float(bounds[0]), float(bounds[1]), float(bounds[2]), float(bounds[3])
        gjson = json.dumps(mapping(geom))

        lulc_type = str(row.get('Type') or '').strip()
        legal_stat = str(row.get('Legal_Stat') or '').strip()
        remarks_1 = str(row.get('Remarks_1') or '').strip()
        is_fd_land = (legal_stat == '20 Dhara' or remarks_1 == 'FD')

        # Risk level classification
        if is_fd_land and lulc_type == 'Built Up':
            risk_level = 'CRITICAL'
        elif is_fd_land and lulc_type in ['Rural Settlement', 'Dump Site']:
            risk_level = 'HIGH'
        elif is_fd_land and lulc_type in ['Crop Land', 'Orchard and Other Plantation']:
            risk_level = 'MEDIUM'
        elif lulc_type in ['Plain Land Forest (Sal Forest)', 'Forest Plantation']:
            risk_level = 'FOREST_CANOPY'
        else:
            risk_level = 'LOW'

        plot_no = str(row.get('Plot_No') if row.get('Plot_No') is not None else '')
        mouza = str(row.get('Mouza') or '')
        beat_name = str(row.get('Beat_Name') or '')
        area_total = float(row.get('Area_Total') or 0.0)
        area_fd = float(row.get('Area_FD') or 0.0)
        area_other = float(row.get('Area_Other') or 0.0)
        khatian_no = str(row.get('Khatian_No') or '')

        enc_records.append((
            enc_id, plot_no, mouza, beat_name, legal_stat, lulc_type, risk_level,
            area_total, area_fd, area_other, khatian_no, remarks_1,
            minx, maxx, miny, maxy, gjson
        ))
        enc_idx.append((enc_id, minx, maxx, miny, maxy))

        if len(enc_records) >= 2000:
            cur.executemany("""
            INSERT INTO encroachments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, enc_records)
            cur.executemany("""
            INSERT INTO encroachments_idx VALUES (?, ?, ?, ?, ?)
            """, enc_idx)
            enc_records = []
            enc_idx = []

    if enc_records:
        cur.executemany("""
        INSERT INTO encroachments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, enc_records)
        cur.executemany("""
        INSERT INTO encroachments_idx VALUES (?, ?, ?, ?, ?)
        """, enc_idx)

    conn.commit()
    print(f"Inserted {len(gdf_4326)} LULC encroachment polygons and built R*Tree index.")

def generate_dissolved_boundaries(conn, rs_gdf):
    print("Generating dissolved Mouza and Beat boundaries...")
    cur = conn.cursor()

    # 1. Mouzas
    mouzas = rs_gdf.groupby('Mouza')
    for mouza_name, group in mouzas:
        if not mouza_name or mouza_name.strip() == '':
            continue
        try:
            union_geom = group.geometry.unary_union
            simplified = union_geom.simplify(0.00005, preserve_topology=True)
            plot_count = len(group)
            total_acre = float(group['Area_Total'].sum())
            fd_acre = float(group['Area_FD'].sum())
            gjson = json.dumps(mapping(simplified))

            cur.execute("""
            INSERT INTO mouza_boundaries (mouza, plot_count, total_acre, fd_acre, geojson)
            VALUES (?, ?, ?, ?, ?)
            """, (mouza_name, plot_count, total_acre, fd_acre, gjson))
        except Exception as e:
            print(f"Warning on Mouza {mouza_name}: {e}")

    conn.commit()
    print("Dissolved Mouza boundaries generated.")

def generate_precomputed_stats(conn):
    print("Precomputing dashboard metrics...")
    cur = conn.cursor()

    # Total counts
    cur.execute("SELECT COUNT(*), SUM(area_total), SUM(area_fd), SUM(area_other) FROM rs_plots")
    total_plots, total_area, total_fd, total_other = cur.fetchone()

    # Forest Act Legal Status counts
    cur.execute("SELECT legal_stat, COUNT(*), SUM(area_total), SUM(area_fd) FROM rs_plots WHERE legal_stat IS NOT NULL AND legal_stat != '' GROUP BY legal_stat")
    legal_stats = [
        {"status": r[0], "count": r[1], "total_acre": round(r[2] or 0.0, 2), "fd_acre": round(r[3] or 0.0, 2)}
        for r in cur.fetchall()
    ]

    # CS Stats
    cur.execute("SELECT COUNT(*), SUM(area_reg) FROM cs_plots")
    total_cs_plots, total_cs_area = cur.fetchone()

    cur.execute("SELECT forest_category, COUNT(*), SUM(area_reg) FROM cs_plots GROUP BY forest_category")
    cs_category_stats = [
        {"category": r[0], "count": r[1], "total_acre": round(r[2] or 0.0, 2)}
        for r in cur.fetchall()
    ]

    # Mouza breakdown
    cur.execute("""
    SELECT mouza, COUNT(*), SUM(area_total), SUM(area_fd)
    FROM rs_plots 
    WHERE mouza IS NOT NULL AND mouza != '' 
    GROUP BY mouza ORDER BY COUNT(*) DESC
    """)
    mouza_stats = [
        {"mouza": r[0], "plot_count": r[1], "total_acre": round(r[2] or 0.0, 2), "fd_acre": round(r[3] or 0.0, 2)}
        for r in cur.fetchall()
    ]

    # Beat breakdown
    cur.execute("""
    SELECT beat_name, COUNT(*), SUM(area_total), SUM(area_fd)
    FROM rs_plots 
    WHERE beat_name IS NOT NULL AND beat_name != '' 
    GROUP BY beat_name ORDER BY COUNT(*) DESC
    """)
    beat_stats = [
        {"beat": r[0], "plot_count": r[1], "total_acre": round(r[2] or 0.0, 2), "fd_acre": round(r[3] or 0.0, 2)}
        for r in cur.fetchall()
    ]

    # Encroachment Risk counts
    cur.execute("""
    SELECT risk_level, COUNT(*), SUM(area_total)
    FROM encroachments 
    GROUP BY risk_level
    """)
    risk_stats = {r[0]: {"count": r[1], "acre": round(r[2] or 0.0, 2)} for r in cur.fetchall()}

    # LULC Type counts
    cur.execute("""
    SELECT lulc_type, COUNT(*), SUM(area_total)
    FROM encroachments
    GROUP BY lulc_type ORDER BY COUNT(*) DESC
    """)
    lulc_stats = [
        {"type": r[0], "count": r[1], "acre": round(r[2] or 0.0, 2)}
        for r in cur.fetchall()
    ]

    # Critical encroachment hotspots by mouza
    cur.execute("""
    SELECT mouza, COUNT(*), SUM(area_total)
    FROM encroachments
    WHERE risk_level = 'CRITICAL'
    GROUP BY mouza ORDER BY COUNT(*) DESC
    """)
    critical_by_mouza = [
        {"mouza": r[0], "critical_count": r[1], "acre": round(r[2] or 0.0, 2)}
        for r in cur.fetchall()
    ]

    summary = {
        "total_plots": total_plots,
        "total_cs_plots": total_cs_plots,
        "total_area_acre": round(total_area or 0.0, 2),
        "total_fd_acre": round(total_fd or 0.0, 2),
        "total_other_acre": round(total_other or 0.0, 2),
        "total_pillars": 236,
        "legal_stats": legal_stats,
        "cs_category_stats": cs_category_stats,
        "mouza_stats": mouza_stats,
        "beat_stats": beat_stats,
        "risk_stats": risk_stats,
        "lulc_stats": lulc_stats,
        "critical_by_mouza": critical_by_mouza
    }

    cur.execute("INSERT OR REPLACE INTO dashboard_stats (key, value_json) VALUES (?, ?)",
                ("summary", json.dumps(summary)))
    conn.commit()
    print("Precomputed stats stored.")

def main():
    t_start = time.time()
    print("Starting Spatial Database Build for FD-LMS...")
    ensure_dirs()

    conn = sqlite3.connect(DB_PATH)
    create_schema(conn)

    process_boundary_pillars(conn)
    rs_gdf = process_rs_plots(conn)
    process_cs_plots(conn)
    process_cs_rs_join(conn)
    process_encroachments(conn)
    generate_dissolved_boundaries(conn, rs_gdf)
    generate_precomputed_stats(conn)

    conn.close()
    elapsed = time.time() - t_start
    print(f"=== Spatial Database Build Completed in {elapsed:.2f}s ===")
    print(f"Database File: {DB_PATH} (Size: {os.path.getsize(DB_PATH) / (1024*1024):.2f} MB)")

if __name__ == "__main__":
    main()
