CREATE OR REPLACE VIEW workspace.facility_finder.v_eda_fac
COMMENT 'One row per facility with the geography, trust and completeness columns the EDA dashboard uses (from fac_final). Coordinates outside India are set to NULL.'
AS SELECT
  unique_id AS facility_id,
  coalesce(nullif(facilityTypeId, ''), 'unknown') AS facility_type,
  coalesce(nullif(operatorTypeId, ''), 'unknown') AS operator,
  state_final AS state, district_final AS district, address_city AS city,
  CASE WHEN latitude BETWEEN 6 AND 37.5 AND longitude BETWEEN 68 AND 97.5 THEN latitude END AS raw_lat,
  CASE WHEN latitude BETWEEN 6 AND 37.5 AND longitude BETWEEN 68 AND 97.5 THEN longitude END AS raw_lon,
  CASE WHEN best_lat BETWEEN 6 AND 37.5 AND best_lon BETWEEN 68 AND 97.5 THEN best_lat END AS best_lat,
  CASE WHEN best_lat BETWEEN 6 AND 37.5 AND best_lon BETWEEN 68 AND 97.5 THEN best_lon END AS best_lon,
  km_coords_to_pin, geo_mismatch_km, location_trust, location_trust_score, geo_status, location_precision,
  facility_trust, facility_trust_level, merge_suspect_score, is_24x7, n_claims, n_specialties, n_procedure, n_equipment, n_capability,
  numberDoctors AS doctors, capacity, size_band, recognition_tier, osm_near, pin_valid, dup_group_id, is_primary, flag_possible_duplicate,
  size(phones_clean) AS n_phones, nfhs_district, nfhs_institutional_birth_5y_pct AS nfhs_inst_birth_pct,
  (size(specialties) > 0) AS has_specialties, (size(procedure) > 0) AS has_procedure, (size(equipment) > 0) AS has_equipment, (size(capability) > 0) AS has_capability,
  (nullif(official_website, '') IS NOT NULL) AS has_website, (nullif(email, '') IS NOT NULL) AS has_email, (yearEstablished IS NOT NULL) AS has_year,
  (numberDoctors IS NOT NULL) AS has_doctors, (capacity IS NOT NULL) AS has_capacity, (nullif(description, '') IS NOT NULL) AS has_description,
  (size(phones_clean) > 0) AS has_phone
FROM workspace.facility_finder.fac_final
;;
CREATE OR REPLACE VIEW workspace.facility_finder.v_eda_offices
COMMENT 'About one in eight India Post offices (every office would be 150k points) with coordinates inside India, from the shared pincode directory. The grey background layer of the maps. Offices on a latitude shared by 100+ offices across 30+ different longitudes (a junk band at 15.593) are dropped.'
AS WITH o AS (
  SELECT officename, pincode, statename AS state, district, try_cast(latitude AS DOUBLE) AS lat, try_cast(longitude AS DOUBLE) AS lon
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory
  WHERE try_cast(latitude AS DOUBLE) BETWEEN 6 AND 37.5 AND try_cast(longitude AS DOUBLE) BETWEEN 68 AND 97.5),
junk AS (SELECT round(lat, 3) AS la FROM o GROUP BY round(lat, 3) HAVING count(*) >= 100 AND count(DISTINCT round(lon, 1)) >= 30)
SELECT officename, pincode, state, district, lat, lon FROM o
WHERE round(lat, 3) NOT IN (SELECT la FROM junk) AND abs(hash(pincode, officename)) % 8 = 0
;;
CREATE OR REPLACE VIEW workspace.facility_finder.v_eda_registry
COMMENT 'Facilities with their PM-JAY registry match (tier, ownership, NABH, distance between the two records).'
AS SELECT f.facility_id, f.facility_type, f.state, f.best_lat, f.best_lon, f.facility_trust, f.location_trust,
  r.tier AS registry_tier, r.method AS registry_method, r.ownership AS registry_ownership, r.nabh, r.trauma_burn, r.km AS registry_km, r.badge_eligible
FROM workspace.facility_finder.v_eda_fac f
LEFT JOIN workspace.facility_finder.registry_match r ON r.unique_id = f.facility_id
;;
SELECT (SELECT count(*) FROM workspace.facility_finder.v_eda_fac WHERE best_lat IS NOT NULL) AS fac_with_coords,
       (SELECT count(*) FROM workspace.facility_finder.v_eda_offices) AS offices,
       (SELECT count(*) FROM workspace.facility_finder.v_eda_registry WHERE registry_tier = 'verified') AS registry_verified
