CREATE OR REPLACE TABLE workspace.facility_finder.facilities_serving
COMMENT 'One row per facility, only the columns the app needs. Built from fac_final (facilities_final.parquet).'
AS SELECT
  unique_id AS facility_id, display_name AS name, facilityTypeId AS facility_type, operatorTypeId AS operator_type, size_band,
  address_city AS city, state_final AS state, district_final AS district, address_zipOrPostcode AS pin,
  best_lat AS lat, best_lon AS lon, location_precision, location_trust, location_trust_score,
  facility_trust, facility_trust_level, merge_suspect_score, is_24x7, is_primary,
  phones_display, official_website, recognition_tier, n_claims
FROM workspace.facility_finder.fac_final
;;
CREATE OR REPLACE TABLE workspace.facility_finder.facility_claims
COMMENT 'One row per (facility, service) claim with level, strength, quoted snippets and cited sources.'
AS SELECT
  f.unique_id AS facility_id, c.service, c.level, c.claim_strength, c.n_fields, c.fields, c.specificity, c.prerequisites_met,
  c.contradictions, c.claim_reasons, c.snippets, c.cite_urls, c.facility_merge_suspect
FROM workspace.facility_finder.fac_final f LATERAL VIEW explode(f.claims) t AS c
;;
ALTER TABLE workspace.facility_finder.facilities_serving ALTER COLUMN facility_trust COMMENT 'Facility trust score 0-100 from Person 4 (contacts, sources, merge suspicion)'
;;
ALTER TABLE workspace.facility_finder.facilities_serving ALTER COLUMN location_trust COMMENT 'How the map position was verified: verified, verified_osm, probable, approximate_pin, approximate_district, unverified'
;;
ALTER TABLE workspace.facility_finder.facilities_serving ALTER COLUMN merge_suspect_score COMMENT '0-5: how likely this record mixes information from several facilities'
;;
ALTER TABLE workspace.facility_finder.facility_claims ALTER COLUMN level COMMENT 'Strong, Moderate, Inferred, Weak or Contradicted evidence that the facility offers the service'
;;
SELECT count(*) FROM workspace.facility_finder.facilities_serving
;;
SELECT service, count(*) FROM workspace.facility_finder.facility_claims GROUP BY service ORDER BY 2 DESC LIMIT 5
