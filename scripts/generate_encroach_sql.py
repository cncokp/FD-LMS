import sqlite3

conn = sqlite3.connect('data/fd_lms.db')
conn.row_factory = sqlite3.Row
c = conn.cursor()
c.execute('SELECT * FROM encroachment_info')
rows = [dict(r) for r in c.fetchall()]

def esc(val):
    if val is None:
        return 'NULL'
    s = str(val).replace("'", "''")
    return f"'{s}'"

def esc_num(val):
    if val is None:
        return 'NULL'
    return str(val)

val_tuples = []
for r in rows:
    t = f"({esc(r['uid'])}, {esc(r['district'])}, {esc(r['upazila'])}, {esc(r['range'])}, {esc(r['beat_name'])}, {esc(r['mouza'])}, {esc(r['encroacher_name'])}, {esc(r['cs_plot_no'])}, {esc(r['rs_plot_no'])}, {esc(r['rs_khatian'])}, {esc(r['sec_20'])}, {esc(r['sec_6'])}, {esc_num(r['encroached_area_acre'])}, {esc(r['structure_type'])}, {esc(r['action_taken'])})"
    val_tuples.append(t)

print(f"Total records: {len(val_tuples)}")
chunk_size = 56
for i in range(0, len(val_tuples), chunk_size):
    chunk = val_tuples[i:i+chunk_size]
    sql = "INSERT INTO encroachment_info (uid, district, upazila, range, beat_name, mouza, encroacher_name, cs_plot_no, rs_plot_no, rs_khatian, sec_20, sec_6, encroached_area_acre, structure_type, action_taken) VALUES\n" + ",\n".join(chunk) + ";"
    idx = (i // chunk_size) + 1
    with open(f"scripts/chunk_{idx}.sql", "w", encoding="utf-8") as cf:
        cf.write(sql)
    print(f"Wrote chunk_{idx}.sql with {len(chunk)} tuples")
