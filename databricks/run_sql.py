"""Run a SQL file on the workspace's SQL warehouse through the Databricks CLI (uses your `databricks auth login` profile).

    python databricks/run_sql.py databricks/sql/01_tables.sql            # statements separated by lines containing only ';;'
    python databricks/run_sql.py "SELECT count(*) FROM workspace.facility_finder.fac_final"
"""
import json, os, subprocess, sys, tempfile, time

WAREHOUSE = os.environ.get("DATABRICKS_WAREHOUSE_ID", "cf80af6a5a0a8799")


def cli(*args, body=None):
    cmd = ["databricks", *args]
    if body is not None:
        f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
        json.dump(body, f); f.close()
        cmd += ["--json", "@" + f.name]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        raise SystemExit(r.stderr or r.stdout)
    return json.loads(r.stdout) if r.stdout.strip() else {}


def run(sql):
    res = cli("api", "post", "/api/2.0/sql/statements", body={"warehouse_id": WAREHOUSE, "statement": sql, "wait_timeout": "50s", "on_wait_timeout": "CONTINUE"})
    while res["status"]["state"] in ("PENDING", "RUNNING"):
        time.sleep(3)
        res = cli("api", "get", f"/api/2.0/sql/statements/{res['statement_id']}")
    if res["status"]["state"] != "SUCCEEDED":
        raise SystemExit(f"FAILED: {res['status'].get('error', {}).get('message')}\n{sql[:300]}")
    return res


if __name__ == "__main__":
    arg = sys.argv[1]
    text = open(arg, encoding="utf-8").read() if os.path.exists(arg) else arg
    for stmt in [s.strip() for s in text.split("\n;;\n") if s.strip()]:
        res = run(stmt)
        rows = res.get("result", {}).get("data_array")
        print(stmt.splitlines()[0][:90], "->", rows if rows is not None else "ok")
