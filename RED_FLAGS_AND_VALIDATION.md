# Red Flags & Validation Plan: Split by Team Member

Every count below was checked against the data, parsed correctly (`escapechar='\\'`, fragment rows removed, exact duplicates dropped), as in [`EDA.ipynb`](EDA.ipynb). The base is **9,989 facilities**. Charts are in [`EDA_REPORT.md`](EDA_REPORT.md).

**Principle:** the dataset can't prove itself true. Each claim gets checked three ways:
- **L1**: internal consistency within the dataset.
- **L2**: our reference files (India Post PINs, NFHS‑5).
- **L3**: outside sources (registries, OpenStreetMap, phone calls), for top results.

Flag rather than delete, keep original values, and show the reason to the user.

**Action key:**
- **FIX**: correct the value deterministically.
- **FLAG**: keep the value and add a flag.
- **NULL**: blank the value but keep the original in `raw_<col>`.
- **DOWN**: lower its weight in the score; **UP** raises it.
- **QUAR**: move to the quarantine file.

---

## Contents
- [0. Before you start (everyone)](#0-before-you-start-everyone)
- [Person 1: Base table (ingestion, structure, numbers)](#person-1-base-table)
- [Person 2: Location & geography](#person-2-location--geography)
- [Person 3: Contacts, sources & identity](#person-3-contacts-sources--identity)
- [Person 4: Services, equipment & claim evidence](#person-4-services-equipment--claim-evidence)
- [Together: trust score, ranking & validation](#together-trust-score-ranking--validation)
- [Master checklist](#master-checklist)

---

## 0. Before you start (everyone)

### Order of work
```
Hour 0–2   P1 builds fac_base  ──►  P2, P3, P4 write their rules/dictionaries on the notebook dataframe meanwhile
Hour 2–8   P2, P3, P4 run in parallel on fac_base   (P1 → NFHS parse, data_quality_report, then helps P4)
Hour 8+    Everyone: join → trust score → ranking → measure against manual checks → UI reason text
```

### Shared contract (agree on this before writing code)
- Every output is a table keyed by **`unique_id`**, written as a Delta table: `fac_base`, `fac_geo`, `fac_contact`, `fac_claims`.
- Flags are boolean columns named **`flag_<name>`**.
- Any value you blank or change keeps its original in **`raw_<col>`**.
- Each table has one **`reasons`** column, `array<string>`, holding plain-language sentences for the UI, e.g. *"Coordinates are 180 km from the stated PIN code."*
- Nothing is deleted except the 88 fragment rows (quarantined) and the 11 exact duplicates.

### Corrections to the earlier plan (so nobody repeats them)

| Earlier claim | What the data shows | Owner |
|---|---|---|
| "88 rows have shifted columns; quarantine them" | They are **pieces of 30 real records**. The records can be stitched back; **all 30 are recoverable** (tested) | P1 |
| "11 duplicate unique_ids: keep the most complete" | They are **byte-identical copies**; drop one | P1 |
| "State ≠ PIN: 423" | Mostly spelling. **65 are real conflicts** (25 AP/Telangana) | P2 |
| "Prefer `officialPhone`" | **255 facilities have a mass-shared helpline as their `officialPhone`** | P3 |
| "8001031041 on 361 facilities" | Toll-free **1800‑103‑1041** with its `1` stripped by naive `+91` removal; it also appears as `9118001031041` | P3 |
| "CT claimed by 2,718" | The `ct` match hit "doctor". With word boundaries: **1,532** | P4 |
| "Names with '&' = merged" | Weak signal. Use **"evidence text names a different hospital"** instead | P3 |

---

## Person 1: Base table

**Mission:** produce one clean, typed, de-duplicated table that everyone else builds on. Nothing downstream starts until this exists, so **go first and keep it simple**.

### Red flags you own

| # | Red flag | Count | Action | How |
|---|---|---|---|---|
| A1 | Non-standard CSV escaping (`\"` instead of `""`); a default read crashes | whole file | FIX | `pd.read_csv(..., escapechar='\\', dtype=str, keep_default_na=False)` / Spark `.option("escape","\\").option("multiLine",True)` |
| A2 | Fragment rows (description text spilled onto new lines) | 88 | QUAR | A real row has a UUID-shaped `unique_id` |
| A3 | Truncated records (everything after `description` empty) | 30 | **FIX** | Stitch: (1) append the fragment text to `description`; (2) the last fragment containing a JSON list holds the 24 post-description columns, with `specialties` 3 columns after its start (`area`, `numberDoctors`, `capacity` come first). Check that latitude parses as a float |
| A4 | Exact duplicate rows | 11 | FIX | `drop_duplicates()` |
| A5 | Three encodings of missing: `null`, `""`, `[]` / `[""]` | all columns | FIX | Normalise to NaN; a list that is empty or only blanks means **no evidence** |
| A6 | Dead or redundant columns: `countries`, `acceptsVolunteers`, `area`, `organization_type`, `address_country(Code)`, `source`, `content_table_id`, `coordinates` | 10 cols | FIX | Keep in raw; exclude from the model and UI |
| A7 | Category typos and overlaps: `farmacy` → `pharmacy`; `government` ≈ `public` | 10 / 2 | FIX | Map |
| G2 | Blank `""` items inside lists | ~2,300 facilities | FIX | Drop blank items |
| G4 | Repeats inside lists (specialties 55% duplicate) | — | FIX | Keep order, remove repeats |
| G5 | Free-form specialty strings (861) and one-off strings (1,976 of 2,933) | — | FIX | Map to the camelCase vocabulary (`Cardiology` → `cardiology`); ignore one-offs |
| G6 | `internalMedicine` on 68% of facilities | — | DOWN | Mark as low-information for P4 |
| F1 | `numberDoctors` > 1,000 (max 15,000) | 11 | NULL | Also by type: clinic > 50 |
| F2 | `capacity` > 3,000 (max 200,000) | 2 | NULL | Clinic > 200 beds: 10 → flag |
| F3 | Doctors = 0 / beds = 0 | 13 / 13 | NULL | 0 means unknown |
| F4 | Year = 0, 7, 15, or < 1800 | 7 | NULL | |
| F5 | **1 doctor but ≥ 100 beds** | 72 | FLAG | `numberDoctors = 1` usually means *one named doctor found* (the most common value: 1,194) |
| F6 | Value heaping: 71% of bed counts are multiples of 10 | most | FIX | Add `size_band` = small (< 30) / medium (30–100) / large (100–500) / very large (> 500) / unknown |
| F7 | Scale fields mostly missing (beds 75%, doctors 64%, year 52%), more so for clinics (97% no beds) | — | — | **Never impute.** Show "unknown" |
| I1 | Same normalised name + same city | 12 rows | FLAG | `dup_group_id`; mark the most complete as `is_primary` |
| I2 | Same name + same PIN | ~15 | FLAG | Same |
| J5 | NFHS: 4,125 `*` (suppressed), 5,068 `(x)` (low reliability), state typos (`Maharastra`, `NCT of Delhi`), district names repeated across states | — | FIX | `*` → null; `(x)` → value + `lowrel_<col>=True`; join key = state + district |

### Validation you run
- Row counts at every step (10,088 raw → 88 quarantined → 10,000 → 9,989 after duplicates; 30 repaired).
- After the stitch, the 30 repaired rows must have parseable `specialties` and numeric `latitude`.
- Every list column parses as JSON (it does: 0 failures).

### You deliver
- `fac_base` with typed columns, cleaned lists, `size_band`, `dup_group_id`, `raw_*`, `flag_*`, `reasons`.
- `facilities_quarantine.csv` (the 88 fragments).
- `nfhs_clean` (parsed, with reliability flags).
- `data_quality_report.md` section 1: counts for every step above.

---

## Person 2: Location & geography

**Mission:** decide **where each facility really is**, how sure we are, and turn the user's location input into coordinates. This is the biggest trust problem in the data.

### Red flags you own

| # | Red flag | Count | Action | How |
|---|---|---|---|---|
| B1 | State field has 234 spellings for 36 states/UTs (Tamilnadu, Orissa, U.p., Telengana…) | 234 | FIX | Alias map plus India Post canonical names |
| B2 | City or district in the state field (Thane, Pune, Navi Mumbai, Chennai…) | 284 rows | FIX | State from the PIN (272 recovered; 12 left unknown) |
| B3 | PIN malformed (`"5600"`, `"641-602"`) or space-separated (`"201 301"`) | 70 / 153 | FIX/FLAG | Strip spaces; if not 6 digits, regex a 6-digit PIN out of the address lines |
| B4 | PIN not in the India Post directory | ~215 | FLAG | `flag_pin_invalid`; fall back to the city |
| B5 | State ≠ PIN state (true conflict) | 65 | FLAG | AP ↔ Telangana (25): trust the PIN (2014 split). Others: `flag_state_conflict` |
| B6 | Coordinates > 25 km from the PIN centroid | 1,965 (20%) | FLAG | `geo_mismatch_km`; `geo_status = conflict` |
| B7 | Coordinates > 100 km from the PIN (> 500 km: 195) | 1,227 | FLAG+DOWN | Almost certainly wrong or merged |
| B8 | Coordinates outside India (Somalia, Antarctica…) | 6 | NULL | Bounding box lat 6–37.6, lon 68–97.5 |
| B9 | Identical coordinates on different facilities | 37 points / 79 facilities | FLAG | `location_precision = locality` |
| B10 | Address text mentions ≥ 2 distinct valid PINs | 196 (9 across states) | FLAG | `flag_multiple_pins`, which feeds P3's merge score |
| B11 | City name variants (Bangalore/Bengaluru, Gurgaon/Gurugram, Trivandrum/Thiruvananthapuram, Baroda/Vadodara…) | ~10 major pairs | FIX | Alias table, also used for **user input** |
| B12 | India Post file: 7% missing and 2,613 garbage coordinates | reference | FIX | Filter to the bounding box; take the **median** per PIN (accurate: median spread 2.4 km) |
| B13 | ~6% of PINs span two districts; 52 span two states | reference | FLAG | District-by-PIN is approximate |
| J1 | Top 5 states = 50% of facilities; Ladakh, Lakshadweep and DNH‑DD = 0 | — | — | Feed the "under-covered area" message |
| J2 | 201 of 754 districts have no facilities; 246 NFHS districts have none | — | — | District density table |

### How to validate locations

| Level | Check | Output column |
|---|---|---|
| L1 | Valid PIN format; PIN extracted from the address if the field is broken | `pin6` |
| L1 | Do the address lines and city agree with each other (all PINs in the text in one district)? | `addr_consistent` |
| L2 | PIN → India Post median centroid, district, state; distance from the coordinates | `geo_mismatch_km` |
| L2 | Does the city string fuzzy-match the PIN's district or post-office names? | `city_matches_pin` |
| L2 | Inside the India bounding box; state = PIN state | `geo_status` ∈ consistent / conflict / coords_only / pin_only / invalid |
| L3 | **OpenStreetMap corroboration**: download India `amenity=hospital|clinic|doctors|dentist` once via Overpass (a small file). Fuzzy-match the facility name within 2 km of its coordinates **or** its PIN centroid | `osm_match`, `osm_dist_km`. This settles which location is right |
| L3 | Reverse geocoding (Nominatim, 1 request/sec): only for conflicts among top results | district check |

> Databricks Free Edition may block outbound internet. Run the Overpass download locally, upload the result as a table, and match inside Databricks.

### Location decision rule
1. Coordinates within 25 km of the PIN: **use the coordinates**, `location_trust = verified`.
2. Conflict, and OSM matches near one of the two: **use that one**, `verified_osm`.
3. Conflict, and the city matches the PIN district: **use the PIN centroid**, `approximate_pin`.
4. Conflict, and nothing agrees: **PIN centroid**, `unverified`. Reason: *"Coordinates are N km from the stated PIN code; showing approximate location."*
5. Only a PIN: `approximate_pin`. Only coordinates: `unverified`. Neither: `unknown`.

### You deliver
- `fac_geo`: `pin6`, `pin_district`, `pin_state`, `state_final`, `geo_mismatch_km`, `geo_status`, `city_matches_pin`, `osm_match`, `best_lat`, `best_lon`, `location_precision`, `location_trust`, `flag_*`, `reasons`.
- `pin_reference` (PIN → centroid, district, state) and `district_density` (facilities per district, joined to NFHS).
- **`geocode_user_input(text)`**: city / PIN / district → (lat, lon, precision), using the alias table.
- `data_quality_report.md` section 2.

---

## Person 3: Contacts, sources & identity

**Mission:** answer *"does this facility exist, is this record really about it, and how do you reach it?"* You also detect **merged records** and run the **manual verification** for the demo.

### Red flags you own

**Phones**

| # | Red flag | Count | Action | How |
|---|---|---|---|---|
| C1 | One number on **432 facilities** (`9693969347`, nationwide, incl. Fortis & HCG): a booking or aggregator line | 432 | NULL there | Any number on ≥ 10 facilities is a shared line (26 numbers, 778 facilities) |
| C2 | Toll-free 1800‑103‑1041 on 277 + 144 facilities, partly mis-parsed as a "mobile" | 421 | FIX+NULL | Parse with `phonenumbers` |
| C3 | **`officialPhone` is itself a mass-shared number** | **255** | NULL+FLAG | Never auto-trust `officialPhone` |
| C4 | Numbers shared by 2–9 facilities | ~900 numbers | FLAG | Fine if the facilities share a brand name; suspicious if not |
| C5 | Invalid length / invalid number | 448 facility-number pairs | NULL | `phonenumbers.is_valid_number` |
| C6 | Placeholder numbers (`9999999999`, `1234567890`, ≤ 2 distinct digits) | 17 | NULL | Regex |
| C7 | Landline area code doesn't match the facility's state | 149 facilities (195 numbers) | FLAG | See validation below |
| C8 | Very long phone lists (> 20 distinct; max 48) | 122 | FLAG | Directory spill-over, a merge signal |

**Email, website, social**

| # | Red flag | Count | Action |
|---|---|---|---|
| D1 | `[email protected]` (Cloudflare obfuscation scraped verbatim) | 363 | NULL |
| D2 | Invalid email format | ~430 | NULL |
| D3 | Same email on several facilities | ~600 | FLAG |
| D4 | Free-mail address (gmail/yahoo/rediff), 62% | — | Neutral; don't penalise small clinics |
| D5 | `officialWebsite` is a directory or free host (business.site, practo, justdial, facebook, blogspot…) | 309 | FLAG: no own domain |
| D6 | Same `officialWebsite` on several facilities | 579 | FLAG (chain domain OK) |
| D7 | Follower counts copied across unrelated facilities (15,000,000 on an eye hospital and a dental clinic; 4,756,342 on three hospitals) | dozens | NULL for ranking |
| D8 | Last social post before 2024 (possibly inactive) | 2,793 | FLAG `stale_web` |
| D9 | Page-update date in the future (2027‑07‑20) | 1 | NULL |

**Sources & merges**

| # | Red flag | Count | Action |
|---|---|---|---|
| E1 | Most evidence comes from aggregators (facebook ~8.8k facilities, justdial ~5.4k, practo ~2.7k) | most | DOWN aggregator-only |
| E2 | Off-topic sources: proptiger (real estate), policyx and zurichkotak (insurance), indiamart (B2B), latlong.net | thousands | DOWN; existence and address only |
| E3 | **Aggregator URL slug doesn't mention the facility name** (justdial/practo URLs contain the business name) | **2,062** facilities with < 25% matching | FLAG `foreign_sources` |
| E4 | Own website missing from the sources | 53% | DOWN |
| E5 | `.gov.in` / `nic.in` source present | 1,013 | **UP** |
| E6 | ≤ 1 source URL | ~43 | FLAG thin evidence |
| G9 | **Evidence text names a *different* hospital** (e.g. Fortis Kolkata sentences inside a Fortis Gurgaon record; Nair Hospital Mumbai inside Fortis) | **3,737 facilities; 1,103 with ≥ 5 sentences** | FLAG; pass the sentences to P4 to drop. Heuristic: a proper noun ending in Hospital/Clinic/Institute/Medical College whose tokens don't overlap the facility name. Review a sample (affiliations cause false positives) |
| I3 | **Merged record** | `merge_suspect_score` | See below |

### How to validate

**Phones**

| Level | Check | Tool / output |
|---|---|---|
| L1 | Parse against the Indian numbering plan; classify as mobile / fixed / toll-free | `phonenumbers.parse(x,"IN")`, `is_valid_number`, `number_type` → `phone_valid`, `phone_type` |
| L1 | Shared-number blacklist (≥ 10 facilities) | `phone_shared_n` |
| L1 | `officialPhone` in the list *and* not blacklisted | `official_phone_ok` |
| L2 | **Landline location**: `phonenumbers.geocoder.description_for_number(n,"en")` gives a city for Indian fixed lines. Compare with P2's `pin_district` / `pin_state`. Fallback: STD prefix → state learned from consistent records (192 prefixes) | `phone_geo_conflict` |
| L1 | Phone list draws on ≥ 3 states' area codes | merge signal |
| L3 | **Call 15–20 top results** ("Is this X? Do you offer dialysis?") | `manual_verification` |

**Usable phone** = valid, not blacklisted, and (fixed line → area code consistent). Show at most two, preferring numbers also found on the facility's own site.

**Existence & identity**

| Level | Signal | Weight |
|---|---|---|
| L1 | Number of independent source domains (own site + practo + justdial > facebook only) | + |
| L1 | Own-domain website | + |
| L1 | Recent activity (post or page update ≥ 2024) | + |
| L1 | Aggregator slugs mention the name | +/− strong |
| L1 | `.gov.in` / `nic.in` source | ++ |
| L1 | NABH mentioned in the record (verify at L3) | + |
| L3 | **ABDM Health Facility Registry** (national registry) | +++ |
| L3 | **PM‑JAY / Ayushman Bharat empanelled list**: by district, with the **specialties** each hospital is empanelled for, so it confirms services | +++ |
| L3 | **NABH** accredited list; **CGHS / ECHS / ESIC** empanelment lists | +++ |
| L3 | Website check for top results: loads, and shows the same address or phone | + |

**Merge score** (0–6), from your team's flags:
```
merge_suspect_score = flag_list_truncated (P4) + names_other_hospital>=5 (G9) + foreign_sources (E3)
                    + phones>20 (C8) + geo_mismatch>100km (P2) + multiple_pins (P2)
```
At ≥ 3: *"This record may combine information from several facilities."*

**Manual verification (weekend-realistic):**
1. Pick the 3 demo queries (e.g. dialysis near Patna, C‑section near Lucknow, trauma near a highway hotspot).
2. For each query's top 5 results, check PM‑JAY, NABH and ABDM, and call.
3. Record each in `manual_verification(unique_id, service, source, result, checked_by, date)`.

### You deliver
- `fac_contact`: `phones_clean`, `phone_valid`, `phone_type`, `phone_geo_conflict`, `official_phone_ok`, `email_ok`, `own_domain`, `source_classes`, `n_independent_domains`, `slug_match_share`, `gov_source`, `stale_web`, `other_hospital_sentences`, `merge_suspect_score`, `facility_trust`, `flag_*`, `reasons`.
- `phone_blacklist` and `manual_verification`.
- `data_quality_report.md` section 3.

---

## Person 4: Services, equipment & claim evidence

**Mission:** for every (facility, service) pair, decide **how strongly the data supports the claim**, and keep the exact snippet, field and source to cite.

### Red flags you own

| # | Red flag | Count | Action | How |
|---|---|---|---|---|
| G1 | **Lists cut off at 50 items** | **3,220 facilities (32%)** | FLAG `list_truncated` | Coordinate conflicts double in these records (23.8% vs 11.8%), so pass this to P3's merge score |
| G3 | **LLM placeholder sentences**: *"No specific medical equipment listed for X in the provided content"* | 363 equipment, 272 procedure, 30 capability items | FIX | Regex `^(no|not|none)\b.*(provided|listed|mentioned|available|specified)` → drop |
| G7 | **Capability padding** ("Located in…", "Listed in…", "Open 24 hrs", "Has 1 doctor") | 25,663 items on 6,951 facilities | FIX | Move to `meta_items`, not evidence ("24×7" stays useful for emergency) |
| G8 | Non-medical "equipment" (wheelchair access, parking, rooms) | ~1,300+ | FIX | Exclude |
| G9 | Sentences naming another hospital (from P3) | 3,737 facilities | FIX | Drop those sentences from evidence |
| G10 | **Research-paper language** ("study", "trial", "patients were", "phantom", "dosimetry", "retrospective") | 1,220 items on ~650 facilities | DOWN | Proves research happened, not a walk-in service |
| G11 | Specialty tag ↔ text disagreement (nephrology without dialysis text: 826; dialysis without the tag: 293) | — | — | Use both; text + equipment > tag |
| G12 | Spelling variety (34k distinct equipment strings) | — | — | Synonyms + **word-boundary** regex (or embeddings) |
| H1 | Clinic, dentist or doctor claiming heavy services (ICU, dialysis, cardiac surgery, NICU, C‑section, cath lab, linear accelerator) | 567 | FLAG | Claim becomes Contradicted or Weak |
| H2 | ≥ 20 specialties with ≤ 2 doctors | 316 | FLAG | |
| H3 | ICU, NICU or surgery claimed with beds = 0 | per service | FLAG | Unknown beds alone is not a conflict |
| H4 | Claim found **only** in `description` or `specialties` | per service | DOWN | Max level Weak |
| H5 | Prerequisite missing (cardiac surgery with no cath lab/OT/cardiology; NICU with no paediatrics) | per service | DOWN | Rules below |

### Evidence coverage you start from (word-boundary regex, from the EDA)

| Service | Facilities mentioning | Only 1 field | ≥ 3 fields |
|---|---|---|---|
| obstetrics / delivery | 4,935 | 45% | 1,242 |
| trauma / emergency | 4,232 | 37% | 1,064 |
| ICU | 2,925 | 42% | 663 |
| oncology | 2,846 | 42% | 804 |
| dialysis | 2,483 | 41% | 729 |
| NICU | 1,562 | 49% | 269 |
| CT | 1,532 | 42% | 363 |
| cardiac surgery | 983 | 57% | 182 |
| MRI | 950 | 43% | 221 |
| cath lab | 847 | 46% | 148 |
| blood bank | 558 | 64% | 29 |
| **C‑section** | **449** | **79%** | **4** |
| ventilator | 441 | 73% | 15 |
| burn care | 280 | 56% | 47 |

### How to validate claims

**Step 1: clean the evidence** (G3, G7, G8, G9, G10) before matching anything.

**Step 2: match.** Use the service dictionary (synonyms + word boundaries). For every hit keep `{snippet, field, source_url}`.

**Step 3: score each (facility, service).**
- **Field agreement**: count of specialty / procedure / equipment / capability fields that match.
- **Specificity bonus**: counts and models ("10 dialysis machines", "1.5T MRI", "128-slice CT", "Siemens", "Level III NICU", "20-bed").
- **Source of the sentence**: own site or `.gov` > aggregator > research paper.
- **Prerequisites & contradictions:**

| Service | Supporting evidence expected | Contradiction |
|---|---|---|
| Dialysis | nephrology, haemodialysis machines, RO water plant | dentist or eye clinic |
| Emergency C‑section | obstetrics + operation theatre + anaesthesia; blood bank / 24×7 a plus | clinic with no beds, no OT |
| NICU | paediatrics / neonatology + incubators / warmers / ventilator / CPAP | no paediatrics |
| Cardiac surgery | cardiology / CT surgery + cath lab + ICU + OT | clinic or dentist |
| MRI / CT | equipment text (Tesla / slice count) | dentist (but **CBCT** is a dental CT, so don't flag it) |
| Burn care | plastic surgery / burns unit + ICU | — |
| Trauma | 24×7 emergency + orthopaedics + general surgery + CT + ICU / blood bank | clinic, no beds |

**Step 4: assign the claim level shown to the user.**

| Level | Rule |
|---|---|
| **Verified** | Confirmed by a registry (PM‑JAY specialty, NABH) or a call, from P3's `manual_verification` |
| **Strong** | ≥ 2 fields agree + prerequisites met + no type conflict |
| **Moderate** | 1 specific mention in procedure / equipment / capability + no conflict |
| **Inferred** | Not stated, but the prerequisites are present (e.g. C‑section ⇐ obstetrics + OT + anaesthesia). Always labelled as inferred |
| **Weak** | Description or specialty tag only, aggregator-only, or research language |
| **Contradicted** | Type conflict, a missing prerequisite, or only sentences naming another hospital |

> Without the **Inferred** tier, C‑section queries will mostly return nothing (449 explicit mentions against 4,935 obstetrics facilities).

### You deliver
- `fac_claims` (long table): `unique_id, service, level, n_fields, specificity, snippets[{text, field, source_url}], prerequisites_met, contradictions, reasons`.
- `service_dictionary` (versioned, so the pitch can show "how we decided").
- `fac_evidence_clean` (evidence lists after removing placeholders, padding, other-hospital and research sentences) and `flag_list_truncated`.
- `data_quality_report.md` section 4.

---

## Together: trust score, ranking & validation

### Combine
```
facility_trust      = f(location_trust [P2], phone_ok + own_domain + gov_source + n_independent_domains [P3],
                        merge_suspect_score [P3], stale_web [P3], manual_verification [P3])
claim_strength      = level from fac_claims [P4]
distance_km         = from geocode_user_input() [P2] to best_lat/lon [P2]
rank_score          = claim_strength × facility_trust × distance_decay(distance_km, location_precision)
```
- Cap or log-scale evidence counts: volume tracks web footprint (ρ ≈ 0.8 with URL count). Reward **agreement across fields**, not SEO.
- Don't use social engagement (copied follower counts) or raw bed/doctor numbers to rank.

### What the user sees for each result
- **Why this facility**: claim level, 1–3 cited snippets with field and source link, distance, size band.
- **What we couldn't verify**: the `reasons` from all four tables, in plain language.
- **Coverage note**: *"Only N facilities in our data within X km; government PHCs/CHCs are under-represented"* (88% of the data is private).

### Measure it (pitch slide)
For the 3 demo queries, compare the claim levels with P3's manual checks: *"Strong / Verified matched the registry or phone call in N of M cases."*

---

## Master checklist

**Person 1: Base table**
- [ ] Escape-aware load; quarantine 88 fragments; **stitch 30 truncated records**; drop 11 duplicates
- [ ] Normalise missing values; parse lists; drop blanks and repeats; map farmacy → pharmacy
- [ ] Numeric sanity (NULL + raw), size band, "1 doctor" flag, year fixes
- [ ] Specialty normalisation; `dup_group_id`
- [ ] NFHS parse (`*`, `(x)`, state names)
- [ ] `fac_base`, quarantine file, report section 1

**Person 2: Location**
- [ ] India Post reference (bounding box, median centroid, district, state)
- [ ] State normalisation; PIN extraction and validation; AP/Telangana rule
- [ ] `geo_mismatch_km`, `geo_status`, `city_matches_pin`, multiple-PIN and shared-coordinate flags
- [ ] OSM download + name match
- [ ] Location decision rule → `best_lat/lon`, `location_trust`
- [ ] `geocode_user_input()`, district density table, report section 2

**Person 3: Contacts & identity**
- [ ] `phonenumbers` validation, shared-number blacklist, `officialPhone` check, landline ↔ state
- [ ] Email / website / staleness / follower checks
- [ ] Source classes, slug ↔ name match, `.gov` flag
- [ ] Other-hospital-sentence detector (send to P4)
- [ ] `merge_suspect_score`, `facility_trust`
- [ ] Manual verification of the demo top-5s (PM‑JAY / NABH / ABDM / call); report section 3

**Person 4: Service claims**
- [ ] Evidence cleanup (placeholders, padding, non-medical, research, other-hospital)
- [ ] Service dictionary for 14 services; snippets with field and source
- [ ] Specificity extraction; prerequisite and contradiction rules
- [ ] Claim levels incl. Inferred; `fac_claims`; report section 4

**Everyone**
- [ ] Join the four tables → `rank_score`
- [ ] UI text: why / couldn't verify / coverage note
- [ ] Precision against manual checks → pitch slide
- [ ] Assemble `data_quality_report.md`
