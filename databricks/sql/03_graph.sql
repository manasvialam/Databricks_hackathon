CREATE OR REPLACE TABLE workspace.facility_finder.graph_nodes
COMMENT 'Property graph nodes: facilities, services, districts, and the PM-JAY registry.'
AS
SELECT facility_id AS node_id, 'facility' AS node_type, name AS label, state, district, lat, lon, facility_trust AS score FROM workspace.facility_finder.facilities_serving
UNION ALL SELECT DISTINCT concat('svc:', service), 'service', service, NULL, NULL, NULL, NULL, NULL FROM workspace.facility_finder.facility_claims
UNION ALL SELECT DISTINCT concat('dist:', state, '|', district), 'district', district, state, district, NULL, NULL, NULL FROM workspace.facility_finder.facilities_serving WHERE district IS NOT NULL
UNION ALL SELECT 'registry:pmjay', 'registry', 'PM-JAY empanelment list', NULL, NULL, NULL, NULL, NULL
;;
CREATE OR REPLACE TABLE workspace.facility_finder.graph_edges
COMMENT 'Property graph edges. OFFERS (claim strength as weight), IN_DISTRICT, LISTED_IN_PMJAY (verified match), SHARES_PHONE (a number used by 2 to 6 facilities: possible shared record or branch), SAME_DUP_GROUP (suspected duplicates).'
AS
SELECT facility_id AS src, concat('svc:', service) AS dst, 'OFFERS' AS edge_type, claim_strength AS weight, level AS detail
FROM workspace.facility_finder.facility_claims WHERE level IN ('Strong', 'Moderate')
UNION ALL
SELECT facility_id, concat('dist:', state, '|', district), 'IN_DISTRICT', 1.0, NULL FROM workspace.facility_finder.facilities_serving WHERE district IS NOT NULL
UNION ALL
SELECT unique_id, 'registry:pmjay', 'LISTED_IN_PMJAY', 1.0, tier
FROM workspace.facility_finder.registry_match WHERE tier = 'verified'
UNION ALL
SELECT a.facility_id, b.facility_id, 'SHARES_PHONE', 1.0, a.phone
FROM (SELECT unique_id AS facility_id, explode(phones_clean) AS phone FROM workspace.facility_finder.fac_final) a
JOIN (SELECT unique_id AS facility_id, explode(phones_clean) AS phone FROM workspace.facility_finder.fac_final) b ON a.phone = b.phone AND a.facility_id < b.facility_id
WHERE a.phone IN (SELECT p FROM (SELECT explode(phones_clean) AS p, unique_id FROM workspace.facility_finder.fac_final) GROUP BY p HAVING count(DISTINCT unique_id) BETWEEN 2 AND 6)
UNION ALL
SELECT a.unique_id, b.unique_id, 'SAME_DUP_GROUP', 1.0, a.dup_group_id
FROM workspace.facility_finder.fac_final a JOIN workspace.facility_finder.fac_final b ON a.dup_group_id = b.dup_group_id AND a.unique_id < b.unique_id
WHERE a.dup_group_id IS NOT NULL
;;
SELECT edge_type, count(*) FROM workspace.facility_finder.graph_edges GROUP BY 1 ORDER BY 2 DESC
