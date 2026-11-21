# Person 2: Location & geography

Implements Person 2's part of [`RED_FLAGS_AND_VALIDATION.md`](../RED_FLAGS_AND_VALIDATION.md): red flags **B1-B13**, **J1-J2**, the location decision rule (section 2.2), the user-input geocoder, and the coverage tables.

Nothing in `Dataset/` was changed. This folder works on copies in `data/`.

## Files

| File | What it is |
|---|---|
| `geo_pipeline.py` | The pipeline: India Post reference, state/PIN/city cleaning, coordinate checks, location decision rule, trust score, coverage tables. Start here. |
| `geocoder.py` | `Geocoder` class: city / district / PIN / `lat, lon` / `city, state` -> coordinates, with aliases, ambiguity handling and a radius search. |
| `Person2_Geo.ipynb` | Runs everything step by step, with validation against the playbook's counts, charts and examples. |
| `fetch_osm.py` | One-off OpenStreetMap download (L3), already run. Retries with back-off; `python fetch_osm.py LAKSHADWEEP` re-fetches single states and merges them in. |
| `data/` | Optional local copies of the three input CSVs (git-ignored). If absent, the code reads the shared `../Dataset/` read-only. |
| `outputs/fac_geo.csv` | **The deliverable.** One row per `unique_id`. Column meanings in `outputs/fac_geo_columns.csv`. |
| `outputs/district_density.csv`, `state_coverage.csv` | J1/J2: facilities per district/state, density class, ready-to-show message, NFHS district link (`district_density` in the contract). |
| `data_quality_report_section2.md` | Section 2 of the shared data-quality report (generated from the notebook run). |
| `outputs/pin_reference.csv` | Clean India Post table: one row per PIN with centroid, state, district, spread. |
| `outputs/city_alias.csv`, `nfhs_district_map.csv` | Alias tables (city names; NFHS district -> India Post district). |
| `outputs/figures/` | PNGs from the notebook. |

## Contract names (from the revised playbook)

`fac_geo`: `pin6, pin_district, pin_state, state_final, geo_mismatch_km, geo_status, city_matches_pin, osm_match, best_lat, best_lon, location_precision, location_trust, flag_*, reasons`, plus `addr_consistent`, `flag_pin_invalid`, `flag_state_conflict`, `flag_multiple_pins`.
`geo_status` is one of `consistent | conflict | coords_only | pin_only | invalid`. `reasons` is a list of sentences (stored as a JSON string in CSV). Section 10b of the notebook asserts all of this on every run.

## Run it

```powershell
cd Person_2
jupyter lab Person2_Geo.ipynb          # or open it in VS Code and Run All
```

```python
import geo_pipeline as gp, geocoder as G
base, _ = gp.load_base("../Dataset/facilities.csv")            # swap in Person 1's fac_base when available
ref     = gp.build_reference("../Dataset/india_post_pincode_directory.csv")
osm     = pd.read_csv("outputs/osm_health_poi.csv")    # optional; omit to skip the OpenStreetMap check
geo     = gp.build_fac_geo(base, ref, osm=osm)         # ~50 s with OSM, ~15 s without
gc      = G.Geocoder(ref, geo)
gc.geocode("Bangalore")                                # -> Bengaluru Urban, level 'city'
gc.geocode("Aurangabad")                               # -> status 'ambiguous' (Bihar / Maharashtra): ask for the state
G.geocode_user_input("Bangalore", geocoder=gc)         # contract function -> (12.968, 77.594, 'city')
near, info = gc.within_radius(25.60, 85.14, 25, geo)   # facilities within 25 km + a data-density message
```

Needs `pandas`, `numpy`, `matplotlib` only. `build_fac_geo` needs only the columns in `gp.REQUIRED`.

## How a location is decided

1. **Clean the PIN** (strip spaces/hyphens; if the field is unusable read a PIN out of the address text). Look up its state, district and centroid in India Post.
2. **Clean the coordinates** (outside India -> null, swapped lat/lon -> corrected). Measure the distance to the PIN centroid.
3. **Decide:**

| Case | Location used | `location_trust` (label) |
|---|---|---|
| coordinates within 25 km of the PIN centroid | coordinates | `verified` |
| conflict, an OSM place matches near one side | that side | `verified_osm` (799 facilities) |
| conflict, but same district as the PIN and within 100 km | coordinates | `probable` |
| conflict, city matches the PIN's area | PIN centroid | `approximate_pin` |
| conflict, nothing agrees | PIN centroid | `unverified` |
| only a PIN | PIN centroid | `approximate_pin` |
| only coordinates | coordinates | `unverified` (`probable` if address state and coordinates agree) |
| neither, district known | district centre | `approximate_district` |

`location_trust_score` (0-1): base by label (verified_osm 1.0, verified 0.90, probable 0.75, approximate_pin 0.60, approximate_district 0.40, unverified 0.25) minus 0.15 for locality-level shared coordinates, 0.10 each for several PINs / other state conflict / district conflict, 0.05 each for city mismatch / PIN spanning districts. `location_trust_level` is low (<=0.35), medium (<=0.65), high. The label `location_trust` has seven values: the playbook's five (verified, verified_osm, approximate_pin, unverified, unknown) plus `probable` and `approximate_district`.
Every row has `reasons`: a JSON list of plain sentences for the "Why this facility" / "What we couldn't verify" panels.

## Where this differs from the playbook (and why)

| Playbook | Here | Reason |
|---|---|---|
| Decision rule has no tier between "within 25 km" and "conflict" | added **`probable`**: same district as the PIN and <= 100 km | Large districts make a 25-100 km gap normal; ignoring the coordinates there throws away good data. |
| B5: AP/Telangana trust the PIN; other conflicts flagged | same, plus: if the **coordinates agree with the address state against the PIN**, the PIN is ignored (`flag_pin_state_unreliable`, 15 facilities) | The directory itself is wrong for some PINs (e.g. Agartala PIN 799001 is filed under Telangana); using it would put a Tripura hospital in Telangana. |
| B10: 196 addresses with 2+ valid PINs | **89** | Counted in the address fields only (strict definition). Including the description text gives about 110. Not reproduced exactly; the playbook's method is not documented. |
| B12: centroids from India-bbox offices | also drops offices > 1000 km from their own state's median | Removes 856 more bad office coordinates. |
| B6/B7: 1,965 / 1,227 | 1,924 / 1,191 | Cleaner centroids, recovered PINs, and the 15 distrusted PINs. |

## Known limits

* **30 truncated records have no coordinates** here (`geo_status` is `pin_only` or `invalid`) because stitching them is Person 1's task. Re-run with P1's `fac_base`.
* **OpenStreetMap corroboration (L3) is done.** `fetch_osm.py` downloaded **87,469** named hospitals/clinics/doctors/dentists (4.9 MB, `outputs/osm_health_poi.csv`) for 35 of 36 states/UTs; Lakshadweep failed twice (the dataset has no facilities there). A facility counts as matched when an OSM place with a >= 80% similar name lies within 2 km of its coordinates or its PIN centroid: **3,379 facilities (33.8%)**. OSM coverage is incomplete, so a miss is not evidence of a wrong location. Where OSM could arbitrate a coordinate-vs-PIN conflict (799 of 1,924), it sided with the coordinates 609 times and with the PIN 190 times.
* **District-by-PIN is approximate** where a PIN spans districts (6.5% of PINs) and where district boundaries have changed since the directory was built. `flag_district_conflict` marks facilities where the PIN and the coordinates disagree.
* **NFHS match:** 704 of 706 NFHS districts map to an India Post district. `Chandel` (filed under Mizoram in NFHS, which looks like a source error) and `Warangal Rural` (India Post has a single Warangal) are left unmatched.
* **Thresholds are judgement calls** (25 km, 100 km, trust weights). They sit at the top of `geo_pipeline.py` and are easy to change.

## Loading into Databricks

Upload the CSVs to a Volume, then:

```python
df = (spark.read.option("header", True).option("multiLine", True).option("escape", '"')
      .csv("/Volumes/<catalog>/<schema>/<volume>/fac_geo.csv"))
# booleans arrive as strings: cast every column that starts with flag_; reasons becomes array<string>
from pyspark.sql import functions as F
df = df.withColumn("reasons", F.from_json("reasons", "array<string>"))
for c in [c for c in df.columns if c.startswith("flag_")]:
    df = df.withColumn(c, F.col(c).cast("boolean"))
df.write.mode("overwrite").saveAsTable("<catalog>.<schema>.fac_geo")
```

## Hand-offs

* **Person 1:** call `build_fac_geo(base=fac_base, reference=ref)` once `fac_base` exists; it fills the 30 stitched records.
* **Person 3:** `merge_suspect_score` location inputs are `flag_geo_mismatch_100km` (B6) and `flag_multiple_pins` (B10); `flag_shared_coords` and `flag_district_conflict` are optional extra signals.
* **Person 4 / ranking:** use `best_lat`, `best_lon` for distance and `location_trust` (label) / `location_trust_score` (0-1) inside `facility_trust`. Show `location_precision` so a `pin_centroid` result is never presented as an exact address.
