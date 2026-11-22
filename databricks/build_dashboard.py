"""Create and publish the AI/BI dashboard through the Databricks CLI.  python databricks/build_dashboard.py"""
import json, os, subprocess, tempfile

WH = "cf80af6a5a0a8799"
T = "workspace.facility_finder"

DATASETS = {
    "kpis": f"""SELECT count(*) AS facilities,
      sum(CASE WHEN n_claims > 0 THEN 1 ELSE 0 END) AS with_claims,
      sum(CASE WHEN merge_suspect_score >= 2 THEN 1 ELSE 0 END) AS merge_suspects,
      (SELECT count(*) FROM {T}.registry_match WHERE tier = 'verified') AS registry_verified
      FROM {T}.facilities_serving""",
    "services": f"SELECT service, level, count(*) AS n FROM {T}.facility_claims GROUP BY service, level",
    "trust": f"SELECT coalesce(location_trust, 'unknown') AS location_trust, count(*) AS n FROM {T}.facilities_serving GROUP BY 1",
    "states": f"""SELECT coalesce(state, 'unknown') AS state, count(*) AS facilities,
      sum(CASE WHEN facility_trust >= 60 THEN 1 ELSE 0 END) AS trusted
      FROM {T}.facilities_serving GROUP BY 1 ORDER BY facilities DESC LIMIT 15""",
    "registry": f"SELECT coalesce(ownership, 'unknown') AS ownership, tier, count(*) AS n FROM {T}.registry_match GROUP BY 1, 2",
    "merge": f"""SELECT CASE WHEN merge_suspect_score IS NULL THEN 'n/a' WHEN merge_suspect_score < 1 THEN '0-1 clean'
      WHEN merge_suspect_score < 2 THEN '1-2 watch' ELSE '2+ may mix facilities' END AS band, count(*) AS n
      FROM {T}.facilities_serving GROUP BY 1""",
    "edges": f"SELECT edge_type, count(*) AS n FROM {T}.graph_edges GROUP BY 1",
    "service_graph": f"""SELECT c1.service AS service_a, c2.service AS service_b, count(*) AS facilities
      FROM {T}.facility_claims c1 JOIN {T}.facility_claims c2 ON c1.facility_id = c2.facility_id AND c1.service < c2.service
      WHERE c1.level IN ('Strong','Moderate') AND c2.level IN ('Strong','Moderate') GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 120""",
}


LEVEL_COLORS = {"Strong": "#0B5D3B", "Moderate": "#5FAE87", "Inferred": "#FFC20E", "Weak": "#9AA7A0", "Contradicted": "#C8102E"}


def fld(name):
    return {"name": name, "expression": f"`{name}`"}


def widget(name, ds, fields, spec, title, version=3):
    spec = {"version": version, **spec, "frame": {"showTitle": True, "title": title}}
    return {"name": name, "queries": [{"name": "main_query", "query": {"datasetName": ds, "fields": [fld(f) for f in fields], "disaggregated": True}}], "spec": spec}


def bar(name, ds, x, y, title, color=None, horizontal=False):
    cat = {"fieldName": x, "scale": {"type": "categorical"}, "displayName": x}
    num = {"fieldName": y, "scale": {"type": "quantitative"}, "displayName": y}
    enc = {"x": num, "y": cat} if horizontal else {"x": cat, "y": num}
    fields = [x, y]
    if color:
        enc["color"] = {"fieldName": color, "scale": {"type": "categorical", **({"mappings": [{"value": k, "color": v} for k, v in LEVEL_COLORS.items()]} if color == "level" else {})}, "displayName": color}
        fields.append(color)
    return widget(name, ds, fields, {"widgetType": "bar", "encodings": enc}, title)


def counter(name, field, title):
    return widget(name, "kpis", [field], {"widgetType": "counter", "encodings": {"value": {"fieldName": field, "displayName": title}}}, title, version=2)


widgets = [
    counter("k1", "facilities", "Facilities"), counter("k2", "with_claims", "With at least one service claim"),
    counter("k3", "registry_verified", "Verified PM-JAY matches"), counter("k4", "merge_suspects", "Records that may mix facilities"),
    bar("w_services", "services", "service", "n", "Service claims by evidence level", color="level"),
    bar("w_trust", "trust", "location_trust", "n", "How reliable is the map position?"),
    bar("w_states", "states", "state", "facilities", "Facilities by state (top 15)", horizontal=True),
    bar("w_registry", "registry", "ownership", "n", "PM-JAY matches by ownership and tier", color="tier"),
    bar("w_merge", "merge", "band", "n", "Merge suspicion (records that may combine several facilities)"),
    bar("w_edges", "edges", "edge_type", "n", "Relationship graph: edges by type"),
    widget("w_pairs", "service_graph", ["service_a", "service_b", "facilities"],
           {"widgetType": "heatmap", "encodings": {"x": {"fieldName": "service_a", "scale": {"type": "categorical"}, "displayName": "service"},
            "y": {"fieldName": "service_b", "scale": {"type": "categorical"}, "displayName": "with service"},
            "color": {"fieldName": "facilities", "scale": {"type": "quantitative"}, "displayName": "facilities offering both"}}},
           "Relationship graph as a matrix: services offered together"),
]
pos = {"k1": (0, 0, 1, 3), "k2": (1, 0, 2, 3), "k3": (3, 0, 1, 3), "k4": (4, 0, 2, 3),
       "w_services": (0, 3, 3, 8), "w_trust": (3, 3, 3, 8), "w_states": (0, 11, 3, 8), "w_registry": (3, 11, 3, 8),
       "w_merge": (0, 19, 3, 7), "w_edges": (3, 19, 3, 7), "w_pairs": (0, 26, 6, 9)}

dash = {
    "datasets": [{"name": k, "displayName": k, "queryLines": [v]} for k, v in DATASETS.items()],
    "pages": [{"name": "overview", "displayName": "Facility finder: data and relationships", "pageType": "PAGE_TYPE_CANVAS",
               "layout": [{"widget": w, "position": dict(zip(("x", "y", "width", "height"), pos[w["name"]]))} for w in widgets]}],
}

body = {"display_name": "Facility finder: data, evidence and relationships", "warehouse_id": WH,
        "parent_path": "/Workspace/Users/akileshs@andrew.cmu.edu", "serialized_dashboard": json.dumps(dash)}
f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8"); json.dump(body, f); f.close()
env = dict(os.environ, MSYS_NO_PATHCONV="1")
r = subprocess.run(["databricks", "lakeview", "create", "--json", "@" + f.name], capture_output=True, text=True, encoding="utf-8", env=env)
print(r.stdout[-600:] or r.stderr)
if r.returncode == 0:
    did = json.loads(r.stdout)["dashboard_id"]
    p = subprocess.run(["databricks", "lakeview", "publish", did, "--warehouse-id", WH, "--embed-credentials"], capture_output=True, text=True, encoding="utf-8", env=env)
    print(p.stdout[-300:] or p.stderr)
    print("dashboard id:", did)
