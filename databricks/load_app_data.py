"""Load the app's data into the SQL warehouse so the deployed app reads it from Delta.

    python scripts/export_snapshot.py        # facilities_final.parquet -> web/data/*.json   (the app's record format)
    python databricks/load_app_data.py       # web/data/*.json -> workspace.facility_finder.app_snapshot

Table app_snapshot(kind, bucket, k, payload): kind is facility | district | meta, payload is the record as JSON text,
bucket splits the facilities into 5 slices so each warehouse query stays small.
"""
import json, os, subprocess, sys, tempfile, zlib

sys.path.insert(0, os.path.dirname(__file__))
import run_sql

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "web", "data")
VOL = "dbfs:/Volumes/workspace/facility_finder/raw"
BUCKETS = 5

fac = json.load(open(os.path.join(DATA, "facilities.snapshot.json"), encoding="utf-8"))
dis = json.load(open(os.path.join(DATA, "districts.snapshot.json"), encoding="utf-8"))
meta = json.load(open(os.path.join(DATA, "snapshot.meta.json"), encoding="utf-8"))

out = os.path.join(tempfile.mkdtemp(), "app_snapshot.ndjson")
with open(out, "w", encoding="utf-8") as f:
    for r in fac:
        f.write(json.dumps({"kind": "facility", "bucket": zlib.crc32(r["id"].encode()) % BUCKETS, "k": r["id"], "payload": json.dumps(r, ensure_ascii=False)}, ensure_ascii=False) + "\n")
    for k, v in dis.items():
        f.write(json.dumps({"kind": "district", "bucket": 0, "k": k, "payload": json.dumps(v, ensure_ascii=False)}, ensure_ascii=False) + "\n")
    f.write(json.dumps({"kind": "meta", "bucket": 0, "k": "meta", "payload": json.dumps(meta)}) + "\n")
print(len(fac), "facilities,", len(dis), "districts")

env = dict(os.environ, MSYS_NO_PATHCONV="1")
r = subprocess.run(["databricks", "fs", "cp", out, f"{VOL}/app_snapshot.ndjson", "--overwrite"], capture_output=True, text=True, env=env)
if r.returncode:
    raise SystemExit(r.stderr)

run_sql.run("""CREATE OR REPLACE TABLE workspace.facility_finder.app_snapshot
COMMENT 'What the deployed app reads: facilities (with claims, quotes, registry match), districts and metadata, as JSON records. Built from facilities_final.parquet by scripts/export_snapshot.py.'
AS SELECT kind, CAST(bucket AS INT) AS bucket, k, payload FROM read_files('/Volumes/workspace/facility_finder/raw/app_snapshot.ndjson', format => 'json')""")
res = run_sql.run("SELECT kind, count(*) FROM workspace.facility_finder.app_snapshot GROUP BY kind ORDER BY kind")
print(res["result"]["data_array"])
