# Facility finder: web app

Next.js app that takes a spoken or typed need, decides how urgent it is, and recommends nearby hospitals with the evidence for each. The engine and API are built and tested; the interface comes from the design step.

## Run

```powershell
cd web
npm install
npm test            # 89 unit tests: ranker, geocoder, emergency gate, triage, traffic, API routes, golden queries
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
