"""Datasets for the second half of the EDA dashboard: care deserts, need versus supply, the PM-JAY coverage gap and the data-trust story.
Imported by build_dashboard.py. Tables and views come from databricks/sql/06_care_deserts.sql, 07_need_vs_supply.sql and 08_registry_gap_and_trust.sql.
"""
T = "workspace.facility_finder"
F = f"{T}.v_eda_fac"
K = f"{T}.eda_office_service_km"
D = f"{T}.eda_district"
HEM = f"{T}.v_eda_hem"
TR = f"{T}.v_eda_trust"
TYPE3 = "CASE WHEN facility_type IN ('hospital','clinic','dentist') THEN facility_type ELSE 'other' END"

BUCKET = ("CASE WHEN km <= 10 THEN '1 within 10 km' WHEN km <= 25 THEN '2 10 to 25 km' WHEN km <= 50 THEN '3 25 to 50 km' "
          "WHEN km <= 100 THEN '4 50 to 100 km' ELSE '5 over 100 km' END")
C_BUCKET = {"1 within 10 km": "#2E8B57", "2 10 to 25 km": "#9BC53D", "3 25 to 50 km": "#F2C14E", "4 50 to 100 km": "#F08A4B", "5 over 100 km": "#C8102E",
            "Facility with evidence": "#111111"}
C_GAP = {"Empanelled and in our data (verified)": "#1B6B8F", "Empanelled government, not in our data": "#8E5BC4", "Empanelled private, not in our data": "#E8A33D"}
C_FLAG = {"plausible": "#2E86AB", "flagged as implausible": "#E5222B"}
C_MERGE = {"clean record": "#2E86AB", "may mix facilities": "#E5222B"}
C_OWNER = {"government": "#1B6B8F", "private": "#E8A33D", "unknown": "#C9CED6"}

NEEDS = [("bp_women_pct", "raised blood pressure, women"), ("sugar_women_pct", "high blood sugar, women"), ("tobacco_men_pct", "tobacco use, men"),
         ("anaemia_women_pct", "anaemia, women"), ("inst_birth_pct", "institutional births"), ("csection_pct", "C-section share"), ("insurance_pct", "insurance coverage")]
SUPPLY = [("100.0 * cath_labs / offices", "cath labs"), ("100.0 * dialysis / offices", "dialysis"), ("100.0 * oncology / offices", "cancer care"),
          ("100.0 * maternity / offices", "maternity"), ("100.0 * nicu / offices", "NICU"), ("100.0 * pmjay_verified / offices", "PM-JAY verified")]
NEED_ORDER = [lbl for _, lbl in NEEDS]
SUPPLY_ORDER = [lbl for _, lbl in SUPPLY]
SERVICES6 = ["dialysis", "cath_lab", "nicu", "trauma_emergency", "oncology", "mri"]


def site_map_sql(service):
    return (f"SELECT lat, lon, {BUCKET} AS category, 3 AS pt_size FROM {K} WHERE service = '{service}' "
            f"UNION ALL SELECT lat, lon, 'Facility with evidence' AS category, 9 AS pt_size FROM {T}.eda_service_sites WHERE service = '{service}'")


def district_km_sql(service):
    return (f"SELECT concat(initcap(lower(district)), ', ', initcap(lower(state))) AS district, round(avg(km), 1) AS mean_km, count(*) AS offices FROM {K} "
            f"WHERE service = '{service}' GROUP BY state, district HAVING count(*) >= 15 ORDER BY mean_km DESC LIMIT 15")


def corr_ns_sql():
    parts = []
    for ncol, nlbl in NEEDS:
        for sexpr, slbl in SUPPLY:
            parts.append(f"SELECT '{nlbl}' AS need, '{slbl}' AS supply, round(corr({ncol}, {sexpr}), 2) AS r FROM {D} WHERE offices >= 10")
    return " UNION ALL ".join(parts)


DATASETS = {
    # ---- care deserts
    "cd_dialysis": site_map_sql("dialysis"), "cd_cath": site_map_sql("cath_lab"), "cd_nicu": site_map_sql("nicu"), "cd_trauma": site_map_sql("trauma_emergency"),
    "cd_state": f"""WITH top AS (SELECT state FROM {K} WHERE service = 'dialysis' GROUP BY state ORDER BY count(*) DESC LIMIT 20)
      SELECT initcap(lower(state)) AS state_name, service, round(100 * avg(CASE WHEN km > 50 THEN 1 ELSE 0 END), 1) AS pct_over_50km
      FROM {K} WHERE state IN (SELECT state FROM top) GROUP BY state, service""",
    "cd_share": f"SELECT service, {BUCKET} AS bucket, count(*) AS n FROM {K} GROUP BY 1, 2",
    "cd_worst_dialysis": district_km_sql("dialysis"), "cd_worst_cath": district_km_sql("cath_lab"),
    "cd_hist": f"SELECT km FROM {K} WHERE service = 'dialysis'",
    # ---- need versus supply (district level)
    "ns_bp_cath": f"SELECT district_label, bp_women_pct, cath_per_100_offices, offices FROM {D} WHERE bp_women_pct IS NOT NULL AND offices >= 20",
    "ns_tob_onc": f"SELECT district_label, tobacco_men_pct, onc_per_100_offices, offices FROM {D} WHERE tobacco_men_pct IS NOT NULL AND offices >= 20",
    "ns_anaemia_nicu": f"SELECT district_label, anaemia_women_pct, nicu_per_100_offices, offices FROM {D} WHERE anaemia_women_pct IS NOT NULL AND offices >= 20",
    "ns_ins_pmjay": f"SELECT district_label, insurance_pct, pmjay_per_100_offices, offices FROM {D} WHERE insurance_pct IS NOT NULL AND offices >= 20",
    "ns_map_bp": f"SELECT lat, lon, bp_women_pct, 2 + 5 * cath_labs AS pt_size FROM {D} WHERE bp_women_pct IS NOT NULL AND lat IS NOT NULL",
    "ns_map_anaemia": f"SELECT lat, lon, anaemia_women_pct, 2 + 5 * nicu AS pt_size FROM {D} WHERE anaemia_women_pct IS NOT NULL AND lat IS NOT NULL",
    "ns_gap": f"""WITH r AS (SELECT *, (percent_rank() OVER (ORDER BY bp_women_pct) + percent_rank() OVER (ORDER BY sugar_women_pct)
        + percent_rank() OVER (ORDER BY tobacco_men_pct) + percent_rank() OVER (ORDER BY anaemia_women_pct)) / 4 AS need FROM {D}
        WHERE bp_women_pct IS NOT NULL AND sugar_women_pct IS NOT NULL AND tobacco_men_pct IS NOT NULL AND anaemia_women_pct IS NOT NULL)
      SELECT district_label, round(100 * need, 0) AS need_index FROM r WHERE cath_labs = 0 AND dialysis = 0 ORDER BY need DESC LIMIT 15""",
    "ns_corr": corr_ns_sql(),
    # ---- PM-JAY coverage gap
    "rg_state": f"""WITH s AS (SELECT state, count(*) AS hem_total, sum(CASE WHEN match_tier = 'verified' THEN 1 ELSE 0 END) AS ours FROM {HEM} WHERE state IS NOT NULL GROUP BY state ORDER BY hem_total DESC LIMIT 15)
      SELECT initcap(lower(state)) AS state_name, 'PM-JAY list (all empanelled)' AS kind, hem_total AS n FROM s
      UNION ALL SELECT initcap(lower(state)), 'in our data (verified match)', ours FROM s""",
    "rg_share": f"""SELECT 'PM-JAY list' AS source, ownership, count(*) AS n FROM {HEM} GROUP BY ownership
      UNION ALL SELECT 'in our data (verified)', ownership, count(*) FROM {HEM} WHERE match_tier = 'verified' GROUP BY ownership
      UNION ALL SELECT 'all our facilities', CASE operator WHEN 'public' THEN 'government' ELSE operator END, count(*) FROM {F} WHERE operator <> 'unknown' GROUP BY 2""",
    "rg_map": f"""SELECT lat, lon, CASE WHEN match_tier = 'verified' THEN 'Empanelled and in our data (verified)' ELSE concat('Empanelled ', ownership, ', not in our data') END AS category,
      CASE WHEN match_tier = 'verified' THEN 8 ELSE 3 END AS pt_size FROM {HEM}
      WHERE lat BETWEEN 6 AND 37.5 AND lon BETWEEN 68 AND 97.5 AND NOT inactive AND ownership IN ('government', 'private') AND (match_tier = 'verified' OR abs(hash(hem_facility_id)) % 2 = 0)""",
    "rg_ratio": f"""SELECT initcap(lower(state)) AS state_name, round(100.0 * sum(CASE WHEN match_tier = 'verified' THEN 1 ELSE 0 END) / count(*), 1) AS pct_in_our_data, count(*) AS empanelled
      FROM {HEM} WHERE state IS NOT NULL GROUP BY state HAVING count(*) >= 400 ORDER BY pct_in_our_data ASC""",
    "rg_district": f"""SELECT concat(initcap(lower(district)), ', ', initcap(lower(state))) AS district, count(*) AS not_in_our_data FROM {HEM}
      WHERE match_tier <> 'verified' AND district IS NOT NULL AND state IS NOT NULL GROUP BY state, district ORDER BY not_in_our_data DESC LIMIT 15""",
    # ---- trust story
    "tr_recency": f"""SELECT CASE WHEN page_age_years IS NULL OR page_age_years < 0 THEN '5 no usable date' WHEN page_age_years < 1 THEN '1 under 1 year' WHEN page_age_years < 2 THEN '2 1 to 2 years'
      WHEN page_age_years < 3 THEN '3 2 to 3 years' ELSE '4 3 years or more' END AS page_age, round(avg(facility_trust), 1) AS avg_trust, count(*) AS facilities FROM {TR} GROUP BY 1""",
    "tr_domains": f"SELECT least(n_independent_domains, 6) AS independent_sources, round(avg(facility_trust), 1) AS avg_trust, count(*) AS facilities FROM {TR} WHERE n_independent_domains IS NOT NULL GROUP BY 1",
    "tr_social": f"SELECT least(social_presence, 5) AS social_platforms, round(avg(facility_trust), 1) AS avg_trust, count(*) AS facilities FROM {TR} WHERE social_presence IS NOT NULL GROUP BY 1",
    "tr_operator": f"SELECT operator, round(avg(facility_trust), 1) AS avg_trust, count(*) AS facilities FROM {TR} GROUP BY 1",
    "tr_beds": f"""SELECT beds, doctors, CASE WHEN ratio_flag THEN 'flagged as implausible' ELSE 'plausible' END AS category FROM {TR}
      WHERE beds BETWEEN 1 AND 1500 AND doctors BETWEEN 1 AND 1000""",
    "tr_claim": f"""SELECT f.facility_trust, avg(c.claim_strength) AS avg_claim_strength, CASE WHEN f.merge_suspect THEN 'may mix facilities' ELSE 'clean record' END AS category
      FROM {T}.facility_claims c JOIN {TR} f ON f.facility_id = c.facility_id WHERE c.claim_strength IS NOT NULL AND f.facility_trust IS NOT NULL GROUP BY f.facility_id, f.facility_trust, f.merge_suspect""",
    "tr_strong_merge": f"""SELECT level, CASE WHEN facility_merge_suspect THEN 'on a record that may mix facilities' ELSE 'on a clean record' END AS kind, count(*) AS n
      FROM {T}.facility_claims GROUP BY 1, 2""",
    "tr_decade": f"""SELECT concat(cast(floor(year_established / 10) * 10 AS INT), 's') AS decade, {TYPE3} AS facility_type, count(*) AS n
      FROM {TR} WHERE year_established BETWEEN 1900 AND 2026 GROUP BY 1, 2""",
    "tr_diversity": f"""SELECT initcap(lower(state)) AS state_name, round(avg(n_specialties), 1) AS avg_specialties, count(*) AS hospitals FROM {TR}
      WHERE facility_type = 'hospital' AND state IS NOT NULL GROUP BY state HAVING count(*) >= 30 ORDER BY avg_specialties DESC LIMIT 15""",
    "tr_city24": f"""WITH c AS (SELECT city, count(*) AS n FROM {TR} WHERE city IS NOT NULL GROUP BY city)
      SELECT CASE WHEN c.n = 1 THEN '1 one facility' WHEN c.n < 5 THEN '2 two to four' WHEN c.n < 20 THEN '3 five to 19' WHEN c.n < 100 THEN '4 20 to 99' ELSE '5 100 or more' END AS city_size,
      round(100 * avg(CASE WHEN t.is_24x7 THEN 1 ELSE 0 END), 1) AS pct_24x7, count(*) AS hospitals FROM {TR} t JOIN c ON c.city = t.city WHERE t.facility_type = 'hospital' GROUP BY 1""",
}
