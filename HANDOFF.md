# Handoff: hospital finder for the CMU / Databricks datathon

Everything a new person needs to pick this project up. Read this first, then `PRODUCT.md` (users, principles), `DESIGN.md` (visual system) and `web/README.md` (running the app).

## 1. What this is

A phone-first app. A person says or types what is wrong (English, Hindi, Tamil, Telugu, Malayalam), the app decides how urgent it is and what kind of care is needed, then recommends nearby hospitals from our facility dataset. Each recommendation quotes the facility's own text with its source, shows how sure we are, and explains how it was chosen. The challenge brief (`CMU Datathon - Fall 2026 - Challenge.pdf`) requires: recommend facilities for a service and location, cite underlying text, communicate uncertainty, answer "why this facility" and "how did you decide", and run on Databricks Free Edition (no GPUs).

Hard rules from the team: the app never gives a definitive diagnosis or treatment/dosing advice; "possible conditions to discuss with a clinician" only. It must not use the State Emblem of India or PM-JAY / Ayushman Bharat logos, and it states it is not affiliated with the Government of India or the NHA.

## 2. Repository map

| Path | What it is |
|---|---|
| `Dataset/` | Original three files: `facilities.csv`, `india_post_pincode_directory.csv`, `nfhs_5_district_health_indicators.csv` (do not edit) |
| `Person_1/` | Facility cleaning: `build_fac_base.py` produces `fac_base`; report in `PERSON1_REPORT.md` |
| `Person_2/` | Location and geography: PIN validation, geocoder, coverage tables, OpenStreetMap check |
| `facilities_final.parquet` | Final merged facility table (9,989 rows) with claims, quoted snippets, trust scores (LFS) |
| `hem_hospitals.csv` | Scraped PM-JAY empanelment list, 39,737 hospitals (LFS). Source and terms of use still to confirm |
| `scripts/` | `build_registry_match.py`, `export_snapshot.py`, `export_geocoder_data.py`; outputs in `scripts/out/` |
| `web/` | The Next.js app (API routes, ranking engine, triage, UI, tests, data snapshot) |
| `PRODUCT.md`, `DESIGN.md`, `.impeccable/` | Design-tool context: product definition, design system, surface brief with direction contract |

Large files use Git LFS (`*.csv`, `*.parquet`). Run `git lfs pull` after cloning. Caveat: the `Person_1/output/*.csv|parquet` files show as modified because the LFS rule was added after they were committed as plain files. Do not commit those changes unless you mean to.

## 3. Data

- **facilities_final.parquet**: 9,989 facilities. Columns include location (with `location_trust` label and score), `facility_trust` 0-100, `merge_suspect_score` (records that may mix several facilities), 24x7 flag, contacts, and a `claims` list. Each claim is one of 15 services (dialysis, C-section, obstetrics, NICU, ICU, cardiac surgery, cath lab, MRI, CT, burn care, trauma/emergency, blood bank, oncology, ventilator, linear accelerator) with level (Strong, Moderate, Inferred, Weak, Contradicted), strength, which fields agree, quoted snippets, prerequisites, contradictions, and `cite_urls`. Snippets have no URL of their own; the claim's `cite_urls` carry the source and whether the page names the facility. For merge-suspect records the cited pages may describe a different branch, and the UI warns.
- **NFHS-5 district indicators**: used only for one-line district context ("about N% of births here are in a facility"). Never a facility feature and never a probability of a person's diagnosis.
- **PM-JAY list (`hem_hospitals.csv`)**: it is the National Health Authority empanelment list, not ground truth for location (12.7% of its coordinates are over 25 km from its own PIN). Matching to our facilities: 1,452 verified, 531 possible, 1,447 eligible for the badge (`scripts/out/registry_match_summary.json`). **Match precision has not been hand-checked.** Label `scripts/out/registry_match_review.csv` (100 pairs); the badge should ship only if verified precision is at least 95%.
- **Snapshot for the app**: `web/data/facilities.snapshot.json` (18 MB, short keys), `districts.snapshot.json`, `geocoder.json`, `snapshot.meta.json`. Regenerate with `scripts/export_snapshot.py` and `scripts/export_geocoder_data.py` after any data change.
- Known data limits: no prices, ratings, live beds or opening hours exist. Cost and comfort are proxies (operator type, PM-JAY listing, size band, equipment depth) and labelled as such. `manual_verification` is empty, so nothing is calibrated.

## 4. How recommendations work (web/lib)

1. **Triage** (`triage/`): a deterministic emergency gate (`redflags.ts`, plus draft Tamil/Telugu/Malayalam stems in `redflags.indic.ts`) runs in the browser and on the server before and after any model; it can only escalate. Then optional LLM extraction (Databricks model endpoint, strict JSON, validated), else a rule table (`mapping.ts`). Output: urgency, services, possible conditions, up to 2 follow-ups.
2. **Geocoder** (`geocoder.ts`): port of `Person_2/geocoder.py` (PIN, coordinates, aliases, fuzzy, ambiguity handling, reverse).
3. **Candidates** (`recommend.ts`): radius 25/50/100/200 km until six credible facilities exist; shortlist of 15; travel time from the traffic adapter (`traffic.ts`: Google Routes or Mapbox if a key is set, else a heuristic labelled "estimated").
4. **Ranking** (`ranking.ts`): P(service) from log-odds with named signals (claim level, agreeing fields, specificity, prerequisites, contradictions, citations naming the facility, facility trust, merge suspicion, registry listing capped, NABH); P(location ok) from the location label; lognormal travel-time noise scaled by congestion; preference weights (Dirichlet) for speed, trust, cost, comfort, government; 2,000 seeded Monte-Carlo draws give P(best), expected rank and intervals. Picks: best, fastest, most trusted, best value, most comfortable. Weak or contradicted options are listed after solid ones and never picked. All weights are hand-set: the output is labelled "evidence-weighted estimate", not calibrated.
5. **Registry**: only verified, non-suspended matches show the badge; "possible" shows a caution; the PM-JAY financial term switches on with the user's answer about holding an Ayushman Bharat card.

## 5. The app (web/)

- Next.js 16 (App Router, standalone output), React 19, TypeScript, Vitest, Glisse 0.6 (liquid glass), lucide-react, Atkinson Hyperlegible.
- API routes: `/api/triage`, `/api/recommend`, `/api/nearby`, `/api/geocode`, `/api/health`.
- UI: `components/App.tsx` (state and flow), `Slip.tsx` (the referral slip, road bar), `Sheets.tsx` (why, preferences, emergency card), `lib/i18n.ts` (five languages), `lib/client/speech.ts` (browser voice in and out), `app/globals.css` (tokens).
- Capability tiers, all optional: (1) warehouse + model + live traffic, (2) snapshot + model, (3) snapshot + rules, which needs no configuration. Copy `web/.env.example` to `.env.local`; never commit secrets.
- Run: `cd web; npm install; npm run dev` (port 3000), `npm test` (132 tests), `npm run typecheck`, `npm run build`. A preview config is in `.claude/launch.json` (port 3100).

## 6. Design

Direction "the referral slip": one answer you can show at the door. World: Indian highway wayfinding boards: board green `#0B5D3B` ground, white sign panels, caution yellow for doubt, facility blue for registry marks, emergency red only for emergencies. Glass only on floating chrome (top strip, composer, mic). Signature: the road bar (free-flow minutes solid, traffic delay hatched yellow, likely range bracketed). Full rules in `DESIGN.md`; direction contract in `.impeccable/surfaces/web-app-page-tsx.md`. The design detector reports zero findings. The finish review was source-only.

## 7. Status

Done and tested: ranking engine, triage and emergency gate (English, Hindi, Hinglish; draft Tamil/Telugu/Malayalam), geocoder, traffic fallback, registry matching, snapshot export, API, full UI, 132 passing tests, production build, design docs.

## 8. What is not done (your to-do list)

1. **Databricks side (the next task).** Nothing is created yet. Steps: `databricks auth login --host https://dbc-43fc181d-51b6.cloud.databricks.com`; create schema and volume; load `facilities_final.parquet` as a Delta table with column comments plus a narrow serving table and a long claims table; SQL `recommend()` function; Genie space; AI/BI dashboard (coverage, quality, registry match rate); MLflow evaluation on golden queries; deploy as a Databricks App (`web/app.yaml` not written); Vercel mirror. Optional MCP: `claude mcp add --transport http databricks-sql <host>/api/2.0/mcp/sql --header "Authorization: Bearer $env:DATABRICKS_TOKEN"` (set the token in your own shell, never in chat).
2. **Verify unknowns on day 0:** Do Databricks Apps run a Next.js standalone build on Free Edition? Is external OAuth M2M allowed? Which model endpoint names exist (set `FM_ENDPOINT`)? Do the challenge rules allow anything beyond Free Edition? Glisse on Safari, Firefox and low-end Android? Traffic provider on about 10 real Indian routes (the adapters are untested against real keys). Registry source terms.
3. **Hand-label** `registry_match_review.csv`; ablation and bias report for the registry weighting (clinics and non-empanelled private facilities must not be buried); calibrate weights once manual verifications exist.
4. **Review by people:** native speakers for Hindi, Tamil, Telugu, Malayalam strings (Tamil/Telugu/Malayalam are partial and fall back to English per key; `missingKeys(lang)` lists the gaps); a clinician for all emergency wording and the "while you wait" lines; red-team the emergency gate with 100+ prompts.
5. **Visual check at 390x844** on a real phone or a wide pane: it has never been seen at that size. Also test reduced-transparency, reduced-motion and screen-reader use.
6. **Open decisions:** product name and logo; traffic provider and budget; whether the registry list may be used beyond validation; whether to show the 37,900 PM-JAY hospitals absent from our data as a labelled secondary pool; optional Whisper fallback for voice.
7. **Privacy and consent:** location is used per request only and no transcripts are stored; the voice notice says browser speech may reach the vendor. Confirm this meets the challenge's rules.

## 9. Working agreements

- Never add Claude or any AI as a co-author on commits or PRs.
- Commit or push only when the owner asks.
- Never put tokens or secrets in chat or in the repo.
- Medical safety: no definitive diagnosis, no dosing, the emergency gate may only escalate, and weak evidence is never presented as fact.

## 10. Databricks deployment (done 2026-11-22)

Workspace `https://dbc-43fc181d-51b6.cloud.databricks.com` (Free Edition), CLI login via `databricks auth login`.

- **Data:** schema `workspace.facility_finder`; volume `raw` (parquet and snapshot); tables `fac_final`, `registry_match`, `facilities_serving`, `facility_claims`; function `find_facilities(service, lat, lon, max_km)`. SQL in `databricks/sql/`, runner `databricks/run_sql.py` (uses the CLI login; warehouse `cf80af6a5a0a8799`). Parquet is loaded from microsecond-timestamp copies (`scripts/out/*.us.parquet`) because Databricks rejects nanosecond timestamps.
- **App:** `facility-finder` at https://facility-finder-7474656106086877.aws.databricksapps.com (sign-in with Databricks required). Source `web/` with `web/app.yaml`; model endpoint `databricks-meta-llama-3-3-70b-instruct` (resource `llm`, CAN_QUERY). `/api/health` reports tier 2 (snapshot data + model); the warehouse is not used by the app yet (tier 1 not implemented). Redeploy: from `web/`, `databricks sync . /Workspace/Users/<you>/facility-finder` then `databricks apps deploy facility-finder --source-code-path /Workspace/Users/<you>/facility-finder` (in Git Bash set `MSYS_NO_PATHCONV=1`).
- **Genie space:** "Facility finder: ask the data" (id `01f1e61d9c39145d8b1fc73ec23c50fa`) over the three tables.
- **Dashboard:** AI/BI dashboard `01f1e61f64731228af5ec8c5f8d6b71f` (built by `databricks/build_dashboard.py`); graph tables `graph_nodes`, `graph_edges` (`databricks/sql/03_graph.sql`); app page notebook `facility_graph` (workspace root) renders the relationship graph from the Delta tables. Vercel and an in-app graph are dropped by decision.
- **Evaluation:** `databricks/evaluate.py` runs 12 golden recommend queries and 33 triage prompts against the deployed app and logs to MLflow experiment `/Users/akileshs@andrew.cmu.edu/facility-finder-eval`. Latest run: emergency recall 22/22, false alarms 0/11, service mapping 100%, 11/12 recommend queries pass (Lucknow C-section: top option is Inferred evidence with no quotable sentence). The app rate-limits to 40 requests per minute per IP; the script waits and retries on 429.
- **Claim audit:** `claim_audit` and view `claim_audit_summary` (`databricks/sql/04_claim_audit.sql`, `ai_query` with Llama 3.3 70B on 150 claims per level). Share judged supported by the quote: Strong 72%, Moderate 55%, Weak 53%. A single quote barely separates Strong from Weak, so the levels rest on more than one snippet.
- **Refresh job:** `facility-finder-refresh` (id 482506352998622), daily 03:00 IST, currently PAUSED; rebuilds the serving, claims and graph tables from `fac_final`. Ran once successfully.
- **Not done:** warehouse-backed app (tier 1), embeddings for symptom matching, hand-labelling the registry sample.
- **Lessons:** the model endpoint rejects `response_format: json_object` (400), so the app parses JSON from the reply text; the app log (`databricks apps logs facility-finder`) shows `llm extract failed` lines when the model call fails and the app silently falls back to rules.
