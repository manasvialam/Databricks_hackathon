CREATE OR REPLACE VIEW workspace.facility_finder.v_eda_hem
COMMENT 'All PM-JAY empanelled hospitals (hem_hospitals) flagged with whether our data holds a verified match for them. Suspended, de-empanelled and blacklisted rows are kept but flagged.'
AS SELECT h.hem_facility_id, h.name, h.ownership, h.hem_type, h.state, h.district, h.lat, h.lon, h.n_specialties, h.is_nabh_accredited, h.is_trauma_burn_care,
  (h.is_de_empanelled = 1 OR h.is_suspended = 1 OR h.is_blacklisted = 1) AS inactive,
  coalesce(r.tier, 'none') AS match_tier
FROM workspace.facility_finder.hem_hospitals h
LEFT JOIN (SELECT hem_facility_id, min(CASE tier WHEN 'verified' THEN 'a' ELSE 'b' END) AS t, first(tier) AS tier FROM workspace.facility_finder.registry_match GROUP BY hem_facility_id) r
  ON r.hem_facility_id = h.hem_facility_id
;;
CREATE OR REPLACE VIEW workspace.facility_finder.v_eda_trust
COMMENT 'Facility-level columns for the data-trust story: corroboration, page recency, social presence, doctors versus beds, and merge suspicion.'
AS SELECT unique_id AS facility_id, coalesce(nullif(facilityTypeId, ''), 'unknown') AS facility_type, coalesce(nullif(operatorTypeId, ''), 'unknown') AS operator,
  state_final AS state, address_city AS city, facility_trust, location_trust_score, merge_suspect_score, n_claims, n_specialties, is_24x7,
  n_independent_domains, distinct_social_media_presence_count AS social_presence, engagement_metrics_n_followers AS followers,
  recency_of_page_update AS page_updated, floor(months_between(timestamp'2026-11-22 00:00:00', recency_of_page_update) / 12) AS page_age_years,
  numberDoctors AS doctors, capacity AS beds, yearEstablished AS year_established,
  (flag_one_doctor_many_beds OR flag_doctors_extreme OR flag_capacity_extreme OR flag_beds_high_for_type OR flag_doctors_high_for_type) AS ratio_flag,
  (merge_suspect_score >= 2) AS merge_suspect
FROM workspace.facility_finder.fac_final
;;
SELECT (SELECT count(*) FROM workspace.facility_finder.v_eda_hem WHERE match_tier = 'verified') AS verified_in_hem,
       (SELECT count(*) FROM workspace.facility_finder.v_eda_hem) AS hem_rows,
       (SELECT count(*) FROM workspace.facility_finder.v_eda_trust WHERE page_age_years IS NOT NULL) AS with_page_date,
       (SELECT count(*) FROM workspace.facility_finder.v_eda_trust WHERE ratio_flag) AS ratio_flagged,
       (SELECT min(page_age_years) || ' to ' || max(page_age_years) FROM workspace.facility_finder.v_eda_trust) AS age_range
