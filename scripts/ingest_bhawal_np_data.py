"""
FD-LMS: Ingest Bhawal National Park Data
Loads:
1. Beat Boundaries (7 beats)
2. Mouza Boundaries (8 mouzas)
3. RS Cadastral Plots (marking the 3,517 Bhawal NP plots with is_park_plot = 1)
4. CS-RS Reconciliation records (for plot dossier inspection)
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

def main():
    t0 = time.time()
    print("=== Ingesting Bhawal National Park Layers ===")
    
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("PRAGMA journal_mode = WAL;")
    cur.execute("PRAGMA synchronous = NORMAL;")

    # 1. Reset tables
    for tbl in ["rs_plots", "rs_plots_idx", "mouza_boundaries", "beat_boundaries", "cs_rs_reconciliation", "dashboard_stats"]:
        try:
            cur.execute(f"DELETE FROM {tbl};")
        except Exception:
            pass

    # Ensure is_park_plot column exists
    try:
        cur.execute("ALTER TABLE rs_plots ADD COLUMN is_park_plot INTEGER DEFAULT 0;")
    except Exception:
        pass

    conn.commit()

    # 2. Read RS Shapefile
    print("Reading RS Cadastral Shapefile...")
    rs_path = os.path.join(SHP_DIR, "RS_Plot_BND_AA_Join_260217.shp")
    gdf = gpd.read_file(rs_path)
    gdf_4326 = gdf.to_crs(epsg=4326)

    # 3. Generate Mouza Boundaries (8 Mouzas)
    print("Generating dissolved Mouza boundaries (8 mouzas)...")
    mouzas = gdf_4326.groupby('Mouza')
    for mouza_name, group in mouzas:
        if not mouza_name or mouza_name.strip() == '':
            continue
        try:
            union_geom = group.geometry.union_all() if hasattr(group.geometry, 'union_all') else group.geometry.unary_union
            simplified = union_geom.simplify(0.00005, preserve_topology=True)
            plot_count = len(group)
            park_plot_count = int((group['Beat_Name'].notna() & (group['Beat_Name'] != '')).sum())
            total_acre = float(group['Area_Total'].sum())
            fd_acre = float(group['Area_FD'].sum())
            gjson = json.dumps(mapping(simplified))

            cur.execute("""
            INSERT INTO mouza_boundaries (mouza, plot_count, total_acre, fd_acre, geojson)
            VALUES (?, ?, ?, ?, ?)
            """, (mouza_name, plot_count, total_acre, fd_acre, gjson))
        except Exception as e:
            print(f"Error on mouza {mouza_name}: {e}")

    # 4. Generate Beat Boundaries (7 Beats)
    print("Generating dissolved Beat boundaries (7 beats)...")
    beats = gdf_4326[gdf_4326['Beat_Name'].notna() & (gdf_4326['Beat_Name'] != '')].groupby('Beat_Name')
    for beat_name, group in beats:
        try:
            union_geom = group.geometry.union_all() if hasattr(group.geometry, 'union_all') else group.geometry.unary_union
            simplified = union_geom.simplify(0.00005, preserve_topology=True)
            plot_count = len(group)
            total_acre = float(group['Area_Total'].sum())
            fd_acre = float(group['Area_FD'].sum())
            gjson = json.dumps(mapping(simplified))

            cur.execute("""
            INSERT INTO beat_boundaries (beat_name, plot_count, total_acre, fd_acre, geojson)
            VALUES (?, ?, ?, ?, ?)
            """, (beat_name, plot_count, total_acre, fd_acre, gjson))
        except Exception as e:
            print(f"Error on beat {beat_name}: {e}")

    conn.commit()

    # 5. Insert RS Plots (Flagging the 3,517 Bhawal NP plots)
    print("Inserting RS Plots...")
    plots_batch = []
    idx_batch = []

    for idx, row in gdf_4326.iterrows():
        plot_id = int(idx + 1)
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue

        bounds = geom.bounds
        minx, miny, maxx, maxy = float(bounds[0]), float(bounds[1]), float(bounds[2]), float(bounds[3])

        beat_name = str(row.get('Beat_Name') or '').strip()
        is_park = 1 if beat_name != '' else 0

        # For park plots, use 0.000015 (~1.5m) simplification to optimize web delivery
        if is_park:
            geom_to_save = geom.simplify(0.000015, preserve_topology=True)
        else:
            geom_to_save = geom

        gjson = json.dumps(mapping(geom_to_save))

        plot_no = str(row.get('Plot_No') if row.get('Plot_No') is not None else '')
        plot_type = str(row.get('Plot_Type') or 'Plot')
        sheet_no = int(row.get('Sheet_No')) if str(row.get('Sheet_No', '')).isdigit() else None
        jl_no = int(row.get('JL_No')) if str(row.get('JL_No', '')).isdigit() else None
        mouza = str(row.get('Mouza') or '')
        thana = str(row.get('Thana') or 'Joydebpur')
        district = str(row.get('District') or 'Gazipur')
        s_type = str(row.get('S_Type') or 'RS')
        area_total = float(row.get('Area_Total') or 0.0)
        area_fd = float(row.get('Area_FD') or 0.0)
        area_other = float(row.get('Area_Other') or 0.0)
        khatian_no = str(row.get('Khatian_No') or '')
        legal_stat = str(row.get('Legal_Stat') or '')
        remarks_1 = str(row.get('Remarks_1') or '')
        uid = str(row.get('UID') or '')

        plots_batch.append((
            plot_id, plot_no, plot_type, sheet_no, jl_no, mouza, thana, district,
            s_type, beat_name, area_total, area_fd, area_other, khatian_no,
            legal_stat, remarks_1, uid, minx, maxx, miny, maxy, gjson, is_park
        ))
        idx_batch.append((plot_id, minx, maxx, miny, maxy))

        if len(plots_batch) >= 2000:
            cur.executemany("""
            INSERT INTO rs_plots (
                id, plot_no, plot_type, sheet_no, jl_no, mouza, thana, district,
                s_type, beat_name, area_total, area_fd, area_other, khatian_no,
                legal_stat, remarks_1, uid, minx, maxx, miny, maxy, geojson, is_park_plot
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, plots_batch)
            cur.executemany("INSERT INTO rs_plots_idx VALUES (?, ?, ?, ?, ?)", idx_batch)
            plots_batch = []
            idx_batch = []

    if plots_batch:
        cur.executemany("""
        INSERT INTO rs_plots (
            id, plot_no, plot_type, sheet_no, jl_no, mouza, thana, district,
            s_type, beat_name, area_total, area_fd, area_other, khatian_no,
            legal_stat, remarks_1, uid, minx, maxx, miny, maxy, geojson, is_park_plot
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, plots_batch)
        cur.executemany("INSERT INTO rs_plots_idx VALUES (?, ?, ?, ?, ?)", idx_batch)

    conn.commit()

    # 6. Insert CS-RS Join (for parcel dossiers)
    print("Inserting CS-RS reconciliation records...")
    join_path = os.path.join(SHP_DIR, "CS_RS_Plot_Join.shp")
    join_gdf = gpd.read_file(join_path, ignore_geometry=True)
    join_records = []
    for _, row in join_gdf.iterrows():
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

        join_records.append((
            rs_plot_no, rs_mouza, rs_sheet_no, rs_jl_no, rs_ownership, rs_beat_name,
            rs_acre, record_fd, record_per, cs_plot_no, cs_sheet_no, cs_jl_no,
            cs_mouza, cs_ownership, cs_acre
        ))

        if len(join_records) >= 3000:
            cur.executemany("""
            INSERT INTO cs_rs_reconciliation (
                rs_plot_no, rs_mouza, rs_sheet_no, rs_jl_no, rs_ownership, rs_beat_name,
                rs_acre, record_fd, record_per, cs_plot_no, cs_sheet_no, cs_jl_no,
                cs_mouza, cs_ownership, cs_acre
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, join_records)
            join_records = []

    if join_records:
        cur.executemany("""
        INSERT INTO cs_rs_reconciliation (
            rs_plot_no, rs_mouza, rs_sheet_no, rs_jl_no, rs_ownership, rs_beat_name,
            rs_acre, record_fd, record_per, cs_plot_no, cs_sheet_no, cs_jl_no,
            cs_mouza, cs_ownership, cs_acre
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, join_records)

    conn.commit()

    # 7. Compute Bhawal National Park statistics
    print("Computing Bhawal National Park statistics...")
    cur.execute("SELECT COUNT(*), SUM(area_total), SUM(area_fd), SUM(area_other) FROM rs_plots WHERE is_park_plot = 1")
    park_plots_count, total_area, total_fd, total_other = cur.fetchone()

    # Mouza breakdown for park plots
    cur.execute("""
    SELECT mouza, COUNT(*), SUM(area_total), SUM(area_fd)
    FROM rs_plots 
    WHERE is_park_plot = 1
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
    WHERE is_park_plot = 1
    GROUP BY beat_name ORDER BY COUNT(*) DESC
    """)
    beat_stats = [
        {"beat": r[0], "plot_count": r[1], "total_acre": round(r[2] or 0.0, 2), "fd_acre": round(r[3] or 0.0, 2)}
        for r in cur.fetchall()
    ]

    # Legal Status breakdown
    cur.execute("""
    SELECT legal_stat, COUNT(*), SUM(area_total), SUM(area_fd)
    FROM rs_plots 
    WHERE is_park_plot = 1
    GROUP BY legal_stat ORDER BY COUNT(*) DESC
    """)
    legal_stats = [
        {"status": r[0], "count": r[1], "total_acre": round(r[2] or 0.0, 2), "fd_acre": round(r[3] or 0.0, 2)}
        for r in cur.fetchall()
    ]

    summary = {
        "park_plots_count": park_plots_count,
        "total_area_acre": round(total_area or 0.0, 2),
        "total_fd_acre": round(total_fd or 0.0, 2),
        "total_other_acre": round(total_other or 0.0, 2),
        "total_beats": len(beat_stats),
        "total_mouzas": len(mouza_stats),
        "mouza_stats": mouza_stats,
        "beat_stats": beat_stats,
        "legal_stats": legal_stats
    }

    cur.execute("INSERT OR REPLACE INTO dashboard_stats (key, value_json) VALUES (?, ?)",
                ("summary", json.dumps(summary)))
    conn.commit()

    cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    cur.execute("VACUUM;")
    conn.close()

    elapsed = time.time() - t0
    print(f"\n=== Ingestion Completed in {elapsed:.2f}s ===")
    print(f"Loaded {park_plots_count} Bhawal National Park Plots, 7 Beats, 8 Mouzas.")

if __name__ == "__main__":
    main()
