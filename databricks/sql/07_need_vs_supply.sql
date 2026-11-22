CREATE OR REPLACE TABLE workspace.facility_finder.eda_district
COMMENT 'One row per NFHS-5 district: survey indicators (district-level, never individual risk) beside the supply of facilities with Strong or Moderate evidence for key services in our data, and India Post offices as a rough population proxy.'
AS
WITH base AS (
  SELECT nfhs_state AS state, nfhs_district AS district,
    max(nfhs_w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct) AS bp_women_pct,
    max(nfhs_w15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct) AS sugar_women_pct,
    max(nfhs_m15_plus_who_use_any_kind_of_tobacco_pct) AS tobacco_men_pct,
    max(nfhs_all_w15_49_who_are_anaemic_pct) AS anaemia_women_pct,
    max(nfhs_institutional_birth_5y_pct) AS inst_birth_pct,
    max(nfhs_births_delivered_by_csection_5y_pct) AS csection_pct,
    max(nfhs_hh_member_covered_health_insurance_pct) AS insurance_pct,
    avg(best_lat) AS lat, avg(best_lon) AS lon, count(*) AS facilities,
    sum(CASE WHEN facility_trust >= 60 THEN 1 ELSE 0 END) AS trusted
  FROM workspace.facility_finder.fac_final WHERE nfhs_district IS NOT NULL AND best_lat BETWEEN 6 AND 37.5 GROUP BY 1, 2),
sup AS (
  SELECT f.nfhs_state AS state, f.nfhs_district AS district,
    count(DISTINCT CASE WHEN c.service = 'cath_lab' THEN f.unique_id END) AS cath_labs,
    count(DISTINCT CASE WHEN c.service = 'dialysis' THEN f.unique_id END) AS dialysis,
    count(DISTINCT CASE WHEN c.service = 'oncology' THEN f.unique_id END) AS oncology,
    count(DISTINCT CASE WHEN c.service IN ('obstetrics', 'c_section') THEN f.unique_id END) AS maternity,
    count(DISTINCT CASE WHEN c.service = 'nicu' THEN f.unique_id END) AS nicu,
    count(DISTINCT CASE WHEN c.service = 'icu' THEN f.unique_id END) AS icu
  FROM workspace.facility_finder.fac_final f JOIN workspace.facility_finder.facility_claims c ON c.facility_id = f.unique_id
  WHERE c.level IN ('Strong', 'Moderate') AND f.nfhs_district IS NOT NULL GROUP BY 1, 2),
reg AS (
  SELECT f.nfhs_state AS state, f.nfhs_district AS district, count(*) AS pmjay_verified
  FROM workspace.facility_finder.fac_final f JOIN workspace.facility_finder.registry_match r ON r.unique_id = f.unique_id
  WHERE r.tier = 'verified' AND f.nfhs_district IS NOT NULL GROUP BY 1, 2),
po AS (
  SELECT upper(statename) AS s, upper(district) AS d, count(*) AS offices
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory GROUP BY 1, 2)
SELECT b.state, b.district, concat(b.district, ', ', b.state) AS district_label, b.lat, b.lon, b.facilities, b.trusted,
  b.bp_women_pct, b.sugar_women_pct, b.tobacco_men_pct, b.anaemia_women_pct, b.inst_birth_pct, b.csection_pct, b.insurance_pct,
  coalesce(s.cath_labs, 0) AS cath_labs, coalesce(s.dialysis, 0) AS dialysis, coalesce(s.oncology, 0) AS oncology, coalesce(s.maternity, 0) AS maternity,
  coalesce(s.nicu, 0) AS nicu, coalesce(s.icu, 0) AS icu, coalesce(r.pmjay_verified, 0) AS pmjay_verified, p.offices,
  round(100.0 * coalesce(s.cath_labs, 0) / p.offices, 2) AS cath_per_100_offices,
  round(100.0 * coalesce(s.oncology, 0) / p.offices, 2) AS onc_per_100_offices,
  round(100.0 * coalesce(s.nicu, 0) / p.offices, 2) AS nicu_per_100_offices,
  round(100.0 * coalesce(r.pmjay_verified, 0) / p.offices, 2) AS pmjay_per_100_offices
FROM base b LEFT JOIN sup s ON s.state = b.state AND s.district = b.district LEFT JOIN reg r ON r.state = b.state AND r.district = b.district
LEFT JOIN po p ON p.s = upper(b.state) AND p.d = upper(b.district)
;;
SELECT count(*) AS districts, sum(CASE WHEN offices IS NOT NULL THEN 1 ELSE 0 END) AS with_offices, round(avg(bp_women_pct), 1) AS mean_bp, sum(cath_labs) AS cath_labs_total
FROM workspace.facility_finder.eda_district
