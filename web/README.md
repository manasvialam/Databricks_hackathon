# Facility finder: web app

Next.js app that takes a spoken or typed need, decides how urgent it is, and recommends nearby hospitals with the evidence for each. The engine and API are built and tested; the interface comes from the design step.

## Run

```powershell
cd web
npm install
npm test            # 221 tests: ranker, geocoder, emergency gate, triage, traffic, API routes, golden queries, five languages
npm run dev         # http://localhost:3000
npm run build ; npm start
```

The snapshot in `data/` is generated from the repo root (run in this order):

```powershell
python scripts/build_registry_match.py     # PM-JAY registry match -> scripts/out/
python scripts/export_snapshot.py          # -> web/data/facilities.snapshot.json etc.
python scripts/export_geocoder_data.py     # -> web/data/geocoder.json (reuses Person_2)
```

## Capability tiers (shown in `/api/health`)
1. warehouse + model endpoint + live traffic
2. snapshot + model endpoint
3. snapshot + rule-based triage + estimated travel times (works with no configuration)

## API
| Route | Purpose |
|---|---|
| `POST /api/triage` | message -> emergency gate, urgency, services, possible conditions (never a diagnosis), place |
| `POST /api/recommend` | services, urgency, location, persona, preferences, Ayushman card -> ranked, cited results with P(best) |
| `GET /api/nearby` | services with solid evidence around a point |
| `GET /api/geocode` | city, district, PIN or `lat, lon` -> coordinates; asks for the state when ambiguous |
| `GET /api/health` | capability tier and data version; no secrets |

## How a recommendation is made
`lib/ranking.ts`: P(service) from named evidence signals in log-odds, P(location correct) from Person 2's labels, traffic-aware travel time with noise that grows with congestion, then 2,000 Monte-Carlo draws over those and over the user's preference weights; the output is P(best), expected rank and 80% intervals. Weights are hand-set priors, so results are labelled "evidence-weighted estimate", not calibrated. The registry boost is capped so it can never lift weak evidence above strong evidence. Facilities whose evidence is contradicted or missing a prerequisite are shown only as "weaker evidence", after the solid ones.

## Safety
`lib/triage/redflags.ts` is a deterministic emergency gate (English, Hindi, Hinglish). It runs before and after any model call and can only escalate. The "while you wait" lines and the Hindi labels need review by a clinician and a native speaker before launch.

## Not done yet
- The interface (design step), voice mode, the Databricks table, SQL function, Genie space and App deployment, the Vercel deployment.
- Traffic adapters (Google, Mapbox) are untested against a real key; test about 10 Indian routes and pick one.
- The warehouse read path (`lib/databricks.ts` has the SQL client; the app reads the snapshot until the Delta table exists).
- Hand-labelling `scripts/out/registry_match_review.csv` (100 pairs): the registry badge ships only if the "verified" tier is at least 95% precise.

## Languages
English, Hindi, Tamil, Telugu and Malayalam, chosen from the menu or taken from the phone's language on first visit.
- **Screen text**: `lib/i18n/<lang>.ts`, one file per language for review (`en.ts` is the source). The server sends message keys, not English sentences, so switching language translates results already on screen. Quoted facility text stays in its original language, marked `lang="en"` for screen readers.
- **Input**: service keywords in all five (`lib/services.ts`, `lib/triage/mapping.ts`); places typed or spoken in an Indian script are transliterated and matched (`lib/indic.ts`). Place names inside a sentence only match exactly, so an ordinary word is never turned into a town.
- **Voice**: recognition listens in the chosen language; read-aloud uses an installed voice for that language and says so when the phone has none.
- All non-English text is a draft that needs native-speaker review, and the emergency text clinician review as well. `tests/i18n.test.ts` checks that no string, placeholder or emergency number is missing.


## Language model on Databricks (optional)

With `DATABRICKS_HOST`, credentials and `FM_ENDPOINT` set (the checked-in `app.yaml` uses the pay-per-token `databricks-meta-llama-3-3-70b-instruct`; confirm the name on the workspace Serving page), one chat endpoint does three jobs. Without it the app runs on rules and the evidence engine alone.

1. **Understanding** (`lib/databricks.ts`, `lib/triage/triage.ts`): reads what the person wrote in any of the five languages, returns symptoms, urgency, the care needed and a plain-English summary. When it answers, its reading decides the care needed and keyword rules are only the fallback. "No listed service fits" (a headache) is a valid answer and shows the nearby hospital list.
2. **Fit scoring** (`lib/rerank.ts`, used by `lib/recommend.ts` and `lib/ranking.ts`): after the evidence engine shortlists hospitals, the model reads each hospital's own records and scores fit to the need. It is one capped term (at most 0.6 log-odds) in P(service), shown in "Why this hospital". It cannot add hospitals, and it cannot lift Weak or Contradicted evidence. Failure or timeout means evidence-only ranking.
3. **Translation fallback** (`lib/translate.ts`, `/api/translate`): server messages with no reviewed translation (including the model's one-line reasons) are translated; a translation that changes any digit is discarded; results are cached and a daily budget applies. Reviewed packs in `lib/i18n` are always preferred.

The emergency gate is independent of the model and can only escalate. Not yet verified against the live workspace endpoint: tests use stubs.
