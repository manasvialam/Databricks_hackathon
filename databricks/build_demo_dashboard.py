"""Demo dashboard: 'How we decide' (4 pages, built for a 2:30 walkthrough).

  1. Can raw data be trusted?   (what was wrong, and how many records survive each check)
  2. One question, traced       (pick a service + state; see the funnel, map, top picks and score breakdown)
  3. Is the evidence correct?   (claim audit, trust signals, scoring weights, evaluation)
  4. What we don't know         (care deserts, thin coverage, registry gap)

Usage:  python databricks/build_demo_dashboard.py test     # run every dataset query, no deploy
        python databricks/build_demo_dashboard.py deploy   # test, then create + publish a NEW dashboard
        python databricks/build_demo_dashboard.py update ID  # test, then update + publish an existing one
"""
import json
import os
import subprocess
import sys
import tempfile

WH = "cf80af6a5a0a8799"
CAT, SCH = "workspace", "facility_finder"
T = f"{CAT}.{SCH}"
TITLE = "Facility finder: how we decide (demo)"
PARENT = "/Workspace/Hackathon"
GENIE_SPACE = "01f1e62c1f1517e9be55e49dd25b42ed"

# ------------------------------------------------------------------------------------------------ palette
GOOD, BAD, WARN, GREY = "#009E73", "#D55E00", "#E69F00", "#9AA5B1"
BLUE, PINK = "#0072B2", "#CC79A7"
VERDICT_COLORS = {"Passes all checks": GOOD, "Claim ok, but a check failed": WARN, "Weak or contradicted": GREY}
LOC_COLORS = {"Verified on the map": GOOD, "Verified (OpenStreetMap)": GOOD, "Probable": "#56B4E9", "Only the PIN-code centre": WARN, "Unverified": BAD}
SUPPORT_COLORS = {"Quote supports the claim": GOOD, "Quote does not support it": BAD, "Unclear": GREY}
LEVEL_COLORS = {"Strong": GOOD, "Moderate": "#56B4E9", "Inferred": GREY, "Weak": WARN, "Contradicted": BAD}
MERGE_COLORS = {"Looks like one hospital": GOOD, "Watch": WARN, "May mix several hospitals": BAD}
BUCKET_COLORS = {"1 within 10 km": GOOD, "2 10 to 25 km": "#56B4E9", "3 25 to 50 km": "#F0E442", "4 50 to 100 km": WARN, "5 over 100 km": BAD}
COMPONENT_COLORS = {"Claim strength": BLUE, "Facility trust": GOOD, "Location trust": "#56B4E9", "Merge-suspect penalty": BAD}
KIND_COLORS = {"on a clean record": GOOD, "on a record that may mix facilities": BAD}


# (area, label, flag column in fac_final) : every one of these is a per-record check we ran
CHECKS = [
    ("Where is it?", "Coordinates over 100 km from the PIN-code centre", "flag_geo_mismatch_100km"),
    ("Where is it?", "District in record disagrees with the PIN directory", "flag_district_conflict"),
    ("Where is it?", "City disagrees with the PIN directory", "flag_city_mismatch"),
    ("Where is it?", "Coordinates fall in a different state", "flag_coord_state_mismatch"),
    ("Where is it?", "PIN code invalid", "flag_pin_invalid"),
    ("Where is it?", "Coordinates outside India", "flag_coords_outside_india"),
    ("Is it one hospital?", "Text names another hospital", "flag_names_other_hospital"),
    ("Is it one hospital?", "Website shared with an unrelated hospital", "flag_site_shared_unrelated"),
    ("Is it one hospital?", "Possible duplicate record", "flag_possible_duplicate"),
    ("Contact details", "Phone area code conflicts with the state", "flag_phone_area_code_conflict"),
    ("Contact details", "Official phone was a shared helpline", "flag_official_phone_shared_line"),
    ("Contact details", "No reliable phone left", "flag_no_usable_phone"),
    ("Contact details", "Email shared with an unrelated hospital", "flag_email_shared_unrelated"),
    ("Record quality", "Item list cut off at exactly 50", "flag_list_truncated"),
    ("Record quality", "Broken row repaired", "flag_repaired_record"),
    ("Record quality", "Implausible doctor count", "flag_doctors_extreme"),
]
AREA_COLORS = {"Where is it?": BLUE, "Is it one hospital?": BAD, "Contact details": WARN, "Record quality": PINK}
OWNER_COLORS = {"government": BLUE, "private": WARN}
OUTCOME_COLORS = {"Verified": GOOD, "Possible (not used as proof)": GREY}

# ------------------------------------------------------------------------------------------------ datasets
LOC_LABEL = """CASE location_trust WHEN 'verified' THEN 'Verified on the map' WHEN 'verified_osm' THEN 'Verified (OpenStreetMap)'
  WHEN 'probable' THEN 'Probable' WHEN 'approximate_pin' THEN 'Only the PIN-code centre' ELSE 'Unverified' END"""
LOC_OK = "location_trust IN ('verified', 'verified_osm', 'probable')"

# Per facility x service claim, with the pass/fail of each check. Everything else on pages 1-2 is built from this.
BASE = f"""
SELECT c.service, s.facility_id, s.name, s.city, s.state, s.district, s.lat, s.lon, c.level, c.claim_strength,
       s.location_trust, s.location_trust_score, s.merge_suspect_score, s.facility_trust,
       CASE s.location_trust WHEN 'verified' THEN 'Verified on the map' WHEN 'verified_osm' THEN 'Verified (OpenStreetMap)'
            WHEN 'probable' THEN 'Probable' WHEN 'approximate_pin' THEN 'Only the PIN-code centre' ELSE 'Unverified' END AS location_label,
       (c.level IN ('Strong', 'Moderate')) AS ok_claim,
       (s.location_trust IN ('verified', 'verified_osm', 'probable')) AS ok_loc,
       (s.merge_suspect_score < 2) AS ok_merge,
       (s.facility_trust >= 60) AS ok_trust,
       get(c.snippets, 0).text AS quote,
       regexp_extract(get(c.cite_urls, 0).url, 'https?://([^/]+)', 1) AS source_site,
       CASE WHEN get(c.cite_urls, 0).names_facility_in_url THEN 'Yes' ELSE 'No' END AS source_names_facility
FROM {T}.facility_claims c JOIN {T}.facilities_serving s ON c.facility_id = s.facility_id
"""

SCORED = f"""
WITH b AS ({BASE}),
r AS (
  SELECT *, CAST(0.4 * claim_strength AS DOUBLE) AS pts_claim, CAST(0.4 * facility_trust / 100.0 AS DOUBLE) AS pts_trust,
         CAST(0.2 * coalesce(location_trust_score, 0) AS DOUBLE) AS pts_loc, CAST(-0.1 * merge_suspect_score AS DOUBLE) AS pts_merge,
         0.4 * claim_strength + 0.4 * facility_trust / 100.0 + 0.2 * coalesce(location_trust_score, 0) - 0.1 * merge_suspect_score AS evidence_score
  FROM b WHERE ok_claim AND ok_loc AND ok_merge AND ok_trust
),
ranked AS (SELECT *, row_number() OVER (PARTITION BY service, state ORDER BY evidence_score DESC) AS rn FROM r)
"""

DATASETS = {
    # ---- page 1
    "ds_fac": f"""SELECT facility_id, state, facility_type, location_trust, {LOC_LABEL} AS location_label, facility_trust,
        CASE WHEN merge_suspect_score >= 2 THEN 'May mix several hospitals' WHEN merge_suspect_score >= 1 THEN 'Watch' ELSE 'Looks like one hospital' END AS merge_label,
        CASE WHEN merge_suspect_score >= 2 THEN 1 ELSE 0 END AS is_merge,
        CASE WHEN location_trust IN ('unverified', 'approximate_pin') THEN 1 ELSE 0 END AS loc_weak,
        CASE WHEN {LOC_OK} AND merge_suspect_score < 2 AND facility_trust >= 60 THEN 1 ELSE 0 END AS passes
      FROM {T}.facilities_serving""",
    "ds_funnel": f"""WITH s AS (SELECT s.facility_id, s.state, s.facility_type, s.location_trust, s.merge_suspect_score, s.facility_trust,
          (st.facility_id IS NOT NULL) AS has_strong
        FROM {T}.facilities_serving s LEFT JOIN (SELECT DISTINCT facility_id FROM {T}.facility_claims WHERE level = 'Strong') st ON s.facility_id = st.facility_id)
      SELECT '1 All records' AS stage, state, facility_type, facility_id FROM s
      UNION ALL SELECT '2 Position checked', state, facility_type, facility_id FROM s WHERE {LOC_OK}
      UNION ALL SELECT '3 Not a suspected merge', state, facility_type, facility_id FROM s WHERE {LOC_OK} AND merge_suspect_score < 2
      UNION ALL SELECT '4 Trust score 60+', state, facility_type, facility_id FROM s WHERE {LOC_OK} AND merge_suspect_score < 2 AND facility_trust >= 60
      UNION ALL SELECT '5 Has a Strong claim', state, facility_type, facility_id FROM s WHERE {LOC_OK} AND merge_suspect_score < 2 AND facility_trust >= 60 AND has_strong""",
    "ds_examples": f"""WITH st AS (
        SELECT facility_id, service, get(snippets, 0).text AS quote, regexp_extract(get(cite_urls, 0).url, 'https?://([^/]+)', 1) AS source_site,
               row_number() OVER (PARTITION BY facility_id ORDER BY claim_strength DESC) AS k
        FROM {T}.facility_claims WHERE level = 'Strong' AND facility_merge_suspect AND NOT coalesce(get(cite_urls, 0).names_facility_in_url, false))
      SELECT s.name, s.city AS listed_city, s.state AS state_on_map, s.merge_suspect_score AS merge_red_flags, s.facility_trust,
             st.service AS strong_claim, st.quote, st.source_site
      FROM {T}.facilities_serving s JOIN st ON s.facility_id = st.facility_id AND st.k = 1
      WHERE s.merge_suspect_score >= 3 AND s.location_trust = 'unverified' AND st.quote IS NOT NULL
      ORDER BY s.n_claims DESC LIMIT 8""",
    # ---- page 2
    "ds_trace": BASE + "",
    "ds_trace_funnel": f"""WITH b AS ({BASE})
      SELECT '1 Claims this service' AS stage, service, state, facility_id FROM b
      UNION ALL SELECT '2 Evidence Strong or Moderate', service, state, facility_id FROM b WHERE ok_claim
      UNION ALL SELECT '3 Position checked', service, state, facility_id FROM b WHERE ok_claim AND ok_loc
      UNION ALL SELECT '4 Not a suspected merge', service, state, facility_id FROM b WHERE ok_claim AND ok_loc AND ok_merge
      UNION ALL SELECT '5 Trust score 60+', service, state, facility_id FROM b WHERE ok_claim AND ok_loc AND ok_merge AND ok_trust""",
    "ds_map": f"""WITH b AS ({BASE})
      SELECT service, state, name, lat, lon,
             CASE WHEN ok_claim AND ok_loc AND ok_merge AND ok_trust THEN 'Passes all checks' WHEN ok_claim THEN 'Claim ok, but a check failed' ELSE 'Weak or contradicted' END AS verdict
      FROM b WHERE lat IS NOT NULL""",
    "ds_top": SCORED + """SELECT service, state, rn AS rank, name, city, level, round(evidence_score, 2) AS evidence_score, facility_trust, location_label,
        quote, source_site, source_names_facility FROM ranked WHERE rn <= 10""",
    "ds_break": SCORED + """SELECT service, state, concat(rn, '. ', name) AS facility, stack(4, 'Claim strength', pts_claim, 'Facility trust', pts_trust,
        'Location trust', pts_loc, 'Merge-suspect penalty', pts_merge) AS (component, points) FROM ranked WHERE rn <= 5""",
    # ---- page 3
    "ds_audit": f"""SELECT level, 'Quote supports the claim' AS verdict, share_yes AS share, audited FROM {T}.claim_audit_summary
      UNION ALL SELECT level, 'Quote does not support it', share_no, audited FROM {T}.claim_audit_summary
      UNION ALL SELECT level, 'Unclear', share_unclear, audited FROM {T}.claim_audit_summary""",
    "ds_domains": f"""SELECT least(n_independent_domains, 6) AS independent_sources, round(avg(facility_trust), 1) AS avg_trust, count(*) AS facilities
      FROM {T}.v_eda_trust WHERE n_independent_domains IS NOT NULL GROUP BY 1""",
    "ds_levelmerge": f"""SELECT level, CASE WHEN facility_merge_suspect THEN 'on a record that may mix facilities' ELSE 'on a clean record' END AS kind, count(*) AS n
      FROM {T}.facility_claims GROUP BY 1, 2""",
    "ds_signals": """SELECT * FROM VALUES
        (1, 'Evidence level: Strong', 'starts at 72%', 'The facility text names the service in several fields'),
        (2, 'Evidence level: Moderate', 'starts at 50%', 'One field names it'),
        (3, 'Evidence level: Weak', 'starts at 20%', 'A passing mention only'),
        (4, 'Another field agrees', 'up', 'Each extra field that agrees, up to three'),
        (5, 'Prerequisite missing (e.g. NICU with no neonatologist)', 'down, strongly', 'Claim is implausible without it'),
        (6, 'Text contradicts the claim', 'down, strongly', 'Each contradiction, up to two'),
        (7, 'Record may mix several hospitals', 'down', 'Each red flag lowers the whole record'),
        (8, 'Source page names the facility', 'up', 'A page about this hospital, not another'),
        (9, 'Verified match on the national PM-JAY list', 'up (capped)', 'Independent proof the hospital exists; cannot rescue weak evidence')
      AS t(step, signal, effect, why)""",
    "ds_eval": """SELECT test, passed, total, passed / total AS pass_rate FROM (SELECT * FROM VALUES
        ('Real emergencies recognised', 22, 22), ('Non-emergencies left alone (no false alarm)', 11, 11), ('Recommendation test queries passed', 11, 12)
      AS t(test, passed, total))""",
    # ---- page 4
    "ds_desert": f"""SELECT service, CASE WHEN km <= 10 THEN '1 within 10 km' WHEN km <= 25 THEN '2 10 to 25 km' WHEN km <= 50 THEN '3 25 to 50 km'
        WHEN km <= 100 THEN '4 50 to 100 km' ELSE '5 over 100 km' END AS bucket, count(*) AS n FROM {T}.eda_office_service_km GROUP BY 1, 2""",
    "ds_thin": f"SELECT state, count(*) AS facilities FROM {T}.facilities_serving WHERE state IS NOT NULL GROUP BY 1 ORDER BY 2 ASC LIMIT 10",
    "ds_reg": f"""SELECT sum(CASE WHEN tier = 'verified' THEN 1 ELSE 0 END) AS verified, count(*) AS candidates FROM {T}.registry_match""",
    # ---- page 5: validation log (live flags + figures from the cleaning-run reports)
    "ds_checks": " UNION ALL ".join(
        f"SELECT '{a}' AS area, '{l}' AS `check`, sum(CASE WHEN {c} THEN 1 ELSE 0 END) AS n FROM {T}.fac_final"
        for a, l, c in CHECKS) + f" UNION ALL SELECT 'Is it one hospital?', 'Two or more merge red flags (record may blend hospitals)', sum(CASE WHEN merge_suspect_score >= 2 THEN 1 ELSE 0 END) FROM {T}.facilities_serving",
    "ds_phone_kpi": "SELECT 39249 AS checked, 414 AS repaired, 2615 AS set_aside, 1587 AS hospitals_cleaner, 343 AS no_reliable_phone",
    "ds_phone": """SELECT * FROM VALUES ('Booking or aggregator lines', 1175), ('Shared with an unrelated hospital', 1057), ('Landline from the wrong state', 229),
        ('Fake numbers such as 9999999999', 37), ('Invalid or foreign numbers', 60), ('Other (not itemised in the report)', 57) AS t(reason, numbers)""",
    "ds_items": """SELECT * FROM VALUES ('Not about services (addresses, hours, history)', 33860), ('Non-medical (wheelchair access, parking)', 3716),
        ('Described a different hospital', 3282), ('Repeats within the same list', 3058), ('Empty placeholders ("none", "-")', 1006) AS t(reason, items)""",
    "ds_rules": """SELECT * FROM VALUES
        (1, 'Booking or directory sites only', 'Claims capped at Weak', '965 claims lowered (1,818 hospitals appear only on such sites)'),
        (2, 'Facility type or missing support clashes with the claim', 'Marked Contradicted', '369 claims (e.g. a clinic listing an ICU)'),
        (3, 'Record may contain another hospital', 'Marked "confirm first"', '2,264 claims on 445 hospitals'),
        (4, 'C-section not stated, but obstetrics + operating theatre + anaesthesia listed', 'Marked Inferred', '339 hospitals'),
        (5, 'Item list stops at exactly 50', 'A missing service may be missing data', '3,226 hospitals (32%)'),
        (6, 'No service evidence at all', 'Shown as Unknown, never as "offers nothing"', '3,263 hospitals')
      AS t(step, situation, what_we_do, how_many)""",
    # ---- page 6: government registry (HEM / PM-JAY)
    "ds_reg_kpi": f"""SELECT sum(CASE WHEN tier = 'verified' THEN 1 ELSE 0 END) AS verified, sum(CASE WHEN tier = 'possible' THEN 1 ELSE 0 END) AS possible,
        sum(CASE WHEN badge_eligible THEN 1 ELSE 0 END) AS badge_eligible, (SELECT count(*) FROM {T}.hem_hospitals) AS national_list FROM {T}.registry_match""",
    "ds_reg_method": f"""SELECT CASE method WHEN 'name+place' THEN 'Name and place agree' WHEN 'phone+name' THEN 'Phone and name agree' WHEN 'weak' THEN 'Weak: needs a person to check'
        ELSE 'Agrees, but phone is shared' END AS how_matched, CASE tier WHEN 'verified' THEN 'Verified' ELSE 'Possible (not used as proof)' END AS outcome, count(*) AS n
      FROM {T}.registry_match GROUP BY 1, 2""",
    "ds_reg_km": f"""SELECT CASE WHEN km <= 1 THEN '1 within 1 km' WHEN km <= 5 THEN '2 1 to 5 km' WHEN km <= 25 THEN '3 5 to 25 km' ELSE '4 over 25 km' END AS distance, count(*) AS n
      FROM {T}.registry_match WHERE tier = 'verified' AND km IS NOT NULL GROUP BY 1""",
    "ds_reg_owner": f"""SELECT 'National list (39,737)' AS source, ownership, count(*) AS n FROM {T}.hem_hospitals GROUP BY 2
      UNION ALL SELECT 'Verified matches in our data', ownership, count(*) FROM {T}.registry_match WHERE tier = 'verified' GROUP BY 2""",
    "ds_reg_signals": """SELECT * FROM VALUES
        (1, 'Verified match on the national list', '+0.5', 'Independent proof the hospital exists'),
        (2, 'The list names a specialty package that maps to this service', '+0.8', 'Independent evidence for the service itself'),
        (3, 'NABH accredited / trauma-burn unit on the list', '+0.15', 'Extra recognition'),
        (4, 'All registry evidence together', 'capped at +1.2', 'It can never turn Weak evidence into a recommendation')
      AS t(step, signal, effect, why)""",
}


# ------------------------------------------------------------------------------------------------ widget builders
def fld(name, expr=None):
    return {"name": name, "expression": expr or f"`{name}`"}


def mappings(d):
    return [{"value": k, "color": v} for k, v in d.items()]


def widget(name, ds, fields, spec, title, disaggregated=True, version=3, desc=None):
    frame = {"showTitle": True, "title": title}
    if desc:
        frame.update({"showDescription": True, "description": desc})
    return {"name": name, "queries": [{"name": "main_query", "query": {"datasetName": ds, "fields": fields, "disaggregated": disaggregated}}],
            "spec": {"version": version, **spec, "frame": frame}}


def text(name, lines):
    return {"name": name, "multilineTextboxSpec": {"lines": lines if isinstance(lines, list) else [lines]}}


def counter(name, ds, field, expr, title, desc=None):
    return widget(name, ds, [fld(field, expr)], {"widgetType": "counter", "encodings": {"value": {"fieldName": field, "displayName": title}}},
                  title, disaggregated=False, version=2, desc=desc)


def bar(name, ds, cat, val, title, val_expr, color=None, colors=None, horizontal=False, order=None, layout=None, cat_label=None, val_label=None, desc=None, fmt=None):
    c = {"fieldName": cat, "scale": {"type": "categorical", **({"sort": {"by": "custom-order", "orderedValues": order}} if order else {})}, "displayName": cat_label or cat}
    v = {"fieldName": val, "scale": {"type": "quantitative"}, "displayName": val_label or val}
    if fmt:
        v["format"] = fmt
    enc = {"x": v, "y": c} if horizontal else {"x": c, "y": v}
    fields = [fld(cat), fld(val, val_expr)]
    if color:
        enc["color"] = {"fieldName": color, "scale": {"type": "categorical", **({"mappings": mappings(colors)} if colors else {})}, "displayName": color}
        fields.append(fld(color))
    spec = {"widgetType": "bar", "encodings": enc}
    if layout:
        spec["mark"] = {"layout": layout}
    return widget(name, ds, fields, spec, title, disaggregated=False, desc=desc)


def geomap(name, ds, title, colors, color_field="verdict", desc=None):
    enc = {"coordinates": {"latitude": {"fieldName": "lat"}, "longitude": {"fieldName": "lon"}},
           "color": {"fieldName": color_field, "scale": {"type": "categorical", "mappings": mappings(colors)}}}
    return widget(name, ds, [fld("lat"), fld("lon"), fld(color_field)], {"widgetType": "symbol-map", "encodings": enc, "mark": {"opacity": 0.8}}, title, version=2, desc=desc)


def table(name, ds, cols, title, desc=None, order=None):
    """cols: [(field, label)]"""
    w = widget(name, ds, [fld(f) for f, _ in cols], {"widgetType": "table", "encodings": {"columns": [{"fieldName": f, "displayName": l} for f, l in cols]}},
               title, version=2, desc=desc)
    if order:
        w["queries"][0]["query"]["orders"] = [{"direction": d, "expression": f"`{f}`"} for f, d in order]
    return w


def filt(name, kind, title, binds, default=None):
    """binds: [(dataset, field)] ; one query per dataset so the filter reaches every widget that has the field."""
    queries, fields = [], []
    for i, (ds, f) in enumerate(binds):
        qn = f"{name}_q{i}"
        queries.append({"name": qn, "query": {"datasetName": ds, "fields": [fld(f)], "disaggregated": False}})
        fields.append({"fieldName": f, "displayName": title, "queryName": qn})
    spec = {"version": 2, "widgetType": kind, "encodings": {"fields": fields}, "frame": {"showTitle": True, "title": title}}
    if default:
        spec["selection"] = {"defaultSelection": {"values": {"dataType": "STRING", "values": [{"value": v} for v in default]}}}
    return {"name": name, "queries": queries, "spec": spec}


def page(name, title, items):
    return {"name": name, "displayName": title, "pageType": "PAGE_TYPE_CANVAS", "layoutVersion": "GRID_V1",
            "layout": [{"widget": w, "position": {"x": x, "y": y, "width": wd, "height": h}} for (w, x, y, wd, h) in items]}


def pct(places=0):
    return {"type": "number-percent", "decimalPlaces": {"type": "max", "places": places}}


# ------------------------------------------------------------------------------------------------ pages
SERVICE_NOTE = "Pick a service and a state in the filters. Every chart on this page re-draws."

P1 = page("trust", "1. Can raw data be trusted?", [
    (text("t1", ["## 1. The raw records cannot be taken at face value\n",
                 "Most of the data was scraped from web text. A facility *saying* it offers a service is not the same as offering it. "
                 "So we scored every record on **where it is**, **whether it is really one hospital**, and **how well its claims are evidenced**.\n"]), 0, 0, 12, 2),
    (filt("f_state1", "filter-multi-select", "State (optional)", [("ds_fac", "state"), ("ds_funnel", "state")]), 0, 2, 4, 2),
    (counter("k_all", "ds_fac", "count(facility_id)", "COUNT(`facility_id`)", "Facilities in the data"), 0, 4, 3, 3),
    (counter("k_merge", "ds_fac", "sum(is_merge)", "SUM(`is_merge`)", "May mix several hospitals", "Two or more red flags that one record blends different facilities"), 3, 4, 3, 3),
    (counter("k_loc", "ds_fac", "sum(loc_weak)", "SUM(`loc_weak`)", "Position not verified", "Only the PIN-code centre, or nothing to check the coordinates against"), 6, 4, 3, 3),
    (counter("k_pass", "ds_fac", "sum(passes)", "SUM(`passes`)", "Pass every check", "Position checked, not a suspected merge, trust score 60 or more"), 9, 4, 3, 3),
    (bar("b_funnel", "ds_funnel", "stage", "count(facility_id)", "How many records survive each check", "COUNT(`facility_id`)", horizontal=True,
         order=["1 All records", "2 Position checked", "3 Not a suspected merge", "4 Trust score 60+", "5 Has a Strong claim"], cat_label="Check", val_label="Facilities",
         desc="Each bar adds one more check to the one above it"), 0, 7, 6, 7),
    (bar("b_loc", "ds_fac", "location_label", "count(facility_id)", "Can we trust the map position?", "COUNT(`facility_id`)", color="location_label", colors=LOC_COLORS,
         order=["Verified on the map", "Verified (OpenStreetMap)", "Probable", "Only the PIN-code centre", "Unverified"], cat_label="Position", val_label="Facilities"), 6, 7, 6, 7),
    (text("t1b", ["### A record that looks confident but is not\n",
                  "Each row has a **Strong** claim, but the cited page does not name this facility and the record carries several merge red flags, so the claim may belong to another hospital. "
                  "This is what the checks above remove from the ranking."]), 0, 14, 12, 2),
    (table("tb_ex", "ds_examples", [("name", "Facility"), ("listed_city", "City in record"), ("state_on_map", "State where the pin lands"), ("merge_red_flags", "Merge red flags"),
                                      ("facility_trust", "Trust (0-100)"), ("strong_claim", "Strong claim"), ("quote", "Quoted text"), ("source_site", "Source site")],
           "Strong claims that we do not trust"), 0, 16, 12, 7),
])

P2 = page("trace", "2. One question, traced", [
    (text("t2", ["## 2. One question, traced end to end\n", SERVICE_NOTE + " Evidence score = 40% claim strength + 40% facility trust + 20% position trust, minus a merge penalty. "
                 "*Distance is not included here: the app adds live travel time and a Monte-Carlo P(best).*\n"]), 0, 0, 12, 2),
    (filt("f_service", "filter-single-select", "Service", [("ds_trace_funnel", "service"), ("ds_map", "service"), ("ds_top", "service"), ("ds_break", "service")], default=["dialysis"]), 0, 2, 4, 2),
    (filt("f_state2", "filter-multi-select", "State", [("ds_trace_funnel", "state"), ("ds_map", "state"), ("ds_top", "state"), ("ds_break", "state")], default=["TAMIL NADU"]), 4, 2, 4, 2),
    (bar("b_tf", "ds_trace_funnel", "stage", "count(facility_id)", "From every claim to the ones we would recommend", "COUNT(`facility_id`)", horizontal=True, cat_label="Check", val_label="Facilities",
         order=["1 Claims this service", "2 Evidence Strong or Moderate", "3 Position checked", "4 Not a suspected merge", "5 Trust score 60+"]), 0, 4, 6, 7),
    (geomap("m_trace", "ds_map", "Where they are: green passes every check", VERDICT_COLORS), 6, 4, 6, 7),
    (table("tb_top", "ds_top", [("rank", "#"), ("name", "Facility"), ("city", "City"), ("level", "Evidence"), ("evidence_score", "Score"), ("facility_trust", "Trust"),
                                ("location_label", "Position"), ("quote", "Quote from the facility's own text"), ("source_site", "Source"), ("source_names_facility", "Source names the facility?")],
           "Top picks, with the quote that justifies each", order=[("rank", "ASC")]), 0, 11, 12, 8),
    (bar("b_break", "ds_break", "facility", "sum(points)", "Why #1 beats #5: what each score is made of", "SUM(`points`)", color="component", colors=COMPONENT_COLORS, horizontal=True,
         layout="stack", cat_label="Facility", val_label="Points"), 0, 19, 12, 7),
])

P3 = page("evidence", "3. Is the evidence correct?", [
    (text("t3", ["## 3. How do we know the evidence is right?\n",
                 "We checked a sample of claims by asking a language model whether the **quoted text really supports the claim**. "
                 "Strong claims hold up best: 72% are supported by their own quote and only 6% are not.\n"]), 0, 0, 12, 2),
    (bar("b_audit", "ds_audit", "level", "sum(share)", "Does the quote support the claim? (150 audited per level)", "SUM(`share`)", color="verdict", colors=SUPPORT_COLORS,
         layout="stack-100", order=["Strong", "Moderate", "Weak"], cat_label="Evidence level", val_label="Share of audited claims", fmt=pct(0)), 0, 2, 6, 7),
    (bar("b_lm", "ds_levelmerge", "level", "sum(n)", "Strong claims on records that may blend several hospitals", "SUM(`n`)", color="kind", colors=KIND_COLORS,
         layout="stack-100", order=["Strong", "Moderate", "Inferred", "Weak", "Contradicted"], cat_label="Evidence level", val_label="Share of claims", fmt=pct(0)), 6, 2, 6, 7),
    (bar("b_dom", "ds_domains", "independent_sources", "avg_trust", "More independent sources, higher trust", "AVG(`avg_trust`)", cat_label="Independent websites (6 = six or more)",
         val_label="Average trust (0-100)"), 0, 9, 6, 7),
    (table("tb_sig", "ds_signals", [("step", "#"), ("signal", "What we look at"), ("effect", "Effect on the chance the claim is real"), ("why", "Why")],
           "How a claim becomes a probability", order=[("step", "ASC")]), 6, 9, 6, 7),
    (bar("b_eval", "ds_eval", "test", "max(pass_rate)", "Does the app behave? Share of labelled test cases passed", "MAX(`pass_rate`)", horizontal=True, cat_label="Test", val_label="Passed", fmt=pct(0),
         desc="22 of 22 emergencies recognised, 11 of 11 non-emergencies left alone, 11 of 12 recommendation queries"), 0, 16, 12, 5),
])


# ================================================================================================ page 4: the reference page
def q(t):
    return str(t).replace("'", "''")


def L(expr):
    """a live number: a scalar query over the real tables"""
    return f"({expr})"


FF = f"{T}.fac_final"
LIVE, REPORT, TEAM = "Counted from the data", "From a report in the repo", "Team summary (not in the repo)"
CNT = lambda col: L(f"SELECT sum(CASE WHEN {col} THEN 1 ELSE 0 END) FROM {FF}")

# (stage, step, number, unit, what we did, where it comes from, how the number was obtained)
LEDGER = [
    ("1 Read and repair the file", "Rows parsed (a normal read crashes: quotes are escaped in a non-standard way)", 10088, "rows", "Read with the file's own escape rule", "Person_1/output/run_stats.json", REPORT),
    ("1 Read and repair the file", "Broken fragments: pieces of 30 real records", 88, "rows", "Set aside, then used to stitch the records back", "Person_1/output/run_stats.json", REPORT),
    ("1 Read and repair the file", "Truncated records repaired", CNT("flag_repaired_record"), "hospitals", "Stitched back together: 30 of 30 recovered", "Person_1/PERSON1_REPORT.md section 1", LIVE),
    ("1 Read and repair the file", "Exact duplicate rows", 11, "rows", "Dropped (byte-identical copies)", "Person_1/output/run_stats.json", REPORT),
    ("1 Read and repair the file", "Item lists cut off at exactly 50", CNT("flag_list_truncated"), "hospitals", "Flagged: a missing service may just be missing data", "Person_1/PERSON1_REPORT.md section 3", LIVE),
    ("1 Read and repair the file", "Specialty spellings merged into one vocabulary", 451, "spellings", "Mapped to one name each", "Person_1/PERSON1_REPORT.md section 3", REPORT),
    ("1 Read and repair the file", "Dead or redundant columns", 9, "columns", "Kept in raw, left out of the model", "Person_1/PERSON1_REPORT.md section 3", REPORT),
    ("1 Read and repair the file", "Impossible founding years (0, 7, 15)", 5, "rows", "Removed; original kept in raw_yearEstablished", "Person_1/PERSON1_REPORT.md section 3", REPORT),
    ("1 Read and repair the file", "Names with an address inside", 121, "names", "display_name shortened; the original name is unchanged", "Person_1/PERSON1_REPORT.md section 3", REPORT),
    ("2 Where is it?", "Coordinates over 100 km from the PIN-code centre", CNT("flag_geo_mismatch_100km"), "hospitals", "Flagged; location trust lowered", "Person_2/README.md", LIVE),
    ("2 Where is it?", "District in the record disagrees with the PIN directory", CNT("flag_district_conflict"), "hospitals", "Flagged", "Person_2/README.md", LIVE),
    ("2 Where is it?", "City disagrees with the PIN directory", CNT("flag_city_mismatch"), "hospitals", "Flagged", "Person_2/README.md", LIVE),
    ("2 Where is it?", "Coordinates fall in a different state", CNT("flag_coord_state_mismatch"), "hospitals", "Flagged", "Person_2/README.md", LIVE),
    ("2 Where is it?", "PIN not in the India Post directory", CNT("flag_pin_invalid"), "hospitals", "Flagged; fall back to the city", "Person_2/README.md", LIVE),
    ("2 Where is it?", "PIN malformed or spaced, reformatted", CNT("flag_pin_reformatted"), "hospitals", "Fixed", "Person_2/README.md", LIVE),
    ("2 Where is it?", "Coordinates outside India", CNT("flag_coords_outside_india"), "hospitals", "Blanked", "Person_2/README.md", LIVE),
    ("2 Where is it?", "OpenStreetMap places downloaded (hospitals, clinics, doctors, dentists)", 87469, "places", "Independent check on coordinates", "Person_2/README.md", REPORT),
    ("2 Where is it?", "Hospitals matched to an OpenStreetMap place (name 80%+ similar, within 2 km)", 3379, "hospitals", "Counts as corroboration; a miss is not evidence of a wrong location", "Person_2/README.md", REPORT),
    ("2 Where is it?", "Coordinate-vs-PIN conflicts OpenStreetMap could settle (609 sided with coordinates, 190 with the PIN)", 799, "hospitals", "OpenStreetMap decides the location", "Person_2/README.md", REPORT),
    ("3 Phones and contacts", "Phone numbers checked", L(f"SELECT sum(n_phone_valid) + sum(n_phone_invalid) FROM {FF}"), "numbers", "Parsed against the Indian numbering plan", "facilities_final: n_phone_valid, n_phone_invalid", LIVE),
    ("3 Phones and contacts", "Numbers kept as usable", L(f"SELECT sum(n_phone_usable) FROM {FF}"), "numbers", "Valid, not shared, area code matches", "facilities_final: n_phone_usable", LIVE),
    ("3 Phones and contacts", "Fake placeholder numbers (e.g. 9999999999)", L(f"SELECT sum(n_phone_placeholder) FROM {FF}"), "numbers", "Set aside", "facilities_final: n_phone_placeholder", LIVE),
    ("3 Phones and contacts", "Official phone was a booking or aggregator line", L(f"SELECT count(*) FROM {FF} WHERE official_phone_status = 'aggregator_line'"), "hospitals", "Never trusted as the hospital's own", "facilities_final: official_phone_status", LIVE),
    ("3 Phones and contacts", "Official phone was a chain helpline", L(f"SELECT count(*) FROM {FF} WHERE official_phone_status = 'chain_helpline'"), "hospitals", "Never trusted as the hospital's own", "facilities_final: official_phone_status", LIVE),
    ("3 Phones and contacts", "Landline area code belongs to another state", CNT("flag_phone_area_code_conflict"), "hospitals", "Flagged", "facilities_final: flag_phone_area_code_conflict", LIVE),
    ("3 Phones and contacts", "Hospitals left with no reliable phone", CNT("flag_no_usable_phone"), "hospitals", "The app says so instead of showing a wrong number", "facilities_final: flag_no_usable_phone", LIVE),
    ("3 Phones and contacts", "Toll-free numbers repaired (lost the leading 1, saved as American, stray +1)", 414, "numbers", "Repaired", "Team summary (Person 3)", TEAM),
    ("3 Phones and contacts", "Hospitals that no longer show a wrong or misleading number", 1587, "hospitals", "Wrong numbers removed", "Team summary (Person 3)", TEAM),
    ("4 One hospital or several?", "Records with at least 1 merge red flag", L(f"SELECT count(*) FROM {T}.facilities_serving WHERE merge_suspect_score >= 1"), "hospitals", "Watch", "facilities_final: merge_suspect_score", LIVE),
    ("4 One hospital or several?", "Records with 2 or more merge red flags (may blend hospitals)", L(f"SELECT count(*) FROM {T}.facilities_serving WHERE merge_suspect_score >= 2"), "hospitals", "Claims marked 'confirm first'; score lowered", "facilities_final: merge_suspect_score", LIVE),
    ("4 One hospital or several?", "Records with 3 or more merge red flags", L(f"SELECT count(*) FROM {T}.facilities_serving WHERE merge_suspect_score >= 3"), "hospitals", "Strongest warning", "facilities_final: merge_suspect_score", LIVE),
    ("4 One hospital or several?", "Cited pages name a different business (aggregator slug mismatch)", CNT("foreign_sources"), "hospitals", "Flagged", "RED_FLAGS_AND_VALIDATION.md (E3)", LIVE),
    ("4 One hospital or several?", "Text names a different hospital", CNT("flag_names_other_hospital"), "hospitals", "Those sentences dropped from the evidence", "RED_FLAGS_AND_VALIDATION.md (G9)", LIVE),
    ("4 One hospital or several?", "Website shared with an unrelated hospital", CNT("flag_site_shared_unrelated"), "hospitals", "Flagged", "RED_FLAGS_AND_VALIDATION.md (D6)", LIVE),
    ("4 One hospital or several?", "Website is a directory page, not the hospital's own", CNT("flag_site_not_own_domain"), "hospitals", "Flagged", "RED_FLAGS_AND_VALIDATION.md (D5)", LIVE),
    ("4 One hospital or several?", "Possible duplicate record", CNT("flag_possible_duplicate"), "hospitals", "Flagged", "RED_FLAGS_AND_VALIDATION.md (I1)", LIVE),
    ("5 Numbers and dates", "Doctor counts over 1,000", CNT("flag_doctors_extreme"), "hospitals", "Kept, flagged, checked on the web", "Person_1/PERSON1_REPORT.md section 4.5", LIVE),
    ("5 Numbers and dates", "Bed counts over 3,000", CNT("flag_capacity_extreme"), "hospitals", "Kept, flagged, checked on the web", "Person_1/PERSON1_REPORT.md section 4.5", LIVE),
    ("5 Numbers and dates", "Hospitals and medical schools on Wikidata (outside source)", 3105, "records", "Used to check founding year and beds", "Person_1/output/verification_stats.json", REPORT),
    ("5 Numbers and dates", "Facilities matched to Wikidata (names agree AND within 15 km)", 285, "hospitals", "Audit of the matching: 50 of 50 and 29 of 30 correct; 4 doubtful ones rejected", "Person_1/PERSON1_REPORT.md section 4.1", REPORT),
    ("5 Numbers and dates", "Founding years confirmed by Wikidata", L(f"SELECT count(*) FROM {FF} WHERE year_check = 'confirmed (Wikidata)'"), "hospitals", "Marked confirmed", "facilities_final: year_check", LIVE),
    ("5 Numbers and dates", "Founding years that conflict with the facility's own text", L(f"SELECT count(*) FROM {FF} WHERE year_check = 'conflicts with own text'"), "hospitals", "Flagged", "facilities_final: year_check", LIVE),
    ("5 Numbers and dates", "Founding years disputed: record vs Wikidata", L(f"SELECT count(*) FROM {FF} WHERE year_check LIKE 'disputed%'"), "hospitals", "Both values shown; not overwritten, because Wikidata is sometimes the wrong one", "facilities_final: year_check", LIVE),
    ("5 Numbers and dates", "Extreme values checked on the web (2 confirmed, 8 contradicted, 2 chain-wide, 3 unverified)", 15, "values", "Values kept; the verdict is shown next to the number", "Person_1/PERSON1_REPORT.md section 4.5", REPORT),
    ("6 Services and claims", "Service claims built (15 services)", L(f"SELECT count(*) FROM {T}.facility_claims"), "claims", "Each keeps its quote, field and source link", "facilities_final: claims", LIVE),
    ("6 Services and claims", "Hospitals with Moderate or stronger evidence for a service", L(f"SELECT count(DISTINCT facility_id) FROM {T}.facility_claims WHERE level IN ('Strong', 'Moderate')"), "hospitals", "Can be recommended", "facilities_final: claims", LIVE),
    ("6 Services and claims", "Hospitals with only weak or inferred claims", L(f"SELECT count(DISTINCT facility_id) FROM {T}.facility_claims") + f" - (SELECT count(DISTINCT facility_id) FROM {T}.facility_claims WHERE level IN ('Strong', 'Moderate'))", "hospitals", "Shown, never picked", "facilities_final: claims", LIVE),
    ("6 Services and claims", "Hospitals with no usable service evidence", L(f"SELECT count(*) FROM {T}.facilities_serving s WHERE NOT EXISTS (SELECT 1 FROM {T}.facility_claims c WHERE c.facility_id = s.facility_id)"), "hospitals", "Shown as Unknown, not as 'offers nothing'", "facilities_final: n_claims", LIVE),
    ("6 Services and claims", "Claims contradicted by other facts (e.g. a clinic listing an ICU)", L(f"SELECT count(*) FROM {T}.facility_claims WHERE level = 'Contradicted'"), "claims", "Level set to Contradicted", "facilities_final: claims", LIVE),
    ("6 Services and claims", "Service items listed by hospitals (9,959 of them)", 433060, "items", "Original lists untouched; cleaned copies written alongside", "Team summary (Person 4)", TEAM),
    ("6 Services and claims", "Items that were not about services (addresses, hours, history, staff counts)", 33860, "items", "Moved to their own column", "Team summary (Person 4)", TEAM),
    ("6 Services and claims", "Non-medical features (wheelchair access, parking)", 3716, "items", "Left out of the service evidence", "Team summary (Person 4)", TEAM),
    ("6 Services and claims", "Items describing a different hospital (on 1,416 hospitals)", 3282, "items", "Left out of the service evidence", "Team summary (Person 4)", TEAM),
    ("6 Services and claims", "Repeats and empty placeholders", 4064, "items", "Removed (3,058 repeats + 1,006 placeholders)", "Team summary (Person 4)", TEAM),
    ("6 Services and claims", "Claims lowered because the hospital appears only on booking or directory sites", 965, "claims", "Capped at Weak (1,818 hospitals are directory-only)", "Team summary (Person 4)", TEAM),
    ("6 Services and claims", "Claims on records that may contain another hospital (445 hospitals)", 2264, "claims", "Marked 'confirm first'", "Team summary (Person 4)", TEAM),
    ("6 Services and claims", "C-sections not stated but implied (obstetrics + theatre + anaesthesia)", 339, "hospitals", "Marked Inferred", "Team summary (Person 4)", TEAM),
    ("7 Government registry (HEM)", "Hospitals on the national PM-JAY list (HEM)", L(f"SELECT count(*) FROM {T}.hem_hospitals"), "hospitals", "Independent reference, not scraped from the web", "scripts/out/registry_match_summary.json", LIVE),
    ("7 Government registry (HEM)", "Our hospitals verified against it", L(f"SELECT count(*) FROM {T}.registry_match WHERE tier = 'verified'"), "hospitals", "Name + place agree, or phone + name agree", "scripts/build_registry_match.py", LIVE),
    ("7 Government registry (HEM)", "Possible matches (weak, or phone shared)", L(f"SELECT count(*) FROM {T}.registry_match WHERE tier = 'possible'"), "hospitals", "Shown as unconfirmed; never used as proof", "scripts/build_registry_match.py", LIVE),
    ("7 Government registry (HEM)", "Helpline numbers on the list ignored when matching by phone", 129, "numbers", "Ignored", "scripts/out/registry_match_summary.json", REPORT),
]


_COUNTS = {}


def count_now(expr):
    """Count one ledger number from the real tables (done once, when this script runs)."""
    if expr not in _COUNTS:
        body = json.dumps({"warehouse_id": WH, "statement": "SELECT CAST(" + expr + " AS BIGINT)", "wait_timeout": "50s"})
        r = json.loads(subprocess.run(["databricks", "api", "post", "/api/2.0/sql/statements", "--json", body], capture_output=True, text=True).stdout)
        if r["status"]["state"] != "SUCCEEDED":
            raise SystemExit(f"ledger count failed: {expr[:120]} -> {r['status'].get('error', {}).get('message', '')[:200]}")
        _COUNTS[expr] = int(r["result"]["data_array"][0][0])
    return _COUNTS[expr]


def ledger_sql(where=""):
    parts = []
    for stage, step, n, unit, did, src, how in LEDGER:
        n = count_now(n) if isinstance(n, str) else n
        parts.append(f"SELECT '{q(stage)}' AS stage, '{q(step)}' AS step, CAST({n} AS BIGINT) AS n, '{unit}' AS unit, '{q(did)}' AS what_we_did, "
                     f"'{q(src)}' AS source_file, '{how}' AS number_is")
    sql = " UNION ALL ".join(parts)
    return f"SELECT * FROM ({sql}) WHERE {where}" if where else sql


FLAG_SELECTS = " UNION ALL ".join(
    f"SELECT '{a}' AS area, '{l}' AS check_name, unique_id FROM {FF} WHERE {c}" for a, l, c in CHECKS)

REPORT_DATASETS = {
    "ds_ledger": ledger_sql(),
    "ds_rows": "SELECT 10088 AS parsed, 88 AS fragments, 11 AS duplicates, 9989 AS final_rows",
    "ds_flags": f"""WITH x AS ({FLAG_SELECTS})
      SELECT x.area, x.check_name, s.facility_type, s.state FROM x JOIN {T}.facilities_serving s ON x.unique_id = s.facility_id
      UNION ALL SELECT 'Is it one hospital?', 'Two or more merge red flags', facility_type, state FROM {T}.facilities_serving WHERE merge_suspect_score >= 2""",
    "ds_flag_rate": " UNION ALL ".join(
        f"SELECT '{l}' AS check_name, s.facility_type, round(100 * avg(CASE WHEN f.{c} THEN 1 ELSE 0 END), 1) AS pct_flagged "
        f"FROM {FF} f JOIN {T}.facilities_serving s ON f.unique_id = s.facility_id WHERE s.facility_type IN ('hospital', 'clinic', 'dentist') GROUP BY s.facility_type"
        for a, l, c in CHECKS),
    "ds_addr": f"""SELECT concat('1 Address check: ', address_check) AS address_verdict,
        concat('2 Final location: ', CASE location_trust WHEN 'verified' THEN 'verified on the map' WHEN 'verified_osm' THEN 'verified by OpenStreetMap' WHEN 'probable' THEN 'probable'
          WHEN 'approximate_pin' THEN 'PIN-code centre only' WHEN 'approximate_district' THEN 'district centre only' ELSE 'unverified' END) AS final_location, count(*) AS n
      FROM {FF} GROUP BY 1, 2""",
    "ds_phone_flow": f"""WITH t AS (SELECT sum(n_phone_valid) + sum(n_phone_invalid) AS checked, sum(n_phone_usable) AS usable FROM {FF})
      SELECT 'Numbers checked' AS step1, 'Usable' AS step2, 'Kept as the hospital phone' AS step3, usable AS n FROM t
      UNION ALL SELECT 'Numbers checked', 'Set aside', reason, numbers FROM VALUES
        ('Booking or aggregator line', 1175), ('Shared with an unrelated hospital', 1057), ('Landline from the wrong state', 229),
        ('Fake number', 37), ('Invalid or foreign', 60), ('Other', 57) AS r(reason, numbers)""",
    "ds_phone_status": f"""SELECT CASE official_phone_status WHEN 'ok' THEN 'Fine' WHEN '' THEN 'None listed' WHEN 'aggregator_line' THEN 'Booking or aggregator line'
        WHEN 'shared_unrelated' THEN 'Shared with an unrelated hospital' WHEN 'chain_helpline' THEN 'Chain helpline' WHEN 'area_code_conflict' THEN 'Area code from another state'
        WHEN 'placeholder' THEN 'Fake number' ELSE 'Foreign number' END AS status, count(*) AS n FROM {FF} GROUP BY 1""",
    "ds_numcheck": " UNION ALL ".join(
        f"""SELECT '{lab}' AS field, CASE WHEN {c} LIKE 'corrected%' OR {c} LIKE 'filled%' THEN '2 Corrected or filled from a source'
          WHEN {c} LIKE 'confirmed%' OR {c} LIKE 'consistent%' OR {c} LIKE 'close to%' THEN '1 Confirmed or consistent'
          WHEN {c} LIKE 'disputed%' OR {c} LIKE 'conflicts%' OR {c} LIKE 'differs%' OR {c} LIKE 'web: contradicted%' THEN '3 Disputed or contradicted'
          WHEN {c} LIKE 'missing%' THEN '5 Missing (never guessed)' ELSE '4 Could not be checked' END AS result, count(*) AS n FROM {FF} GROUP BY 1, 2"""
        for lab, c in [("Founding year", "year_check"), ("Beds", "capacity_check"), ("Doctors", "doctors_check")]),
    "ds_recog": f"SELECT CASE recognition_tier WHEN 'high' THEN '1 High' WHEN 'moderate' THEN '2 Moderate' WHEN 'some' THEN '3 Some' ELSE '4 No evidence found (unknown, not bad)' END AS tier, count(*) AS n FROM {FF} GROUP BY 1",
    "ds_webchecks": """SELECT * FROM VALUES
        ('KGMU Lucknow', '4,000 beds', 'Confirmed', 'KGMU NIRF 2025 submission: 4,000 beds'),
        ('INHS Asvini, Mumbai', 'Founded 1756', 'Confirmed', 'Indian Navy / Wikipedia: King''s Seamen''s Hospital, Colaba, 1756'),
        ('Harsh Hospital, Motihari', '200,000 beds', 'Contradicted', 'No source; the only figure found (30 beds) is a different Harsh Hospital'),
        ('Nithya Hospital, Dharmapuri', '15,000 doctors', 'Contradicted', 'Small hospital with 2 listed specialties'),
        ('KIMS, Hyderabad', '6,000 doctors', 'Contradicted', 'Whole group is about 979 doctors; branches 51 to 114'),
        ('Wockhardt, Nagpur', '1,400 doctors', 'Contradicted', 'NABH certificate: 118 beds; directories 41 to 150 doctors'),
        ('Scientific Pathology, Agra', '5,000 doctors', 'Contradicted', '3 labs and 11 collection centres'),
        ('Vijaya Diagnostic, Visakhapatnam', '3,000 doctors', 'Contradicted', 'Annual report: 300+ doctors across all 151 centres'),
        ('Asian Eye Hospital, Pune', '1,100 doctors', 'Contradicted', 'Single eye hospital; about 2 named doctors'),
        ('Megavision, Pimpri', '3,000 doctors', 'Contradicted', 'Two diagnostic centres'),
        ('Sahyadri, Pune', '2,000 doctors', 'Chain-wide total', 'Own site: 2,000+ clinicians across the chain'),
        ('Medall Diagnostics, Chennai', '2,500 doctors', 'Chain-wide total', 'National chain; no doctor count published'),
        ('Changethu Ayurveda', 'Founded 1723', 'Unverified', 'Family tradition from the 17th century; no source gives 1723'),
        ('Narhari, Vadodara', '2,860 doctors', 'Unverified', 'No public figure'),
        ('Nova IVF, Bengaluru', '1,500 doctors', 'Unverified', 'Chain of 62 to 83+ centres; no doctor count')
      AS t(facility, claim, verdict, what_sources_say)""",
    "ds_tiers": f"""SELECT 'Moderate or stronger evidence' AS tier, count(DISTINCT facility_id) AS hospitals FROM {T}.facility_claims WHERE level IN ('Strong', 'Moderate')
      UNION ALL SELECT 'Only weak or inferred claims', count(DISTINCT facility_id) - (SELECT count(DISTINCT facility_id) FROM {T}.facility_claims WHERE level IN ('Strong', 'Moderate')) FROM {T}.facility_claims
      UNION ALL SELECT 'No usable evidence (shown as Unknown)', count(*) FROM {T}.facilities_serving s WHERE NOT EXISTS (SELECT 1 FROM {T}.facility_claims c WHERE c.facility_id = s.facility_id)""",
}
for _k in ("ds_checks", "ds_phone_kpi", "ds_phone", "ds_reg"):
    DATASETS.pop(_k, None)
DATASETS.update(REPORT_DATASETS)

TIER_COLORS = {"Moderate or stronger evidence": GOOD, "Only weak or inferred claims": WARN, "No usable evidence (shown as Unknown)": GREY}
NUM_COLORS = {"1 Confirmed or consistent": GOOD, "2 Corrected or filled from a source": "#56B4E9", "3 Disputed or contradicted": BAD, "4 Could not be checked": GREY, "5 Missing (never guessed)": "#D9DEE3"}
RECOG_COLORS = {"1 High": GOOD, "2 Moderate": "#56B4E9", "3 Some": WARN, "4 No evidence found (unknown, not bad)": GREY}


def sankey(name, ds, stages, title, desc=None):
    fields = [fld(s) for s, _ in stages] + [fld("sum(n)", "SUM(`n`)")]
    enc = {"value": {"fieldName": "sum(n)"}, "stages": [{"fieldName": s, "displayName": l} for s, l in stages]}
    return widget(name, ds, fields, {"widgetType": "sankey", "encodings": enc}, title, disaggregated=False, version=1, desc=desc)


def funnel(name, ds, x, y, title, desc=None):
    return widget(name, ds, [fld(x), fld(y, f"SUM(`{y}`)")], {"widgetType": "funnel", "encodings": {"x": {"fieldName": x}, "y": {"fieldName": y, "scale": {"type": "quantitative"}}, "color": {"fieldName": y}}},
                  title, disaggregated=False, version=1, desc=desc)


def pie(name, ds, cat, val, title, colors, desc=None):
    sv = f"sum({val})"
    return widget(name, ds, [fld(cat), fld(sv, f"SUM(`{val}`)")],
                  {"widgetType": "pie", "encodings": {"angle": {"fieldName": sv, "scale": {"type": "quantitative"}}, "color": {"fieldName": cat, "scale": {"type": "categorical", "mappings": mappings(colors)}}, "label": {"show": True}}},
                  title, disaggregated=False, desc=desc)


def heat(name, ds, x, y, val, title, scheme="YlOrRd", desc=None):
    sm = f"sum({val})"
    cat = lambda f: {"fieldName": f, "scale": {"type": "categorical"}, "axis": {"hideTitle": True}}
    return widget(name, ds, [fld(x), fld(y), fld(sm, f"SUM(`{val}`)")],
                  {"widgetType": "heatmap", "encodings": {"x": cat(x), "y": cat(y), "color": {"fieldName": sm, "scale": {"type": "quantitative", "colorRamp": {"mode": "scheme", "scheme": scheme}}}, "label": {"show": True}}},
                  title, disaggregated=False, desc=desc)


def section(name, title, line):
    return (text(name, [f"### {title}\n", line + "\n"]), 0)


Y = {}
_y = [0]


def row(items_h, widgets):
    """place one row of widgets (x, width) at the current y; advance y by the row height"""
    y0 = _y[0]
    out = [(w, x, y0, wd) for (w, x, wd) in widgets]
    _y[0] += items_h
    return y0, out


ref_items = []


def add(h, *ws):
    y0 = _y[0]
    for (w, x, wd) in ws:
        ref_items.append((w, x, y0, wd, h))
    _y[0] += h


add(3, (text("t4", ["## Reference: how we did it, step by step\n",
                    "Every cleaning step, with the file it came from. The last column says how we got each number: **counted from the data** (when this dashboard was built), "
                    "from a **report in the repo**, or from the **team summary** (not reproducible from this folder). Use the filters to focus on one stage.\n"]), 0, 12))
add(2, (filt("f_stage", "filter-multi-select", "Stage", [("ds_ledger", "stage")]), 0, 4),
       (filt("f_how", "filter-multi-select", "Where the number comes from", [("ds_ledger", "number_is")]), 4, 4))
add(12, (table("tb_ledger", "ds_ledger", [("stage", "Stage"), ("step", "What we found"), ("n", "How many"), ("unit", "Unit"), ("what_we_did", "What we did"),
                                          ("source_file", "Where to look"), ("number_is", "Number is")], "The full ledger", order=[("stage", "ASC")]), 0, 12))
add(2, (text("s1", ["### 1. Read and repair: 10,088 rows become 9,989 facilities\n",
                    "The file's quotes are escaped in a non-standard way, so a normal read crashes. 88 rows were pieces of 30 real records and all 30 were stitched back. 11 identical copies were dropped. Original values are kept in raw_ columns."]), 0, 12))
add(3, (counter("k_r1", "ds_rows", "sum(parsed)", "SUM(`parsed`)", "Rows in the file"), 0, 3),
       (counter("k_r2", "ds_rows", "sum(fragments)", "SUM(`fragments`)", "Broken pieces set aside", "Pieces of 30 real records, which were stitched back"), 3, 3),
       (counter("k_r3", "ds_rows", "sum(duplicates)", "SUM(`duplicates`)", "Identical copies dropped"), 6, 3),
       (counter("k_r4", "ds_rows", "sum(final_rows)", "SUM(`final_rows`)", "Facilities we work with"), 9, 3))
add(3, (text("s2", ["### 2. Where is it? Three independent checks on every location\n",
                    "India Post PIN directory, the facility's own coordinates, and OpenStreetMap. The ribbon below shows how the address check (left) became the final location trust (right). "
                    "Use the filters to see which checks fire for one state or facility type."]), 0, 12))
add(2, (filt("f_state4", "filter-multi-select", "State", [("ds_flags", "state")]), 0, 4), (filt("f_type4", "filter-multi-select", "Facility type", [("ds_flags", "facility_type"), ("ds_flag_rate", "facility_type")]), 4, 4))
add(9, (bar("b_flags", "ds_flags", "check_name", "count(*)", "Hospitals flagged by each check", "COUNT(`*`)", color="area", colors=AREA_COLORS, horizontal=True, cat_label="Check", val_label="Hospitals flagged"), 0, 12))
add(9, (sankey("sk_addr", "ds_addr", [("address_verdict", "Address check"), ("final_location", "Final location")], "From address check to final location trust"), 0, 7),
       (heat("h_rate", "ds_flag_rate", "facility_type", "check_name", "pct_flagged", "Which checks fire more for hospitals than clinics (% flagged)"), 7, 5))
add(3, (text("s3", ["### 3. Phones: valid, shared, or somebody else's?\n",
                    "Every number was parsed against the Indian numbering plan, then tested for being a shared booking line, a fake, or from the wrong state. "
                    "The set-aside reasons come from the team summary; the totals are live."]), 0, 12))
add(9, (sankey("sk_phone", "ds_phone_flow", [("step1", "Checked"), ("step2", "Outcome"), ("step3", "Why")], "Where the phone numbers went"), 0, 7),
       (bar("b_pstat", "ds_phone_status", "status", "sum(n)", "Was the hospital's 'official' phone trustworthy?", "SUM(`n`)", horizontal=True, cat_label="Status", val_label="Hospitals"), 7, 5))
add(3, (text("s4", ["### 4. Numbers and dates: checked against outside sources\n",
                    "Wikidata (285 matched facilities), web searches for every extreme value, and the facility's own text. We never overwrite a value we have not verified, and we never guess a missing one."]), 0, 12))
add(8, (bar("b_num", "ds_numcheck", "field", "sum(n)", "How each number was checked", "SUM(`n`)", color="result", colors=NUM_COLORS, layout="stack-100", cat_label="Field", val_label="Share of hospitals", fmt=pct(0)), 0, 6),
       (bar("b_recog", "ds_recog", "tier", "sum(n)", "Recognition: signs of standing we could verify", "SUM(`n`)", color="tier", colors=RECOG_COLORS, cat_label="Tier", val_label="Hospitals",
            desc="Wikipedia article, accreditation claimed, teaching status, age. Not a review score."), 6, 6))
add(9, (table("tb_web", "ds_webchecks", [("facility", "Facility"), ("claim", "What the record says"), ("verdict", "Web verdict"), ("what_sources_say", "What the sources say")],
              "The 15 extreme values we checked on the web: 8 contradicted, so the app shows the verdict next to the number", order=[("verdict", "ASC")]), 0, 12))
add(3, (text("s5", ["### 5. Services: what the text really says\n",
                    "Free text was split into items, off-topic items were moved aside, and each service claim got a level, the exact quote, and up to 3 source links that name the hospital. "
                    ""]), 0, 12))
add(8, (pie("p_tiers", "ds_tiers", "tier", "hospitals", "What the service evidence looks like across 9,989 hospitals", TIER_COLORS), 0, 5),
       (bar("b_items", "ds_items", "reason", "sum(items)", "Service text left out of the evidence (team summary)", "SUM(`items`)", horizontal=True, cat_label="Reason", val_label="Items"), 5, 7))
add(8, (table("tb_rules", "ds_rules", [("step", "#"), ("situation", "When we see this"), ("what_we_do", "We do this"), ("how_many", "How many")],
              "Rules that changed how much a claim is trusted (team summary)", order=[("step", "ASC")]), 0, 12))
add(3, (text("s6", ["### 6. The government registry (HEM): an independent witness\n",
                    "HEM is the National Health Authority's Hospital Empanelment Module list of PM-JAY hospitals. It was not scraped from web text, so it can confirm that a hospital exists and which specialty packages it is approved for. "
                    "We match by name and place, or phone and name."]), 0, 12))
add(3, (counter("k_rl", "ds_reg_kpi", "sum(national_list)", "SUM(`national_list`)", "Hospitals on the national list"), 0, 3),
       (counter("k_rv2", "ds_reg_kpi", "sum(verified)", "SUM(`verified`)", "Our hospitals verified against it"), 3, 3),
       (counter("k_rp2", "ds_reg_kpi", "sum(possible)", "SUM(`possible`)", "Possible matches (need a person)", "Shown as unconfirmed, never used as proof"), 6, 3),
       (counter("k_rb", "ds_reg_kpi", "sum(badge_eligible)", "SUM(`badge_eligible`)", "Eligible for the verified badge"), 9, 3))
add(7, (bar("b_rm", "ds_reg_method", "how_matched", "sum(n)", "How each match was made", "SUM(`n`)", color="outcome", colors=OUTCOME_COLORS, horizontal=True, layout="stack", cat_label="Evidence used", val_label="Matches"), 0, 6),
       (bar("b_rk", "ds_reg_km", "distance", "sum(n)", "Sanity check: distance between the two records of a verified match", "SUM(`n`)", cat_label="Distance", val_label="Verified matches",
            desc="Median 0.14 km; 81% also share a PIN code"), 6, 6))
add(7, (bar("b_ro", "ds_reg_owner", "source", "sum(n)", "Who is on the national list, and who we matched", "SUM(`n`)", color="ownership", colors=OWNER_COLORS, layout="stack-100", cat_label="", val_label="Share", fmt=pct(0)), 0, 6),
       (table("tb_rs", "ds_reg_signals", [("step", "#"), ("signal", "What the registry tells us"), ("effect", "Effect on the chance a claim is real"), ("why", "Why")],
              "How the registry changes the ranking", order=[("step", "ASC")]), 6, 6))
add(3, (text("s7", ["### 7. Where our answer is least certain\n",
                    "Where the data is thin, the app says so and shows the facility as unknown rather than guessing."]), 0, 12))
add(8, (bar("b_desert", "ds_desert", "service", "sum(n)", "How far is the nearest facility with this service? (share of post offices)", "SUM(`n`)", color="bucket", colors=BUCKET_COLORS, layout="stack-100",
            cat_label="Service", val_label="Share of post offices", fmt=pct(0)), 0, 8),
       (bar("b_thin", "ds_thin", "state", "sum(facilities)", "States with the fewest facilities", "SUM(`facilities`)", horizontal=True, cat_label="State", val_label="Facilities"), 8, 4))

P4 = {"name": "reference", "displayName": "4. Reference: how we did it", "pageType": "PAGE_TYPE_CANVAS", "layoutVersion": "GRID_V1",
      "layout": [{"widget": w, "position": {"x": x, "y": y, "width": wd, "height": h}} for (w, x, y, wd, h) in ref_items]}

# page 3 gets a compact HEM block (the full story is on page 4)
_hem = page("x", "x", [
    (text("t3c", ["### The national hospital list (HEM / PM-JAY) as an independent witness\n",
                  "It was not scraped from web text, so it can confirm a hospital exists. It adds to a claim's score but is capped, and can never turn weak evidence into a recommendation."]), 0, 21, 12, 2),
    (counter("k3_rl", "ds_reg_kpi", "sum(national_list)", "SUM(`national_list`)", "Hospitals on the national list"), 0, 23, 4, 3),
    (counter("k3_rv", "ds_reg_kpi", "sum(verified)", "SUM(`verified`)", "Our hospitals verified against it"), 4, 23, 4, 3),
    (counter("k3_rb", "ds_reg_kpi", "sum(badge_eligible)", "SUM(`badge_eligible`)", "Eligible for the verified badge"), 8, 23, 4, 3),
])
P3["layout"].extend(_hem["layout"])

THEME = {"canvasBackgroundColor": {"light": "#FCFCFC", "dark": "#1F272D"}, "widgetBackgroundColor": {"light": "#FFFFFF", "dark": "#11171C"},
         "widgetBorderColor": {"light": "#E6E9ED", "dark": "#2A343C"}, "fontColor": {"light": "#11171C", "dark": "#E8ECF0"},
         "selectionColor": {"light": "#0072B2", "dark": "#8ACAFF"},
         "visualizationColors": [BLUE, WARN, GOOD, PINK, BAD, "#56B4E9", "#F0E442"], "widgetHeaderAlignment": "LEFT", "widgetCornerRadius": 8}


def dashboard():
    return {"datasets": [{"name": k, "displayName": k, "queryLines": [v.strip() + "\n"]} for k, v in DATASETS.items()],
            "pages": [P1, P2, P3, P4],
            "uiSettings": {"theme": THEME, "genieSpace": {"isEnabled": True, "overrideId": GENIE_SPACE, "enablementMode": "ENABLED"}}}


# ------------------------------------------------------------------------------------------------ run
def run_query(sql):
    body = json.dumps({"warehouse_id": WH, "statement": f"SELECT * FROM ({sql.strip().rstrip(';')}) LIMIT 5", "wait_timeout": "50s"})
    r = subprocess.run(["databricks", "api", "post", "/api/2.0/sql/statements", "--json", body], capture_output=True, text=True)
    try:
        j = json.loads(r.stdout)
        return j["status"]["state"], j["status"].get("error", {}).get("message", ""), len((j.get("result") or {}).get("data_array") or [])
    except Exception:
        return "ERR", (r.stdout + r.stderr)[:300], 0


def test_all():
    bad = []
    for k, sql in DATASETS.items():
        st, err, n = run_query(sql)
        print(f"{'ok  ' if st == 'SUCCEEDED' else 'FAIL'} {k:<16} rows>={n} {err[:200]}")
        if st != "SUCCEEDED":
            bad.append(k)
    return bad


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "test"
    json.dump(dashboard(), open(os.path.join(os.path.dirname(__file__), "demo_dashboard.lvdash.json"), "w"), indent=1)
    bad = test_all()
    if bad:
        raise SystemExit(f"fix these datasets first: {bad}")
    if mode == "test":
        return
    ser = json.dumps(dashboard())
    if mode == "deploy":
        body = {"display_name": TITLE, "warehouse_id": WH, "parent_path": PARENT, "serialized_dashboard": ser}
        cmd = ["databricks", "lakeview", "create", "--json", "@{f}", "-o", "json"]
    else:
        body = {"display_name": TITLE, "warehouse_id": WH, "serialized_dashboard": ser}
        cmd = ["databricks", "lakeview", "update", sys.argv[2], "--json", "@{f}", "-o", "json"]
    f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
    json.dump(body, f)
    f.close()
    r = subprocess.run([c.format(f=f.name) for c in cmd], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stderr)
    did = json.loads(r.stdout)["dashboard_id"]
    p = subprocess.run(["databricks", "lakeview", "publish", did, "--warehouse-id", WH, "--embed-credentials"], capture_output=True, text=True)
    print(p.stdout[-200:] or p.stderr)
    print("dashboard id:", did)


if __name__ == "__main__":
    main()
