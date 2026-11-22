CREATE OR REPLACE TABLE workspace.facility_finder.eda_service_sites
COMMENT 'Facilities with Strong or Moderate evidence for six key services, with a map position: the supply side of the care-desert analysis.'
AS SELECT c.service, f.facility_id, f.best_lat AS lat, f.best_lon AS lon, f.state, f.district, f.facility_trust
FROM workspace.facility_finder.facility_claims c JOIN workspace.facility_finder.v_eda_fac f ON f.facility_id = c.facility_id
WHERE c.level IN ('Strong', 'Moderate') AND c.service IN ('dialysis', 'cath_lab', 'nicu', 'trauma_emergency', 'oncology', 'mri') AND f.best_lat IS NOT NULL
;;
CREATE OR REPLACE TABLE workspace.facility_finder.eda_office_service_km
COMMENT 'For every sampled India Post office (a proxy for where people live) and each key service: straight-line km to the nearest facility with Strong or Moderate evidence for it (capped at 150: nothing within about 1.5 degrees).'
AS
WITH o AS (SELECT row_number() OVER (ORDER BY pincode, officename) AS office_id, officename, pincode, state, district, lat, lon FROM workspace.facility_finder.v_eda_offices),
     sv AS (SELECT DISTINCT service FROM workspace.facility_finder.eda_service_sites),
     d AS (
       SELECT o.office_id, s.service,
         min(6371 * 2 * asin(sqrt(pow(sin(radians(s.lat - o.lat) / 2), 2) + cos(radians(o.lat)) * cos(radians(s.lat)) * pow(sin(radians(s.lon - o.lon) / 2), 2)))) AS km
       FROM o JOIN workspace.facility_finder.eda_service_sites s ON abs(s.lat - o.lat) <= 1.5 AND abs(s.lon - o.lon) <= 1.5
       GROUP BY o.office_id, s.service)
SELECT o.office_id, o.officename, o.pincode, o.state, o.district, o.lat, o.lon, sv.service, round(least(coalesce(d.km, 150), 150), 1) AS km
FROM o CROSS JOIN sv LEFT JOIN d ON d.office_id = o.office_id AND d.service = sv.service
;;
SELECT service, count(*) AS offices, round(avg(km), 1) AS mean_km, round(100 * avg(CASE WHEN km > 50 THEN 1 ELSE 0 END), 1) AS pct_over_50km
FROM workspace.facility_finder.eda_office_service_km GROUP BY service ORDER BY 4 DESC
