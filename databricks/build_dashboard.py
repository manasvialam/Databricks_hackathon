"""Create and publish the AI/BI EDA dashboard on facilities_final (Delta tables in workspace.facility_finder).

    python databricks/run_sql.py databricks/sql/05_eda_views.sql      # once: helper views v_eda_fac, v_eda_offices, v_eda_registry
    python databricks/build_dashboard.py                              # builds, validates every dataset, publishes

Five pages: Overview, Maps, Services, Data quality, Registry. Widget specs follow the documented Lakeview formats
(counter v2, symbol-map v2, bar/line/pie/scatter/histogram/heatmap v3, choropleth v1). Every dataset query is run before publishing.
"""
import json, os, subprocess, sys, tempfile

sys.path.insert(0, os.path.dirname(__file__))
import run_sql

WH = "cf80af6a5a0a8799"
T = "workspace.facility_finder"
F, O, R = f"{T}.v_eda_fac", f"{T}.v_eda_offices", f"{T}.v_eda_registry"
OLD_DASHBOARD = os.environ.get("OLD_DASHBOARD_ID", "01f1e6488ec31e24bbb7f6e3ca8cb62d")
TITLE = "Facility finder: EDA, maps and care deserts (v2)"
TYPE3 = "CASE WHEN {c} IN ('hospital','clinic','dentist') THEN {c} ELSE 'other' END"

C_TYPE = {"hospital": "#D1495B", "clinic": "#2E86AB", "dentist": "#3FA34D", "other": "#E8A33D", "India Post office": "#C9CED6"}
C_TRUST = {"verified": "#2E8B57", "verified_osm": "#1B6B8F", "probable": "#8CC084", "approximate_pin": "#F2A93B", "unverified": "#D1495B", "unknown": "#8A8F98"}
C_LEVEL = {"Strong": "#0B5D3B", "Moderate": "#5FAE87", "Inferred": "#FFC20E", "Weak": "#9AA7A0", "Contradicted": "#C8102E"}
C_FAR = {"More than 50 km from its PIN": "#E5222B", "50 km or less from its PIN": "#5B6470", "India Post office": "#D9DDE3"}
C_REG = {"PM-JAY verified, government": "#1B6B8F", "PM-JAY verified, private": "#E8A33D", "Not matched (or only possibly matched)": "#C9CED6"}
C_SVC = {"trauma_emergency": "#D1495B", "icu": "#2E86AB", "dialysis": "#3FA34D", "oncology": "#8E5BC4", "nicu": "#E8A33D"}
C_OWN = {"public": "#1B6B8F", "private": "#E8A33D", "unknown": "#C9CED6"}


def corr_query(cols):
    pairs = [(a, b) for i, a in enumerate(cols) for b in cols[i + 1:]]
    inner = ",\n  ".join(f"corr(CAST({a} AS DOUBLE), CAST({b} AS DOUBLE)) AS c_{i}" for i, (a, b) in enumerate(pairs))
    diag = [f"SELECT '{c}' AS x, '{c}' AS y, CAST(1.0 AS DOUBLE) AS r FROM c" for c in cols]
    off = []
    for i, (a, b) in enumerate(pairs):
        off += [f"SELECT '{a}' AS x, '{b}' AS y, round(c_{i}, 2) AS r FROM c", f"SELECT '{b}' AS x, '{a}' AS y, round(c_{i}, 2) AS r FROM c"]
    return f"WITH c AS (SELECT\n  {inner}\nFROM {F})\n" + "\nUNION ALL\n".join(diag + off)


CORR_COLS = ["facility_trust", "location_trust_score", "merge_suspect_score", "n_claims", "n_specialties", "n_procedure", "n_equipment", "n_capability", "doctors", "capacity"]

STATE_NAME = """CASE state WHEN 'JAMMU AND KASHMIR' THEN 'Jammu and Kashmir' WHEN 'DELHI' THEN 'NCT of Delhi' WHEN 'ODISHA' THEN 'Odisha'
  WHEN 'THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU' THEN 'Dadra and Nagar Haveli and Daman and Diu' WHEN 'ANDAMAN AND NICOBAR ISLANDS' THEN 'Andaman and Nicobar'
  ELSE initcap(lower(state)) END"""

DATASETS = {
    "kpis": f"""SELECT count(*) AS facilities, sum(CASE WHEN best_lat IS NOT NULL THEN 1 ELSE 0 END) AS mapped,
      sum(CASE WHEN location_trust IN ('verified','verified_osm') THEN 1 ELSE 0 END) AS verified_loc,
      sum(CASE WHEN km_coords_to_pin > 50 THEN 1 ELSE 0 END) AS far_from_pin,
      sum(CASE WHEN merge_suspect_score >= 2 THEN 1 ELSE 0 END) AS merge_suspects,
      sum(CASE WHEN n_claims > 0 THEN 1 ELSE 0 END) AS with_claims, sum(CASE WHEN is_24x7 THEN 1 ELSE 0 END) AS h24,
      count(DISTINCT state) AS states, count(DISTINCT concat(state, '|', district)) AS districts,
      (SELECT count(*) FROM {T}.registry_match WHERE tier = 'verified') AS registry_verified FROM {F}""",
    "types": f"SELECT {TYPE3.format(c='facility_type')} AS facility_type, operator, count(*) AS n FROM {F} GROUP BY 1, 2",
    "sizes": f"""SELECT CASE size_band WHEN 'small (<30 beds)' THEN '1 small (under 30 beds)' WHEN 'medium (30-99 beds)' THEN '2 medium (30-99)'
      WHEN 'large (100-499 beds)' THEN '3 large (100-499)' WHEN 'very large / super-speciality scale (500+ beds)' THEN '4 very large (500+)'
      ELSE '5 not stated' END AS size_band, count(*) AS n FROM {F} GROUP BY 1""",
    "states": f"""SELECT {STATE_NAME} AS state_name, count(*) AS facilities, sum(CASE WHEN facility_trust >= 60 THEN 1 ELSE 0 END) AS trusted,
      round(avg(facility_trust), 1) AS avg_trust FROM {F} WHERE state IS NOT NULL GROUP BY state ORDER BY facilities DESC""",
    "states_top": f"""SELECT {STATE_NAME} AS state_name, count(*) AS facilities, sum(CASE WHEN facility_trust >= 60 THEN 1 ELSE 0 END) AS trusted
      FROM {F} WHERE state IS NOT NULL GROUP BY state ORDER BY facilities DESC LIMIT 15""",
    "districts_top": f"""SELECT concat(initcap(lower(district)), ', ', initcap(lower(state))) AS district, count(*) AS facilities
      FROM {F} WHERE district IS NOT NULL AND state IS NOT NULL GROUP BY state, district ORDER BY facilities DESC LIMIT 15""",
    "density_grid": f"""SELECT round(best_lat * 2) / 2 AS lat, round(best_lon * 2) / 2 AS lon, count(*) AS facilities, round(avg(facility_trust), 1) AS avg_trust
      FROM {F} WHERE best_lat IS NOT NULL GROUP BY 1, 2""",
    "map_types": f"""SELECT best_lat AS lat, best_lon AS lon, {TYPE3.format(c='facility_type')} AS category, 6 AS pt_size FROM {F} WHERE best_lat IS NOT NULL
      UNION ALL SELECT lat, lon, 'India Post office' AS category, 1 AS pt_size FROM {O}""",
    "map_far": f"""SELECT raw_lat AS lat, raw_lon AS lon,
      CASE WHEN km_coords_to_pin > 50 THEN 'More than 50 km from its PIN' ELSE '50 km or less from its PIN' END AS category,
      CASE WHEN km_coords_to_pin > 50 THEN 9 ELSE 3 END AS pt_size FROM {F} WHERE raw_lat IS NOT NULL AND km_coords_to_pin IS NOT NULL
      UNION ALL SELECT lat, lon, 'India Post office' AS category, 1 AS pt_size FROM {O}""",
    "map_trust": f"SELECT best_lat AS lat, best_lon AS lon, location_trust AS category, 5 AS pt_size FROM {F} WHERE best_lat IS NOT NULL",
    "map_registry": f"""SELECT best_lat AS lat, best_lon AS lon,
      CASE WHEN registry_tier = 'verified' THEN concat('PM-JAY verified, ', coalesce(registry_ownership, 'private')) ELSE 'Not matched (or only possibly matched)' END AS category,
      CASE WHEN registry_tier = 'verified' THEN 8 ELSE 2 END AS pt_size FROM {R} WHERE best_lat IS NOT NULL""",
    "map_services": f"""SELECT f.best_lat AS lat, f.best_lon AS lon, c.service AS category, 6 AS pt_size FROM {T}.facility_claims c JOIN {F} f ON f.facility_id = c.facility_id
      WHERE c.level = 'Strong' AND c.service IN ('trauma_emergency', 'icu', 'dialysis', 'oncology', 'nicu') AND f.best_lat IS NOT NULL""",
    "nfhs_scatter": f"""SELECT concat(initcap(lower(district)), ', ', initcap(lower(state))) AS district, count(*) AS facilities,
      round(avg(nfhs_inst_birth_pct), 1) AS institutional_births_pct, sum(CASE WHEN facility_trust >= 60 THEN 1 ELSE 0 END) AS trusted
      FROM {F} WHERE district IS NOT NULL AND nfhs_inst_birth_pct IS NOT NULL GROUP BY state, district HAVING count(*) >= 3""",
    "svc_levels": f"SELECT service, level, count(*) AS n FROM {T}.facility_claims GROUP BY service, level",
    "svc_state": f"""WITH top AS (SELECT state FROM {F} WHERE state IS NOT NULL GROUP BY state ORDER BY count(*) DESC LIMIT 14)
      SELECT initcap(lower(f.state)) AS state_name, c.service, count(*) AS n FROM {T}.facility_claims c JOIN {F} f ON f.facility_id = c.facility_id
      WHERE c.level IN ('Strong', 'Moderate') AND f.state IN (SELECT state FROM top) GROUP BY 1, 2""",
    "svc_pairs": f"""SELECT c1.service AS service_a, c2.service AS service_b, count(*) AS facilities
      FROM {T}.facility_claims c1 JOIN {T}.facility_claims c2 ON c1.facility_id = c2.facility_id AND c1.service < c2.service
      WHERE c1.level IN ('Strong', 'Moderate') AND c2.level IN ('Strong', 'Moderate') GROUP BY 1, 2""",
    "svc_type": f"""SELECT c.service, {TYPE3.format(c='f.facility_type')} AS facility_type, count(*) AS n FROM {T}.facility_claims c
      JOIN {F} f ON f.facility_id = c.facility_id WHERE c.level IN ('Strong', 'Moderate') GROUP BY 1, 2""",
    "svc_strength": f"SELECT claim_strength FROM {T}.facility_claims WHERE claim_strength IS NOT NULL",
    "claims_per_fac": f"SELECT least(n_claims, 12) AS n_claims FROM {F}",
    "h24_state": f"""SELECT {STATE_NAME} AS state_name, round(100 * avg(CASE WHEN is_24x7 THEN 1 ELSE 0 END), 1) AS pct_24x7, count(*) AS facilities
      FROM {F} WHERE state IS NOT NULL GROUP BY state HAVING count(*) >= 40 ORDER BY pct_24x7 DESC""",
    "trust_levels": f"SELECT location_trust, count(*) AS n FROM {F} GROUP BY 1",
    "geo_status": f"SELECT geo_status, count(*) AS n FROM {F} GROUP BY 1",
    "precision": f"SELECT location_precision, count(*) AS n FROM {F} GROUP BY 1",
    "dist_buckets": f"""SELECT CASE WHEN km_coords_to_pin <= 1 THEN '1 within 1 km' WHEN km_coords_to_pin <= 5 THEN '2 1 to 5 km' WHEN km_coords_to_pin <= 25 THEN '3 5 to 25 km'
      WHEN km_coords_to_pin <= 50 THEN '4 25 to 50 km' WHEN km_coords_to_pin <= 100 THEN '5 50 to 100 km' ELSE '6 over 100 km' END AS bucket, count(*) AS n
      FROM {F} WHERE km_coords_to_pin IS NOT NULL GROUP BY 1""",
    "trust_hist": f"SELECT facility_trust FROM {F} WHERE facility_trust IS NOT NULL",
    "merge_hist": f"SELECT merge_suspect_score FROM {F} WHERE merge_suspect_score IS NOT NULL",
    "completeness": " UNION ALL ".join(
        f"SELECT '{lbl}' AS field, round(100 * avg(CAST({col} AS INT)), 1) AS pct_present FROM {F}"
        for lbl, col in [("specialties", "has_specialties"), ("procedures", "has_procedure"), ("equipment", "has_equipment"), ("capabilities", "has_capability"),
                         ("phone", "has_phone"), ("website", "has_website"), ("email", "has_email"), ("year established", "has_year"),
                         ("number of doctors", "has_doctors"), ("bed capacity", "has_capacity"), ("description", "has_description")]),
    "merge_by_type": f"""SELECT {TYPE3.format(c='facility_type')} AS facility_type,
      CASE WHEN merge_suspect_score >= 2 THEN '3 may mix facilities (2+)' WHEN merge_suspect_score >= 1 THEN '2 watch (1 to 2)' ELSE '1 clean (under 1)' END AS band, count(*) AS n
      FROM {F} GROUP BY 1, 2""",
    "trust_scatter": f"""SELECT location_trust_score, facility_trust, {TYPE3.format(c='facility_type')} AS facility_type FROM {F}
      WHERE location_trust_score IS NOT NULL AND facility_trust IS NOT NULL""",
    "recognition": f"SELECT recognition_tier, count(*) AS n FROM {F} GROUP BY 1",
    "corr": corr_query(CORR_COLS),
    "reg_kpis": f"""SELECT sum(CASE WHEN tier = 'verified' THEN 1 ELSE 0 END) AS verified, sum(CASE WHEN tier = 'possible' THEN 1 ELSE 0 END) AS possible,
      sum(CASE WHEN tier = 'verified' AND nabh THEN 1 ELSE 0 END) AS nabh, sum(CASE WHEN tier = 'verified' AND trauma_burn THEN 1 ELSE 0 END) AS trauma_burn FROM {T}.registry_match""",
    "reg_tiers": f"SELECT tier, coalesce(ownership, 'unknown') AS ownership, count(*) AS n FROM {T}.registry_match GROUP BY 1, 2",
    "reg_state": f"""SELECT {STATE_NAME} AS state_name, round(100 * avg(CASE WHEN registry_tier = 'verified' THEN 1 ELSE 0 END), 1) AS pct_verified, count(*) AS facilities
      FROM {R} WHERE state IS NOT NULL GROUP BY state HAVING count(*) >= 30 ORDER BY pct_verified DESC LIMIT 15""",
    "reg_type": f"""SELECT {TYPE3.format(c='facility_type')} AS facility_type, CASE WHEN registry_tier = 'verified' THEN 'PM-JAY verified' ELSE 'not verified' END AS registry, count(*) AS n
      FROM {R} GROUP BY 1, 2""",
    "reg_km": f"SELECT least(registry_km, 100) AS km FROM {R} WHERE registry_tier = 'verified' AND registry_km IS NOT NULL",
    "reg_method": f"SELECT method, tier, count(*) AS n FROM {T}.registry_match GROUP BY 1, 2",
    "reg_trust": f"""SELECT CASE WHEN registry_tier = 'verified' THEN 'PM-JAY verified' ELSE 'not verified' END AS registry, round(avg(facility_trust), 1) AS avg_facility_trust,
      round(100 * avg(CASE WHEN location_trust IN ('verified', 'verified_osm') THEN 1 ELSE 0 END), 1) AS pct_location_verified FROM {R} GROUP BY 1""",
}


# ---------------------------------------------------------------------------------------------- widget builders
def fld(name, expr=None):
    return {"name": name, "expression": expr or f"`{name}`"}


def widget(name, ds, fields, spec, title, disaggregated=True, version=3):
    spec = {"version": version, **spec, "frame": {"showTitle": True, "title": title}}
    return {"name": name, "queries": [{"name": "main_query", "query": {"datasetName": ds, "fields": fields, "disaggregated": disaggregated}}], "spec": spec}


def mappings(d):
    return [{"value": k, "color": v} for k, v in d.items()]


def counter(name, ds, field, title):
    return widget(name, ds, [fld(field)], {"widgetType": "counter", "encodings": {"value": {"fieldName": field, "displayName": title}}}, title, version=2)


def bar(name, ds, x, y, title, color=None, colors=None, horizontal=False, order=None, layout=None, ycat=False):
    cat = {"fieldName": x, "scale": {"type": "categorical", **({"sort": {"by": "custom-order", "orderedValues": order}} if order else {})}, "displayName": x}
    num = {"fieldName": y, "scale": {"type": "quantitative"}, "displayName": y}
    enc = {"x": num, "y": {**cat, "fieldName": x}} if horizontal else {"x": cat, "y": num}
    fields = [fld(x), fld(y)]
    if color:
        enc["color"] = {"fieldName": color, "scale": {"type": "categorical", **({"mappings": mappings(colors)} if colors else {})}, "displayName": color}
        fields.append(fld(color))
    spec = {"widgetType": "bar", "encodings": enc}
    if layout:
        spec["mark"] = {"layout": layout}
    return widget(name, ds, fields, spec, title)


def hist(name, ds, col, width, title):
    b = f"bin({col}, binWidth={width})"
    return widget(name, ds, [{"name": b, "expression": f"BIN_FLOOR(`{col}`, {width})"}, {"name": "count(*)", "expression": "COUNT(`*`)"}],
                  {"widgetType": "histogram", "encodings": {"x": {"fieldName": b, "scale": {"type": "quantitative"}}, "y": {"fieldName": "count(*)", "scale": {"type": "quantitative"}}}},
                  title, disaggregated=False)


def heat(name, ds, x, y, val, title, scheme="viridis", xorder=None, yorder=None):
    sm = f"sum({val})"
    def cat(f, order):
        return {"fieldName": f, "scale": {"type": "categorical", **({"sort": {"by": "custom-order", "orderedValues": order}} if order else {})}, "axis": {"hideTitle": True}}
    return widget(name, ds, [fld(x), fld(y), {"name": sm, "expression": f"SUM(`{val}`)"}],
                  {"widgetType": "heatmap", "encodings": {"x": cat(x, xorder), "y": cat(y, yorder), "color": {"fieldName": sm, "scale": {"type": "quantitative", "colorRamp": {"mode": "scheme", "scheme": scheme}}}}},
                  title, disaggregated=False)


def corr_heat(name, ds, title):
    return widget(name, ds, [fld("x"), fld("y"), {"name": "max(r)", "expression": "MAX(`r`)"}],
                  {"widgetType": "heatmap", "encodings": {"x": {"fieldName": "x", "scale": {"type": "categorical", "sort": {"by": "custom-order", "orderedValues": CORR_COLS}}, "axis": {"hideTitle": True}},
                                                           "y": {"fieldName": "y", "scale": {"type": "categorical", "sort": {"by": "custom-order", "orderedValues": CORR_COLS[::-1]}}, "axis": {"hideTitle": True}},
                                                           "color": {"fieldName": "max(r)", "scale": {"type": "quantitative", "colorRamp": {"mode": "scheme", "scheme": "RdYlBu"}}}}},
                  title, disaggregated=False)


def geomap(name, ds, title, colors=None, color_field="category", size_field="pt_size", ramp=None, opacity=0.75):
    fields = [fld("lat"), fld("lon"), fld(color_field)] + ([fld(size_field)] if size_field else [])
    scale = {"type": "categorical", **({"mappings": mappings(colors)} if colors else {})} if not ramp else {"type": "quantitative", "colorRamp": ramp}
    enc = {"coordinates": {"latitude": {"fieldName": "lat"}, "longitude": {"fieldName": "lon"}}, "color": {"fieldName": color_field, "scale": scale}}
    if size_field:
        enc["size"] = {"fieldName": size_field, "scale": {"type": "quantitative"}}
    return widget(name, ds, fields, {"widgetType": "symbol-map", "encodings": enc, "mark": {"opacity": opacity}}, title, version=2)


def choropleth(name, ds, region_field, value_field, title):
    sm = f"sum({value_field})"
    return widget(name, ds, [fld(region_field), {"name": sm, "expression": f"SUM(`{value_field}`)"}],
                  {"widgetType": "choropleth-map", "encodings": {"region": {"regionType": "mapbox-v4-admin",
                   "admin0": {"type": "value", "value": "India", "geographicRole": "admin0-name"},
                   "admin1": {"fieldName": region_field, "type": "field", "geographicRole": "admin1-name"}},
                   "color": {"fieldName": sm, "scale": {"type": "quantitative", "colorRamp": {"mode": "scheme", "scheme": "YlGnBu"}}}}},
                  title, disaggregated=False, version=1)


def scatter(name, ds, x, y, title, color=None, colors=None, size=None, detail=None):
    enc = {"x": {"fieldName": x, "scale": {"type": "quantitative"}}, "y": {"fieldName": y, "scale": {"type": "quantitative"}}}
    fields = [fld(x), fld(y)]
    if color:
        enc["color"] = {"fieldName": color, "scale": {"type": "categorical", **({"mappings": mappings(colors)} if colors else {})}}
        fields.append(fld(color))
    if size:
        enc["size"] = {"fieldName": size, "scale": {"type": "quantitative"}}
        fields.append(fld(size))
    if detail:
        fields.append(fld(detail))
    return widget(name, ds, fields, {"widgetType": "scatter", "encodings": enc}, title)


def text(name, md):
    return {"name": name, "multilineTextboxSpec": {"lines": md if isinstance(md, list) else [md]}}


def order_of(ds_name, col):
    """Category order exactly as the dataset returns it (queries that end in ORDER BY), for sorted bars."""
    res = run_sql.run(DATASETS[ds_name])
    rows = res["result"]["data_array"]
    cols = [c["name"] for c in res["manifest"]["schema"]["columns"]]
    i = cols.index(col)
    return [r[i] for r in rows]


# ---------------------------------------------------------------------------------------------- pages
SERVICES = ["dialysis", "c_section", "obstetrics", "nicu", "icu", "cardiac_surgery", "cath_lab", "mri", "ct_scan", "burn_care", "trauma_emergency", "blood_bank", "oncology", "ventilator", "linear_accelerator"]
st_order = order_of("states_top", "state_name")
dist_order = order_of("districts_top", "district")
h24_order = order_of("h24_state", "state_name")[:15]
regstate_order = order_of("reg_state", "state_name")

PAGES = []


def page(name, title, items):
    PAGES.append({"name": name, "displayName": title, "pageType": "PAGE_TYPE_CANVAS",
                  "layout": [{"widget": w, "position": {"x": x, "y": y, "width": wd, "height": h}} for (w, x, y, wd, h) in items]})


page("overview", "Overview", [
    (text("t_over", ["# Healthcare facilities in India: what we have and how far to trust it\n", "\n",
                     "9,989 facilities merged from several sources. Every map, count and score on these pages is computed from the Delta tables in workspace.facility_finder. "
                     "Locations come from the facility's own coordinates, its PIN code and an OpenStreetMap check; trust scores are explained on the Data quality page.\n"]), 0, 0, 6, 3),
    (counter("k_fac", "kpis", "facilities", "Facilities"), 0, 3, 1, 3), (counter("k_map", "kpis", "mapped", "With a map position"), 1, 3, 1, 3),
    (counter("k_ver", "kpis", "verified_loc", "Location verified"), 2, 3, 1, 3), (counter("k_far", "kpis", "far_from_pin", "Coordinates over 50 km from their PIN"), 3, 3, 1, 3),
    (counter("k_clm", "kpis", "with_claims", "With at least one service claim"), 4, 3, 1, 3), (counter("k_reg", "kpis", "registry_verified", "Verified PM-JAY matches"), 5, 3, 1, 3),
    (choropleth("m_choro", "states", "state_name", "facilities", "Facilities per state (choropleth)"), 0, 6, 3, 10),
    (geomap("m_density", "density_grid", "Where facilities cluster: half-degree cells, size = facilities, colour = average trust", color_field="avg_trust", size_field="facilities",
            ramp={"mode": "scheme", "scheme": "viridis"}, opacity=0.8), 3, 6, 3, 10),
    (bar("b_states", "states_top", "state_name", "facilities", "Top 15 states by facility count", horizontal=True, order=st_order), 0, 16, 3, 9),
    (bar("b_types", "types", "facility_type", "n", "Facility type and operator", color="operator", colors=C_OWN), 3, 16, 3, 9),
    (bar("b_dist", "districts_top", "district", "facilities", "Top 15 districts", horizontal=True, order=dist_order), 0, 25, 3, 9),
    (bar("b_size", "sizes", "size_band", "n", "Facility size (bed count, where stated)"), 3, 25, 3, 9),
])

page("maps", "Maps", [
    (text("t_maps", ["## Where are the facilities?\n", "\n", "Grey dots are India Post offices (about one in eight), a proxy for where people live. Coloured dots are facilities. "
                                                          "If facilities pile up where there are few post offices, or the reverse, that is a coverage story or a data problem.\n"]), 0, 0, 6, 3),
    (geomap("m_types", "map_types", "Facility locations by type over India Post offices", colors=C_TYPE), 0, 3, 3, 12),
    (geomap("m_far", "map_far", "Coordinates inconsistent with the stated PIN (red = more than 50 km away)", colors=C_FAR), 3, 3, 3, 12),
    (geomap("m_trust", "map_trust", "How well each position is verified", colors=C_TRUST), 0, 15, 3, 12),
    (geomap("m_reg", "map_registry", "Facilities verified against the PM-JAY empanelment list", colors=C_REG), 3, 15, 3, 12),
    (geomap("m_svc", "map_services", "Where Strong evidence exists for key services", colors=C_SVC), 0, 27, 3, 12),
    (scatter("s_nfhs", "nfhs_scatter", "facilities", "institutional_births_pct", "District coverage against NFHS-5 institutional births (districts with 3+ facilities; association only)", size="trusted", detail="district"), 3, 27, 3, 12),
])

page("services", "Services", [
    (text("t_svc", ["## What can facilities do, and how well is it evidenced?\n", "\n", "Each claim is a service a facility's own text supports, with a level from Strong to Contradicted. "
                                                                                     "Counts of Strong and Moderate claims describe the dataset, not every facility in India.\n"]), 0, 0, 6, 3),
    (bar("b_levels", "svc_levels", "service", "n", "Service claims by evidence level", color="level", colors=C_LEVEL), 0, 3, 6, 10),
    (heat("h_svcstate", "svc_state", "service", "state_name", "n", "Strong or Moderate claims by state and service", scheme="YlGnBu", xorder=SERVICES), 0, 13, 3, 12),
    (heat("h_pairs", "svc_pairs", "service_a", "service_b", "facilities", "Services offered together (facilities with both)", scheme="viridis"), 3, 13, 3, 12),
    (bar("b_svctype", "svc_type", "service", "n", "Who offers what: Strong or Moderate claims by facility type", color="facility_type", colors=C_TYPE), 0, 25, 3, 10),
    (hist("hi_strength", "svc_strength", "claim_strength", 0.1, "How strong are claims? (claim strength, 0 to 1)"), 3, 25, 3, 10),
    (hist("hi_claims", "claims_per_fac", "n_claims", 1, "Claims per facility (12 = 12 or more)"), 0, 35, 3, 9),
    (bar("b_h24", "h24_state", "state_name", "pct_24x7", "Share of facilities open 24 hours, by state (40+ facilities)", horizontal=True, order=h24_order), 3, 35, 3, 9),
])

page("quality", "Data quality", [
    (text("t_dq", ["## How far can we trust the data?\n", "\n", "Locations are checked against the PIN directory and OpenStreetMap. Facility trust (0 to 100) blends how corroborated the record is "
                                                      "with how likely it is to mix several facilities. Missing values are the main limit on the evidence.\n"]), 0, 0, 6, 3),
    (bar("b_trust", "trust_levels", "location_trust", "n", "Location trust label", colors=C_TRUST, color="location_trust"), 0, 3, 2, 9),
    (bar("b_geo", "geo_status", "geo_status", "n", "PIN and coordinates agree?"), 2, 3, 2, 9),
    (bar("b_prec", "precision", "location_precision", "n", "Position precision"), 4, 3, 2, 9),
    (bar("b_dist2", "dist_buckets", "bucket", "n", "Distance between stated coordinates and PIN"), 0, 12, 3, 9),
    (bar("b_comp", "completeness", "field", "pct_present", "How complete is each field? (% of facilities with a value)", horizontal=True), 3, 12, 3, 9),
    (hist("hi_trust", "trust_hist", "facility_trust", 10, "Facility trust score (0 to 100)"), 0, 21, 3, 9),
    (hist("hi_merge", "merge_hist", "merge_suspect_score", 1, "Merge suspicion: records that may mix several facilities (0 to 5)"), 3, 21, 3, 9),
    (bar("b_merge", "merge_by_type", "facility_type", "n", "Merge suspicion by facility type", color="band"), 0, 30, 3, 9),
    (bar("b_recog", "recognition", "recognition_tier", "n", "Public recognition evidence (Wikidata, NABH, press)"), 3, 30, 3, 9),
    (corr_heat("h_corr", "corr", "Correlations between numeric facility features (Pearson r)"), 0, 39, 3, 12),
    (scatter("s_trust", "trust_scatter", "location_trust_score", "facility_trust", "Location trust against facility trust", color="facility_type", colors=C_TYPE), 3, 39, 3, 12),
])

page("registry", "Registry", [
    (text("t_reg", ["## PM-JAY empanelment list cross-check\n", "\n", "Our facilities matched to the National Health Authority's list of empanelled hospitals by name, PIN, distance and phone. "
                                                              "A match means the facility appears in the list; it does not prove a service. Match precision is still to be checked by hand.\n"]), 0, 0, 6, 3),
    (counter("k_rv", "reg_kpis", "verified", "Verified matches"), 0, 3, 1, 3), (counter("k_rp", "reg_kpis", "possible", "Possible matches"), 1, 3, 1, 3),
    (counter("k_rn", "reg_kpis", "nabh", "Verified and NABH accredited"), 2, 3, 1, 3), (counter("k_rt", "reg_kpis", "trauma_burn", "Verified with trauma or burn unit"), 3, 3, 1, 3),
    (geomap("m_reg2", "map_registry", "Verified matches by ownership", colors=C_REG), 0, 6, 3, 12),
    (bar("b_regstate", "reg_state", "state_name", "pct_verified", "Share of facilities with a verified match, by state (30+ facilities)", horizontal=True, order=regstate_order), 3, 6, 3, 12),
    (bar("b_regtier", "reg_tiers", "tier", "n", "Matches by tier and ownership", color="ownership", colors={"government": "#1B6B8F", "private": "#E8A33D", "unknown": "#C9CED6"}), 0, 18, 2, 9),
    (bar("b_regtype", "reg_type", "facility_type", "n", "Registry status by facility type", color="registry"), 2, 18, 2, 9),
    (bar("b_regmethod", "reg_method", "method", "n", "How matches were made", color="tier"), 4, 18, 2, 9),
    (hist("hi_regkm", "reg_km", "km", 5, "Distance between the two records of a verified match (km, capped at 100)"), 0, 27, 3, 9),
    (bar("b_regtrust", "reg_trust", "registry", "avg_facility_trust", "Average facility trust: verified against not verified"), 3, 27, 3, 9),
])


import dashboard_extra as X

DATASETS.update(X.DATASETS)
SVC_LABELS = X.SERVICES6
ratio_order = order_of("rg_ratio", "state_name")
rgdist_order = order_of("rg_district", "district")
gap_order = order_of("ns_gap", "district_label")
cdd_order = order_of("cd_worst_dialysis", "district")
cdc_order = order_of("cd_worst_cath", "district")
div_order = order_of("tr_diversity", "state_name")
RAMP_BP = {"mode": "scheme", "scheme": "plasma"}

page("care", "Care deserts", [
    (text("t_cd", ["## Where would a person have to travel far for care?\n", "\n",
                   "Each dot is an India Post office (about one in eight; a proxy for where people live), coloured by the straight-line distance to the nearest facility in our data with Strong or Moderate "
                   "evidence for the service. Black dots are those facilities. \"Over 100 km\" means nothing in our data within about 1.5 degrees. Our data holds 9,989 facilities, not every facility in India, "
                   "so a desert here can also be a gap in the data.\n"]), 0, 0, 6, 4),
    (geomap("m_cd_dia", "cd_dialysis", "Where a dialysis centre is more than 50 km away (orange and red)", colors=X.C_BUCKET), 0, 4, 3, 12),
    (geomap("m_cd_cath", "cd_cath", "Where a cath lab (heart attack care) is more than 50 km away", colors=X.C_BUCKET), 3, 4, 3, 12),
    (geomap("m_cd_nicu", "cd_nicu", "Where newborn intensive care (NICU) is more than 50 km away", colors=X.C_BUCKET), 0, 16, 3, 12),
    (geomap("m_cd_trauma", "cd_trauma", "Where emergency and trauma care is more than 50 km away", colors=X.C_BUCKET), 3, 16, 3, 12),
    (bar("b_cd_share", "cd_share", "service", "n", "Share of post offices by distance to the nearest facility with each service", color="bucket", colors=X.C_BUCKET, layout="stack-100"), 0, 28, 3, 10),
    (heat("h_cd_state", "cd_state", "service", "state_name", "pct_over_50km", "Percent of post offices more than 50 km from each service, by state", scheme="YlOrRd", xorder=X.SERVICES6), 3, 28, 3, 10),
    (bar("b_cd_wdia", "cd_worst_dialysis", "district", "mean_km", "Districts farthest from a dialysis centre (average km, 150 = none in our data)", horizontal=True, order=cdd_order), 0, 38, 3, 10),
    (bar("b_cd_wcath", "cd_worst_cath", "district", "mean_km", "Districts farthest from a cath lab (average km)", horizontal=True, order=cdc_order), 3, 38, 3, 10),
    (hist("hi_cd", "cd_hist", "km", 10, "How far is the nearest dialysis centre from a post office? (km, 150 = none in our data)"), 0, 48, 3, 9),
    (text("t_cd2", ["### What this shows\n", "\n",
                    "In our data about 61% of post offices are more than 50 km from a NICU, 51% from a cath lab, 42% from a dialysis centre and 19% from emergency and trauma care. "
                    "Odisha and Chhattisgarh districts such as Nabarangpur, Dantewada and Rayagada have no dialysis centre or cath lab in our data within about 150 km. "
                    "Check these against the PM-JAY list on the Registry gap page before concluding that no care exists there.\n"]), 3, 48, 3, 9),
])

page("need", "Need vs supply", [
    (text("t_ns", ["## Do the places that need care most have the capacity?\n", "\n",
                   "NFHS-5 district indicators (raised blood pressure, blood sugar, tobacco use, anaemia, births, insurance) against facilities in our data with Strong or Moderate evidence per 100 India Post offices "
                   "(a rough population proxy). Every chart here is a district-level association from survey averages. It says nothing about any one person's risk, and it cannot show cause.\n"]), 0, 0, 6, 4),
    (geomap("m_ns_bp", "ns_map_bp", "Raised blood pressure in women (colour) and cath labs (bubble size), by district", color_field="bp_women_pct", ramp=RAMP_BP), 0, 4, 3, 12),
    (geomap("m_ns_an", "ns_map_anaemia", "Anaemia in women (colour) and NICUs (bubble size), by district", color_field="anaemia_women_pct", ramp=RAMP_BP), 3, 4, 3, 12),
    (scatter("s_ns1", "ns_bp_cath", "bp_women_pct", "cath_per_100_offices", "Raised blood pressure in women against cath labs per 100 post offices (one dot per district)", size="offices", detail="district_label"), 0, 16, 3, 10),
    (scatter("s_ns2", "ns_tob_onc", "tobacco_men_pct", "onc_per_100_offices", "Tobacco use in men against cancer care per 100 post offices", size="offices", detail="district_label"), 3, 16, 3, 10),
    (scatter("s_ns3", "ns_anaemia_nicu", "anaemia_women_pct", "nicu_per_100_offices", "Anaemia in women against NICUs per 100 post offices", size="offices", detail="district_label"), 0, 26, 3, 10),
    (scatter("s_ns4", "ns_ins_pmjay", "insurance_pct", "pmjay_per_100_offices", "Households with health insurance against PM-JAY verified hospitals per 100 post offices", size="offices", detail="district_label"), 3, 26, 3, 10),
    (bar("b_ns_gap", "ns_gap", "district_label", "need_index", "High-need districts with no cath lab and no dialysis centre in our data (need index 0 to 100)", horizontal=True, order=gap_order), 0, 36, 3, 10),
    (heat("h_ns_corr", "ns_corr", "supply", "need", "r", "How district need and supply move together (Pearson r; blue = supply rises with need)", scheme="RdYlBu", xorder=X.SUPPLY_ORDER, yorder=X.NEED_ORDER[::-1]), 3, 36, 3, 10),
    (text("t_ns2", ["### What this shows\n", "\n",
                    "Supply in our data does not follow need. Across districts, tobacco use among men is slightly negatively correlated with cath labs (r = -0.23) and raised blood pressure "
                    "with cath labs only weakly positive (r = 0.16). Facilities in our data cluster in and around cities, so a district can have high need and almost no recorded capacity. "
                    "The need index averages the district's rank on blood pressure, blood sugar, tobacco use and anaemia.\n"]), 0, 46, 6, 4),
])

page("trust", "Trust story", [
    (text("t_tr", ["## What makes a record trustworthy?\n", "\n",
                   "Facility trust (0 to 100) blends how many independent sources describe a facility, how recent its page is, whether its location and contacts check out, and whether the record may mix facilities. "
                   "These charts ask which signals move the score, and where the data itself looks implausible.\n"]), 0, 0, 6, 4),
    (bar("b_tr_age", "tr_recency", "page_age", "avg_trust", "Older web pages, lower trust (average facility trust by age of the facility's page)"), 0, 4, 2, 9),
    (bar("b_tr_dom", "tr_domains", "independent_sources", "avg_trust", "More independent sources, higher trust (6 = six or more)"), 2, 4, 2, 9),
    (bar("b_tr_soc", "tr_social", "social_platforms", "avg_trust", "Social media presence and trust (platforms, 5 = five or more)"), 4, 4, 2, 9),
    (scatter("s_tr_beds", "tr_beds", "beds", "doctors", "Doctors against beds: red dots break plausibility checks (one doctor with hundreds of beds, extreme counts)", color="category", colors=X.C_FLAG), 0, 13, 3, 11),
    (scatter("s_tr_claim", "tr_claim", "facility_trust", "avg_claim_strength", "Average claim strength against facility trust, records that may mix facilities in red", color="category", colors=X.C_MERGE), 3, 13, 3, 11),
    (bar("b_tr_sm", "tr_strong_merge", "level", "n", "How much of each evidence level sits on records that may mix facilities", color="kind", layout="stack-100"), 0, 24, 3, 9),
    (bar("b_tr_op", "tr_operator", "operator", "avg_trust", "Average facility trust by operator type"), 3, 24, 3, 9),
    (bar("b_tr_dec", "tr_decade", "decade", "n", "When facilities were established, by decade and type", color="facility_type", colors=C_TYPE), 0, 33, 3, 9),
    (bar("b_tr_city", "tr_city24", "city_size", "pct_24x7", "Hospitals in bigger cities are no more likely to be open 24 hours (by number of facilities in the city)"), 3, 33, 3, 9),
    (bar("b_tr_div", "tr_diversity", "state_name", "avg_specialties", "Specialty breadth: average specialties listed per hospital, top 15 states (30+ hospitals)", horizontal=True, order=div_order), 0, 42, 3, 10),
    (text("t_tr2", ["### What this shows\n", "\n",
                    "Records with only one independent source average a trust of 54, against 71 with five. Pages not updated for three years or more average 61, against 71 for pages updated within a year. "
                    "About one in ten Strong claims (1,022 of 10,357) sits on a record that may mix several facilities, so a Strong label is not proof the service is at one particular address. "
                    "Most records (6,454) carry no usable page date.\n"]), 3, 42, 3, 10),
])

page("gap", "Registry gap", [
    (text("t_gap", ["## What does the national PM-JAY list hold that our data does not?\n", "\n",
                    "All 39,737 hospitals empanelled under PM-JAY (from hem_hospitals.csv, now in Delta) against the 1,452 we could verify in our data. A hospital missing from our data is not a missing hospital: "
                    "it is a place where our evidence cannot yet help, and where the list could add candidates.\n"]), 0, 0, 6, 4),
    (geomap("m_gap", "rg_map", "The coverage gap: empanelled hospitals in our data (blue) and not in it (purple government, orange private; half shown)", colors=X.C_GAP), 0, 4, 3, 13),
    (bar("b_gap_state", "rg_state", "state_name", "n", "Empanelled hospitals against those we hold, top 15 states", color="kind", layout="group"), 3, 4, 3, 13),
    (bar("b_gap_ratio", "rg_ratio", "state_name", "pct_in_our_data", "Share of each state's empanelled hospitals that are in our data (400+ empanelled)", horizontal=True, order=ratio_order), 0, 17, 3, 11),
    (bar("b_gap_dist", "rg_district", "district", "not_in_our_data", "Districts where the list holds the most hospitals we do not", horizontal=True, order=rgdist_order), 3, 17, 3, 11),
    (bar("b_gap_share", "rg_share", "source", "n", "Government against private: the list, our verified matches, and all our facilities", color="ownership", colors=X.C_OWNER, layout="stack-100"), 0, 28, 3, 9),
    (text("t_gap2", ["### What this shows\n", "\n",
                     "Only about 4% of empanelled hospitals appear in our data, and the share is lowest in Karnataka (1.4%), Telangana (1.8%), Chhattisgarh and Odisha (2.2%). "
                     "The list is about half government hospitals (20,842 of 39,737) while our verified matches are 93% private (1,350 of 1,452): the public system is the biggest hole in our data. "
                     "Pune, Jaipur and Lucknow each have over 300 empanelled hospitals we do not hold.\n"]), 3, 28, 3, 9),
])

_order = ["overview", "maps", "care", "need", "services", "quality", "trust", "registry", "gap"]
PAGES.sort(key=lambda p: _order.index(p["name"]))


def main():
    # every dataset query must run before anything is published
    bad = []
    for k, sql in DATASETS.items():
        try:
            n = len(run_sql.run(sql)["result"].get("data_array") or [])
            print(f"dataset {k:<16} ok ({n} rows in the first chunk)")
        except SystemExit as e:
            bad.append(k); print(f"dataset {k:<16} FAILED: {str(e)[:200]}")
    if bad:
        raise SystemExit(f"fix these datasets first: {bad}")

    dash = {"datasets": [{"name": k, "displayName": k, "queryLines": [v]} for k, v in DATASETS.items()], "pages": PAGES}
    body = {"display_name": TITLE, "warehouse_id": WH, "parent_path": "/Workspace/Hackathon", "serialized_dashboard": json.dumps(dash)}
    f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8"); json.dump(body, f); f.close()
    env = dict(os.environ, MSYS_NO_PATHCONV="1")
    r = subprocess.run(["databricks", "lakeview", "create", "--json", "@" + f.name], capture_output=True, text=True, encoding="utf-8", env=env)
    if r.returncode:
        raise SystemExit(r.stderr)
    did = json.loads(r.stdout)["dashboard_id"]
    p = subprocess.run(["databricks", "lakeview", "publish", did, "--warehouse-id", WH, "--embed-credentials"], capture_output=True, text=True, encoding="utf-8", env=env)
    print(p.stdout[-200:] or p.stderr)
    print("NEW dashboard id:", did)
    if not p.returncode and OLD_DASHBOARD:
        t = subprocess.run(["databricks", "lakeview", "trash", OLD_DASHBOARD], capture_output=True, text=True, encoding="utf-8", env=env)
        print("old dashboard trashed" if not t.returncode else "old dashboard not trashed: " + t.stderr[:200])


if __name__ == "__main__":
    main()
