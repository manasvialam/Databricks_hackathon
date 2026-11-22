CREATE OR REPLACE FUNCTION workspace.facility_finder.find_facilities(
  service STRING COMMENT 'One of: dialysis, c_section, obstetrics, nicu, icu, cardiac_surgery, cath_lab, mri, ct_scan, burn_care, trauma_emergency, blood_bank, oncology, ventilator, linear_accelerator',
  lat DOUBLE COMMENT 'Latitude of the person',
  lon DOUBLE COMMENT 'Longitude of the person',
  max_km DOUBLE COMMENT 'Search radius in km'
)
RETURNS TABLE (facility_id STRING, name STRING, city STRING, state STRING, distance_km DOUBLE, level STRING, claim_strength DOUBLE,
               facility_trust DOUBLE, location_trust STRING, merge_suspect_score DOUBLE, first_quote STRING)
COMMENT 'Simple SQL version of the app ranking: facilities that claim a service within a radius, strongest evidence then nearest first. The app uses a probabilistic ranker; this is for exploration and Genie.'
RETURN
  SELECT s.facility_id, s.name, s.city, s.state,
         round(6371 * 2 * asin(sqrt(pow(sin(radians(s.lat - find_facilities.lat) / 2), 2) +
              cos(radians(find_facilities.lat)) * cos(radians(s.lat)) * pow(sin(radians(s.lon - find_facilities.lon) / 2), 2))), 1) AS distance_km,
         c.level, c.claim_strength, s.facility_trust, s.location_trust, s.merge_suspect_score,
         c.snippets[0].text AS first_quote
  FROM workspace.facility_finder.facilities_serving s
  JOIN workspace.facility_finder.facility_claims c ON c.facility_id = s.facility_id
  WHERE c.service = find_facilities.service AND c.level IN ('Strong', 'Moderate')
    AND s.lat BETWEEN find_facilities.lat - find_facilities.max_km / 111 AND find_facilities.lat + find_facilities.max_km / 111
    AND s.lon BETWEEN find_facilities.lon - find_facilities.max_km / 100 AND find_facilities.lon + find_facilities.max_km / 100
  ORDER BY CASE c.level WHEN 'Strong' THEN 0 ELSE 1 END, distance_km
  LIMIT 20
;;
SELECT name, distance_km, level, left(first_quote, 60) FROM workspace.facility_finder.find_facilities('dialysis', 25.6049, 85.1465, 30) LIMIT 5
