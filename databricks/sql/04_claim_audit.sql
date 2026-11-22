CREATE OR REPLACE TABLE workspace.facility_finder.claim_audit
COMMENT 'LLM audit of a stratified sample of claims: does the quoted snippet, read alone, support that the facility offers the service? Independent check on the evidence levels; the model can be wrong, so treat it as a second opinion.'
AS
WITH sample AS (
  SELECT facility_id, service, level, snippets[0].text AS quote,
         row_number() OVER (PARTITION BY level ORDER BY hash(facility_id, service)) AS rn
  FROM workspace.facility_finder.facility_claims WHERE size(snippets) > 0 AND level IN ('Strong', 'Moderate', 'Weak')
)
SELECT facility_id, service, level, quote,
  upper(trim(ai_query('databricks-meta-llama-3-3-70b-instruct',
    concat('A hospital web page contains this sentence: "', quote, '"\nDoes the sentence, read on its own, say the hospital offers this service: ', replace(service, '_', ' '),
           '? Answer with exactly one word: YES, NO or UNCLEAR.'), failOnError => false).result)) AS verdict
FROM sample WHERE rn <= 150
;;
SELECT level, verdict, count(*) FROM workspace.facility_finder.claim_audit GROUP BY 1, 2 ORDER BY 1, 2
