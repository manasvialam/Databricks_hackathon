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
- UI: `components/App.tsx` (state and flow), `Slip.tsx` (the referral slip, road bar), `Sheets.tsx` (why, preferences, emergency card), `lib/i18n/` (five languages, one file each: `en.ts` is the source, `hi.ts`, `ta.ts`, `te.ts`, `ml.ts` hold the interface text, service names and emergency instructions), `lib/indic.ts` (Indian scripts to Latin, so places typed or spoken in Hindi, Tamil, Telugu or Malayalam geocode), `lib/client/speech.ts` (browser voice in and out; read-aloud only uses a voice for the chosen language), `app/globals.css` (tokens).
- Capability tiers, all optional: (1) warehouse + model + live traffic, (2) snapshot + model, (3) snapshot + rules, which needs no configuration. Copy `web/.env.example` to `.env.local`; never commit secrets.
- Run: `cd web; npm install; npm run dev` (port 3000), `npm test` (221 tests), `npm run typecheck`, `npm run build`. A preview config is in `.claude/launch.json` (port 3100).

## 6. Design

**Superseded (see section 13):** the green highway-board look below was replaced by a calm cool-tone UI. `DESIGN.md` and `.impeccable/` still describe the old one and need rewriting.

Old direction, "the referral slip": one answer you can show at the door. World: Indian highway wayfinding boards: board green `#0B5D3B` ground, white sign panels, caution yellow for doubt, facility blue for registry marks, emergency red only for emergencies. Glass only on floating chrome (top strip, composer, mic). Signature: the road bar (free-flow minutes solid, traffic delay hatched yellow, likely range bracketed). Full rules in `DESIGN.md`; direction contract in `.impeccable/surfaces/web-app-page-tsx.md`. The design detector reports zero findings. The finish review was source-only.

## 7. Status

Done and tested: ranking engine, triage and emergency gate (English, Hindi, Hinglish; draft Tamil/Telugu/Malayalam), geocoder, traffic fallback, registry matching, snapshot export, API, full UI in five languages (screen text, service keywords, native-script place names, read-aloud voice choice), 232 passing tests, production build, design docs.

## 8. What is not done (your to-do list)

1. **Databricks side (the next task).** Nothing is created yet. Steps: `databricks auth login --host https://dbc-43fc181d-51b6.cloud.databricks.com`; create schema and volume; load `facilities_final.parquet` as a Delta table with column comments plus a narrow serving table and a long claims table; SQL `recommend()` function; Genie space; AI/BI dashboard (coverage, quality, registry match rate); MLflow evaluation on golden queries; deploy as a Databricks App (`web/app.yaml` not written); Vercel mirror. Optional MCP: `claude mcp add --transport http databricks-sql <host>/api/2.0/mcp/sql --header "Authorization: Bearer $env:DATABRICKS_TOKEN"` (set the token in your own shell, never in chat).
2. **Verify unknowns on day 0:** Do Databricks Apps run a Next.js standalone build on Free Edition? Is external OAuth M2M allowed? Which model endpoint names exist (set `FM_ENDPOINT`)? Do the challenge rules allow anything beyond Free Edition? Glisse on Safari, Firefox and low-end Android? Traffic provider on about 10 real Indian routes (the adapters are untested against real keys). Registry source terms.
3. **Hand-label** `registry_match_review.csv`; ablation and bias report for the registry weighting (clinics and non-empanelled private facilities must not be buried); calibrate weights once manual verifications exist.
4. **Review by people:** native speakers for Hindi, Tamil, Telugu, Malayalam strings (all five are complete drafts, one file each in `web/lib/i18n/`; also the service keywords in `lib/services.ts` and the native place names in `lib/indic.ts`; `tests/i18n.test.ts` fails if a string, placeholder or emergency number goes missing); a clinician for all emergency wording and the "while you wait" lines; red-team the emergency gate with 100+ prompts.
5. **Visual check at 390x844** on a real phone or a wide pane: it has never been seen at that size. Also test reduced-transparency, reduced-motion and screen-reader use.
6. **Open decisions:** product name and logo; traffic provider and budget; whether the registry list may be used beyond validation; whether to show the 37,900 PM-JAY hospitals absent from our data as a labelled secondary pool; optional Whisper fallback for voice.
7. **Privacy and consent:** location is used per request only and no transcripts are stored; the voice notice says browser speech may reach the vendor. Confirm this meets the challenge's rules.

## 9. Working agreements

- Never add Claude or any AI as a co-author on commits or PRs.
- Commit or push only when the owner asks.
- Never put tokens or secrets in chat or in the repo.
- Medical safety: no definitive diagnosis, no dosing, the emergency gate may only escalate, and weak evidence is never presented as fact.

## 10. Databricks deployment (done 2026-11-22)

Workspace `https://dbc-43fc181d-51b6.cloud.databricks.com` (workspace id 7474656106086877, Free Edition), CLI login via `databricks auth login`.

- **Data:** schema `workspace.facility_finder`; volume `raw` (parquet and snapshot); tables `fac_final`, `registry_match`, `facilities_serving`, `facility_claims`; function `find_facilities(service, lat, lon, max_km)`. SQL in `databricks/sql/`, runner `databricks/run_sql.py` (uses the CLI login; warehouse `cf80af6a5a0a8799`). Parquet is loaded from microsecond-timestamp copies (`scripts/out/*.us.parquet`) because Databricks rejects nanosecond timestamps.
- **App:** `facility-finder` at https://facility-finder-7474656106086877.aws.databricksapps.com (sign-in with Databricks required). Source `web/` with `web/app.yaml`; model endpoint `databricks-meta-llama-3-3-70b-instruct` (resource `llm`, CAN_QUERY). `/api/health` reports tier 2 (snapshot data + model); the warehouse is not used by the app yet (tier 1 not implemented). Redeploy: from `web/`, `databricks sync . /Workspace/Hackathon/facility-finder-app` then `databricks apps deploy facility-finder --source-code-path /Workspace/Hackathon/facility-finder-app` (in Git Bash set `MSYS_NO_PATHCONV=1`).
- **Genie space:** "Facility finder: ask the data" (id `01f1e62c1f1517e9be55e49dd25b42ed`) over the three tables.
- **Dashboard:** AI/BI dashboard `01f1e62c1e3610448245006fa6b812a7` (built by `databricks/build_dashboard.py`); graph tables `graph_nodes`, `graph_edges` (`databricks/sql/03_graph.sql`); app page notebook `facility_graph` (workspace root) renders the relationship graph from the Delta tables. Vercel and an in-app graph are dropped by decision.
- **Evaluation:** `databricks/evaluate.py` runs 12 golden recommend queries and 33 triage prompts against the deployed app and logs to MLflow experiment `/Workspace/Hackathon/facility-finder-eval`. Latest run: emergency recall 22/22, false alarms 0/11, service mapping 100%, 11/12 recommend queries pass (Lucknow C-section: top option is Inferred evidence with no quotable sentence). The app rate-limits to 40 requests per minute per IP; the script waits and retries on 429.
- **Claim audit:** `claim_audit` and view `claim_audit_summary` (`databricks/sql/04_claim_audit.sql`, `ai_query` with Llama 3.3 70B on 150 claims per level). Share judged supported by the quote: Strong 72%, Moderate 55%, Weak 53%. A single quote barely separates Strong from Weak, so the levels rest on more than one snippet.
- **Refresh job:** `facility-finder-refresh` (id 482506352998622), daily 03:00 IST, currently PAUSED; rebuilds the serving, claims and graph tables from `fac_final`. Ran once successfully.
- **Not done:** warehouse-backed app (tier 1), embeddings for symptom matching, hand-labelling the registry sample.
- **Lessons:** the model endpoint rejects `response_format: json_object` (400), so the app parses JSON from the reply text; the app log (`databricks apps logs facility-finder`) shows `llm extract failed` lines when the model call fails and the app silently falls back to rules.

## 11. Read-along (voice reading of every screen)

`web/lib/client/readalong.ts` reads the current screen aloud, part by part, and highlights the part (and the current word where the browser reports word positions). The speaker button in the top bar reads the screen; each sheet (language, how we decided, preferences) has its own speaker button; the emergency card is read automatically. It covers every screen: home, place prompt, care picker, result slip, other options, the sheets and the emergency card. Parts marked `data-read` are read as authored (`data-read-text` overrides the spoken text; `data-noread` skips); everything else is found by walking the page, so new screens are read without extra work. Each part is spoken with a voice for its own language (`lang` attribute), and a part with no installed voice is skipped with a notice, never garbled. Needs real-device testing in hi/ta/te/ml; desktop Windows has no Indian-language voices by default.

## 12. The app reads the SQL warehouse (tier 1)

The deployed app loads its facilities, districts and metadata from the Delta table `workspace.facility_finder.app_snapshot` through the SQL warehouse (`web/lib/snapshot.ts`, started by `web/instrumentation.ts`), and reloads every hour. The bundled `web/data/*.json` answers instantly while the warehouse wakes and is the fallback if the warehouse fails; `/api/health` shows `data.source` ("warehouse" or "snapshot") and any `warehouseError`. To update the data: `python scripts/export_snapshot.py` then `python databricks/load_app_data.py` (the app picks it up within an hour, or on restart). The app's service principal has CAN_USE on the warehouse (app resource `warehouse`) and SELECT on `app_snapshot`.

## 13. UI redesign, hospital list and language-model features (2026-11-22)

### UI
Calm, cool-tone, phone-first (Apple-like): blue-grey ground, white cards, slate ink, one muted slate-blue for actions, soft green only for the PM-JAY badge, amber only for doubt, red only for emergencies, no decorative gradients. Tokens and all component styles are in `web/app/globals.css`. Glisse is no longer used (remove it from `package.json`).
- **Home** (`components/App.tsx`): "What's wrong?", then a large central mic orb (breathes when idle, ripples and shows the live transcript while listening) as the main control, a roomy type bar that grows with the text, a horizontal quick-needs row (Emergency, Pregnancy, Dialysis, Heart, Cancer, ICU), then the nearby hospital list. No bottom bar on home; the floating search bar appears only on result screens.
- **Location** is a compact header (like Uber Eats): "Your location / Chennai 600073 v" top left, opening `LocSheet` (`components/Sheets.tsx`): search a town, PIN or full address, "Use current location", suggested places (`lib/places.ts`, three hard-coded addresses so the app works when device location is denied) and the last three places (localStorage `recentLocs`). Searching with no location opens the sheet and the search resumes after a place is chosen.
- **Addresses**: `lib/geocoder.ts` `geocodeAddress()` resolves any address containing a 6-digit PIN through that PIN (India Post gives one point per PIN), refined to a post-office or locality in the address if one lies within 20 km; an unknown PIN falls back to the other address parts. Accurate to the PIN area, not the street, and the note says so. Tests in `tests/geocoder.test.ts`.
- **Result card** (`components/Slip.tsx`): badge, name, place, minutes and km, one confidence line, Call and Directions; "Why this hospital" (evidence quote, source, reasons, fine print) and "Before you go" fold out. The green PM-JAY badge opens a small card saying what was cross-checked.
- **Back navigation** (`lib/client/nav.ts`, used in `App.tsx`): screen, chosen hospital and open sheet are mirrored into browser history, so phone back, iOS swipe-back and the in-app back arrow walk through them; closing a sheet goes back instead of pushing. Tested in a headless phone-size browser only; real iOS and Android gestures untested.

### Hospital list and needs that map to no service
`lib/nearby.ts` `nearbyHospitals()`, returned as `hospitals` by `/api/nearby`; UI in `components/Hospitals.tsx`. Hospitals and nursing homes only, nearest first (radius widens 10, 25, 50, 100 km until 12 are found), each tagged with the services that have solid evidence; hospitals with no confirmed service sort after. Shown on home once a place is set, with filter chips.

When what the person types maps to none of the 15 services (leg pain, fever), `view === "pickcare"` shows `HospitalCard` for the nearest hospital: PM-JAY badge, estimated minutes and km, service tags, Call and Directions, "Why this hospital" (`HospitalWhySheet`, says honestly the list is nearest first because the need matched no specific service) and "Before you go" ("Call first and ask: Can I be seen today for <what they typed>?"), then the other hospitals; tapping one swaps the featured card. Known weakness: with no relevance signal the nearest hospital can be unrelated (a pregnancy hospital for fever). The language-model fit scoring below is only wired into the specific-service search; wiring it into this list is the obvious next step once the endpoint is live.

### Language model (needs the Databricks person)
One chat endpoint (`FM_ENDPOINT`, `app.yaml` uses `databricks-meta-llama-3-3-70b-instruct`) does three jobs; with no endpoint the app falls back to rules and evidence-only ranking. Details in `web/README.md`.
1. **Understanding** (`lib/databricks.ts`, `lib/triage/triage.ts`): when the model answers, its services decide the care needed; keyword rules are only the fallback. `services: []` is valid ("headache") and leads to the hospital list. The model's plain-English summary is returned as `need`.
2. **Fit scoring** (`lib/rerank.ts`, `lib/recommend.ts`, `lib/ranking.ts`): `need` goes to `/api/recommend`; the model scores each shortlisted hospital 0 to 1 from its own records. One capped term in P(service): at most 0.6 log-odds (`W.modelFit`), positive only where evidence is already Strong, Moderate or Inferred. It cannot add hospitals or rescue Weak or Contradicted evidence. Response has `rankedBy: "evidence" | "evidence+model"`; the reason shows in "Why this hospital".
3. **Translation fallback** (`lib/translate.ts`, `/api/translate`, `lib/client/mt.ts`, `components/Tx.tsx`): server messages with no reviewed translation are translated by the model. A translation that changes any digit is discarded; cached; daily budget `TRANSLATE_DAILY_LIMIT` (default 300). Reviewed packs in `lib/i18n` always win.

The emergency gate is independent of all three and can only escalate. Tests (`tests/llm.test.ts`) use stubs only.

### To do on the Databricks side
1. **Never tested against the real endpoint.** Redeploy the app (section 10), confirm `FM_ENDPOINT` exists and the app service principal has CAN_QUERY, then try "headache hospitals", a Hindi and a Tamil description of dialysis, and a chest-pain message. Watch `databricks apps logs facility-finder` for `llm extract failed`, `rerank failed`, `translate failed`.
2. **Latency and cost:** fit scoring adds one model call per recommend (timeout 7 s, falls back silently); translation adds calls per non-English screen. Check both against the Free Edition rate limits and the app's 40 requests per minute per IP.
3. **Extend `databricks/evaluate.py`:** add queries where keyword rules and the model disagree (headache, "breathless on stairs", Hindi/Tamil/Telugu/Malayalam paraphrases), and record `rankedBy` plus the rank change from fit scoring so we can show whether the model helps. The rerank prompt in `lib/rerank.ts` and the weight `W.modelFit` are hand-set and uncalibrated.
4. **Better than prompting (optional):** embeddings for symptom to service matching (listed under "Not done" in section 10); `ai_query` could do the fit scoring in SQL for the Genie and dashboard side.
5. **Translation review:** have native speakers compare model translations against the reviewed packs; add good ones to `lib/i18n/<lang>.ts` so they stop costing calls.
6. **Open data points:** the PM-JAY badge matches shown to users still need the hand-labelled precision check (section 8, item 3) before the green badge ships.

## 14. Where things live in the workspace

Everything is in the shared folder `/Workspace/Hackathon`: app source `facility-finder-app` (the app deploys from here), `facility-finder-sql` (refresh job SQL), notebook `facility_graph`, the dashboard "Facility finder: data, evidence and relationships", the Genie space "Facility finder: ask the data", and the MLflow experiment `facility-finder-eval`. Tables are in the `workspace.facility_finder` schema. Nothing depends on a personal folder.

## 15. Model features tested on Databricks (2026-11-22)

Tested against the real endpoints from the deployed app (`databricks/probe_model.py`). Findings and changes:
- **Understanding works** (Hindi, Hinglish, Tamil, English "headache": `services: []` leads to the hospital list). The first call after a deploy was slow (a cold endpoint timed out twice, about 40 s), so `instrumentation.ts` now warms the model endpoints at server start (`warmModels`) and the default model timeout is 12 s.
- **Fit scoring never worked at first:** the 70B model needs 12 s for 15 hospitals but the timeout was 7 s, so every call fell back silently. Now only the first 8 hospitals are scored, by `RERANK_ENDPOINT` (`databricks-meta-llama-3-1-8b-instruct`, about 3 s), timeout 9 s. `/api/recommend` now returns `rankedBy: "evidence+model"` and takes 1 to 4 s.
- **Where-are-you and confirm** (`lib/assist.ts`, `/api/assist`, `components/App.tsx`, `LocSheet` in `Sheets.tsx`): when no place is known the location sheet opens with the model's question in the person's language, mentioning the care needed; after a place is typed, picked from suggestions or recents, detected in the message, or read from the phone (reverse-geocoded via `/api/geocode?lat&lon`) the sheet shows "Is this where you are?" with the place in large type and Yes / No buttons; the search only runs after Yes. Emergencies skip the confirmation. The sentences come from `ASSIST_ENDPOINT` (`databricks-qwen3-next-80b-a3b-instruct`; the 70B model wrote nonsense or Latin-script Indian-language sentences). A reply is used only if it is a finished sentence in the language's own script; otherwise the reviewed fallback in `lib/i18n` is shown (it appears first and the model's wording replaces it when it arrives). The place name is never written by the model.
- **App resources:** the app has CAN_QUERY on the 70B, 8B and Qwen endpoints and CAN_USE on the warehouse.
- **Still open:** extend `evaluate.py` with rule-vs-model disagreement queries and record `rankedBy` (item 3 of section 13); watch latency against the 40 requests per minute limit; native-speaker review of the model's Tamil and Malayalam wording; the build log shows "Security scan failed: scanner run failed" on every deploy (the app still deploys and runs).
- The emergency gate flags "breathless when I climb stairs" as an emergency (rules, conservative by design).

- **Fit scoring for needs that map to no service (done):** `/api/hospital-fit` (`web/app/api/hospital-fit/route.ts`) has the 8B model score how well each of the 8 nearest hospitals' own records suit what the person described (about 3 s); `fitHospitals` in `App.tsx` reorders them by fit in steps of 0.2, nearest first within a step, and "Why this hospital" says so and shows the model's reason (English) or a generic sentence (other languages). Tried on the deployed app: leg pain after a fall puts trauma and orthopaedic hospitals first; toothache puts a farther hospital with emergency care ahead of nearer ones with no dental record; fever scores every nearby hospital 0 (none mention paediatrics), so the order stays nearest first. If the model fails the list stays nearest first. Known weakness: a hospital with the closest wording can win without really treating the need, so the sheet says the order is a language-model reading of records, not a verified fact.

## 16. Model comparison for understanding (2026-11-22)

`databricks/compare_models.py` runs the app's extraction prompt on 40 labelled messages (English, Hindi, Tamil, Telugu, Malayalam, Hinglish, two prompt injections) and logs one MLflow run per endpoint (experiment `facility-finder-eval`). Results (valid JSON / right first service / right urgency / emergency recall):

| Endpoint | JSON | Service | Urgency | Emergency recall | Median |
|---|---|---|---|---|---|
| `databricks-qwen35-122b-a10b` (reasoning off) | 97% | 97% | 95% | 100% | 2.2 s |
| `databricks-llama-4-maverick` | 100% | 95% | 97% | 83% | 2.2 s |
| `databricks-qwen3-next-80b-a3b-instruct` | 97% | 93% | 95% | 100% | 1.5 s |
| `databricks-meta-llama-3-3-70b-instruct` (old) | 93% | 82% | 90% | 100% | 2.0 s |

**Qwen3.5 122B A10B is now `FM_ENDPOINT`** (understanding and the translation fallback). It is a reasoning model: with default settings it thinks until it runs out of tokens and never answers (35% valid JSON, 25 s). Sending `reasoning_effort: "none"` makes it answer directly in about 2 s; `lib/databricks.ts` does this for any endpoint whose name contains `qwen35`, and `contentText()` reads the list-of-parts replies reasoning models return. There is no Qwen 3.8 on this workspace; Qwen3.5 122B is the newest. Small sample (40 cases, one run): differences of one or two cases are noise. The Llama 70B mistook chest pain for cardiac surgery; Maverick missed one Tamil chest-pain message (the keyword emergency gate catches those anyway). After the switch the deployed app still scores emergency recall 22/22 and service mapping 100% in `evaluate.py`. The "forbidden output" check now looks only at `conditions` and `followUps`: the model restating a request ("cannot prescribe morphine") in `need` is not advice.
