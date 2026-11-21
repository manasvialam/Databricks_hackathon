# Red Flags, Validation Playbook & Team Split

Every count below was checked against the data, parsed correctly (`escapechar='\\'`, fragment rows removed, exact duplicates dropped) as in [`EDA.ipynb`](EDA.ipynb). The base is **9,989 facilities**. See [`EDA_REPORT.md`](EDA_REPORT.md) for the charts.

**Principle:** the dataset can't prove itself true. Each claim gets (a) checked for internal consistency, (b) checked against our two reference files, and (c) for top results, checked against an outside source. Flag rather than delete, keep original values, and show the reason to the user.

---

## 0. Corrections to the earlier plan (read first)

| Earlier claim | What the data actually shows | Change |
|---|---|---|
| "88 rows have shifted columns; quarantine them, repair isn't worth it" | The 88 rows are not records. They are **pieces of 30 real records** whose description contained a newline. Each record's remaining fields (specialties, equipment, coordinates, sources…) sit in the last piece. **I tested stitching: all 30 are recoverable.** | **Repair the 30 records** and quarantine only the leftover text pieces |
| "11 duplicate unique_ids: keep the most complete" | They are **byte-identical copies** | Drop one copy; no merge logic needed |
| "State doesn't match PIN: 423" | 423 lumps spelling problems together with real conflicts. After fixing spellings, **65 are real conflicts** (25 are AP/Telangana) | Count and treat them separately |
| "Phones: prefer `officialPhone`" | **255 facilities have a mass-shared helpline as their `officialPhone`** | `officialPhone` is not safe to trust automatically |
| "8001031041 on 361 facilities" | This is toll-free **1800‑103‑1041** with its leading `1` stripped by a naive `+91` removal. It also appears as `9118001031041` on 144 facilities. Bad normalisation **creates fake mobile numbers** | Normalise with `phonenumbers` (libphonenumber), not string slicing |
| "CT claimed by 2,718" | The match on `ct` hit "doctor" and similar words. With word boundaries, **1,532** | Use word-boundary regex everywhere |
| "Names with '&' = merged" | Weak signal (1,809 names, mostly "Hospital & Research Centre") | Replace with **"evidence text names a different hospital"** (§1‑H) |
| (not covered) | Lists capped at 50, LLM placeholder text, other-hospital names in evidence, aggregator URL slugs, research-paper text, copied follower counts, coverage gaps, NFHS markers | Added below |

---

## 1. Red-flag catalogue

**Action key:**
- **FIX**: correct the value deterministically.
- **FLAG**: keep the value and add a flag.
- **NULL**: blank the value but keep the original in a `raw_` column.
- **DOWN**: lower its weight in the evidence or trust score.
- **QUAR**: move to the quarantine file.

### A. File & structure

| # | Red flag | Count | Action | How |
|---|---|---|---|---|
| A1 | Non-standard CSV escaping (`\"`) | whole file | FIX | `pd.read_csv(..., escapechar='\\')` / Spark `.option("escape","\\").option("multiLine",True)` |
| A2 | Fragment rows (description text spilled onto new lines) | 88 | QUAR | Keep a row only if `unique_id` is a UUID |
| A3 | Truncated records (everything after `description` is empty) | 30 | **FIX** | Stitch: append fragment text to `description`. The last fragment holding a JSON list gives the 24 post-description columns (`specialties` sits 3 columns after its start) |
| A4 | Exact duplicate rows | 11 | FIX | `drop_duplicates()` |
| A5 | Three encodings of missing (`null`, `""`, `[]`/`[""]`) | all columns | FIX | Normalise to NaN; an empty list means *no evidence* |
| A6 | Dead or redundant columns: `countries`, `acceptsVolunteers`, `area`, `organization_type`, `address_country(Code)`, `source`, `content_table_id`, `coordinates` | 10 cols | FIX | Drop from the model; keep in raw |

### B. Location

| # | Red flag | Count | Action | How |
|---|---|---|---|---|
| B1 | State field spelled 234 ways | 234 strings | FIX | Alias map plus India Post canonical names |
| B2 | City or district in the state field (Thane, Pune, Navi Mumbai…) | 284 rows | FIX | Take the state from the PIN (272 recovered, 12 left unknown) |
| B3 | PIN malformed (`"5600"`, `"641-602"`) or space-separated (`"201 301"`) | 70 / 153 | FIX/FLAG | Strip spaces; if not 6 digits, regex a PIN out of the address lines |
| B4 | PIN not in the India Post directory | ~215 | FLAG | `pin_valid=False`; fall back to the city |
| B5 | State ≠ PIN state (true conflict) | 65 | FLAG | AP↔Telangana (25): trust the PIN (2014 split). Others: `state_conflict` |
| B6 | Coordinates > 25 km from the PIN centroid | 1,965 (20%) | FLAG | `geo_mismatch_km`; status `conflict` |
| B7 | Coordinates > 100 km from the PIN | 1,227 | FLAG+DOWN | Almost certainly wrong or merged |
| B8 | Coordinates outside India | 6 | NULL | Bounding box lat 6–37.6, lon 68–97.5 |
| B9 | Identical coordinates shared by different facilities | 37 points / 79 facilities | FLAG | `geocode_precision='locality'`; don't rank them by exact distance |
| B10 | Address text mentions ≥ 2 distinct valid PINs | 196 (9 across states) | FLAG | Merge signal |
| B11 | City name variants (Bangalore/Bengaluru, Gurgaon/Gurugram, Trivandrum…) | ~10 major pairs | FIX | Alias table, used for **user input** too |
| B12 | India Post directory: 7% missing and 2,613 garbage coordinates | reference file | FIX | Filter to the India bounding box and take the **median** per PIN (centroids are then accurate: median spread 2.4 km) |
| B13 | ~6% of PINs span two districts; 52 span two states | reference file | FLAG | District assignment by PIN is approximate |

### C. Phone numbers

| # | Red flag | Count | Action | How |
|---|---|---|---|---|
| C1 | One number on **432 facilities** (`9693969347`, nationwide, incl. Fortis & HCG): a booking or aggregator line | 432 | NULL for those facilities | Any number on ≥ 10 facilities is a shared line (26 numbers, 778 facilities) |
| C2 | Toll-free 1800‑103‑1041 on 277 + 144 facilities, partly mis-parsed as a "mobile" | 421 | FIX+NULL | Parse with `phonenumbers` |
| C3 | **`officialPhone` is itself a mass-shared number** | **255** | NULL + FLAG | Never auto-trust `officialPhone` |
| C4 | Numbers shared by 2–9 facilities (chain branches or scraping spill-over) | ~900 numbers | FLAG | Fine if the facilities share a brand name; suspicious if not |
| C5 | Invalid length after normalisation | 448 distinct (facility, number) pairs | NULL | libphonenumber `is_valid_number` |
| C6 | Placeholder numbers (`9999999999`, `1234567890`, ≤ 2 distinct digits) | 17 | NULL | Regex |
| C7 | Landline area code doesn't match the facility's state | 149 facilities (195 numbers) | FLAG | §2.1: `phonenumbers.geocoder` or the STD mapping learned from the data |
| C8 | Very long phone lists (median 3 distinct, max 48; > 20 on 122 facilities) | 122 | FLAG | Directory pages leak other businesses' numbers: a merge signal |

### D. Email, website, social

| # | Red flag | Count | Action |
|---|---|---|---|
| D1 | `[email protected]`: Cloudflare obfuscation scraped verbatim | 363 | NULL |
| D2 | Invalid email format | ~430 | NULL |
| D3 | Same email on several facilities | ~600 | FLAG (chain or aggregator) |
| D4 | Free-mail address (gmail/yahoo/rediff) | 62% | Neutral; normal for small Indian clinics. Do **not** penalise |
| D5 | `officialWebsite` is a directory or free host (business.site, practo, justdial, facebook, blogspot…) | 309 | FLAG: not an own domain |
| D6 | Same `officialWebsite` on several facilities | 579 | FLAG: chain domain (OK) or wrong attribution |
| D7 | Follower counts copied across unrelated facilities (15,000,000 on an eye hospital and a dental clinic; 4,756,342 on three different hospitals) | dozens | NULL engagement fields for ranking |
| D8 | Last social post before 2024 (possibly inactive or closed) | 2,793 | FLAG `stale_web` |
| D9 | `recency_of_page_update` in the future (2027‑07‑20) | 1 | NULL |

### E. Provenance / sources

| # | Red flag | Count | Action |
|---|---|---|---|
| E1 | Most evidence comes from aggregators (facebook ~8.8k facilities, justdial ~5.4k, practo ~2.7k) | most rows | DOWN aggregator-only evidence |
| E2 | Off-topic sources: proptiger (real estate), policyx and zurichkotak (insurance networks), indiamart (B2B), latlong.net | thousands of URLs | DOWN; these confirm existence and address at best, not services |
| E3 | **Aggregator URL slug doesn't mention the facility name**: justdial/practo URLs encode the business name, so a mismatch means the page is about *someone else* | **2,062 facilities** where < 25% of their aggregator URLs mention the name | FLAG `foreign_sources` (a strong merge signal) |
| E4 | Facility's own website missing from the sources | 53% | DOWN |
| E5 | `.gov.in` / `nic.in` source present (empanelment lists, govt directories) | 1,013 | **UP** (positive signal) |
| E6 | ≤ 1 source URL | ~43 | FLAG thin evidence |

### F. Numbers (size & history)

| # | Red flag | Count | Action | How |
|---|---|---|---|---|
| F1 | `numberDoctors` > 1,000 (max 15,000) | 11 | NULL (keep raw) | Hard threshold plus a by-type threshold (clinic > 50) |
| F2 | `capacity` > 3,000 (max 200,000) | 2 | NULL | Same (clinic > 200 beds: 10) |
| F3 | Doctors = 0 or beds = 0 | 13 / 13 | NULL | 0 means unknown, not zero |
| F4 | Year 0, 7, 15, or < 1800 | 7 | NULL | |
| F5 | **1 doctor but ≥ 100 beds** | 72 | FLAG | `numberDoctors=1` usually means *one named doctor was found*, not the staff size (1 is the most common value: 1,194) |
| F6 | Value heaping: 71% of bed counts are multiples of 10 | most | Treat beds as a **size band** (small / medium / large / unknown), never a precise number |
| F7 | Scale fields mostly missing (beds 75%, doctors 64%, year 52%) and **not at random** (clinics 97% missing beds) | — | Never impute and then display; show "unknown" |

### G. Evidence lists (specialties / procedure / equipment / capability)

| # | Red flag | Count | Action | How |
|---|---|---|---|---|
| G1 | **Lists cut off at 50 items** | **3,220 facilities (32%)** | FLAG `list_truncated` | Coordinate conflicts double in these records (23.8% vs 11.8%), so this is a merge signal |
| G2 | Blank `""` items | ~2,300 facilities (procedure, equipment) | FIX | Drop them |
| G3 | **LLM placeholder sentences**: *"No specific medical equipment listed for X in the provided content"* | 363 equipment + 272 procedure + 30 capability items | FIX | Regex `^(no|not|none)\b.*(provided|listed|mentioned|available)`; they must not count as evidence (and they contain words like "imaging") |
| G4 | Repeats inside lists (specialties 55% duplicate) | — | FIX | Use unique values |
| G5 | Free-form specialty strings (861) and singletons (1,976 of 2,933) | — | FIX | Map to the camelCase vocabulary; ignore singletons |
| G6 | `internalMedicine` on 68% of facilities | — | DOWN | Effectively a default; zero weight |
| G7 | **Capability padding** (not capabilities: "Located in…", "Listed in…", "Open 24 hrs", "Has 1 doctor") | 25,663 items on 6,951 facilities | FIX | Move to `meta_` (hours and location are useful, just not as service evidence) |
| G8 | Non-medical "equipment" (wheelchair access, parking, rooms) | ~1,300+ | FIX | Exclude from equipment evidence |
| G9 | **Evidence text names a *different* hospital** (e.g. a Fortis Kolkata sentence inside a Fortis Gurgaon record; Nair Hospital Mumbai inside Fortis) | **3,737 facilities; 1,103 with ≥ 5 such sentences** | FLAG + drop those sentences from evidence | Extract the proper noun ending in Hospital/Clinic/Institute and compare tokens with the facility name. It has false positives (affiliations like "AIIMS-trained"), so review a sample |
| G10 | **Research-paper language** ("study", "trial", "patients were", "phantom", "dosimetry", "retrospective") | 1,220 items on ~650 facilities | DOWN | Proves research happened there, not a walk-in service |
| G11 | Specialty tag ↔ free-text disagreement (nephrology without dialysis text: 826; dialysis text without the tag: 293) | — | Use both; text + equipment > tag |
| G12 | Spelling variety (34k distinct equipment strings) | — | Synonym dictionaries plus word-boundary regex, or embeddings |

### H. Contradictions (claim vs facility)

| # | Red flag | Count | Action |
|---|---|---|---|
| H1 | Clinic, dentist or doctor claiming heavy services (ICU, dialysis, cardiac surgery, NICU, C‑section, cath lab, linear accelerator) | 567 | FLAG `type_claim_conflict`; the claim drops to Weak |
| H2 | ≥ 20 specialties with ≤ 2 doctors | 316 | FLAG |
| H3 | ICU, NICU or surgery claimed with 0 or unknown beds | per service | FLAG (unknown beds is common, so this is a soft flag only when beds = 0) |
| H4 | Service claim found **only** in `description` or `specialties` | per service | Claim drops to Weak |
| H5 | Claim needs something absent from the record (cardiac surgery with no cath lab, OT or cardiology; NICU with no paediatrics or neonatology) | per service | DOWN (prerequisite rules, §2.4) |

### I. Duplicates & merges

| # | Red flag | Count | Action |
|---|---|---|---|
| I1 | Same normalised name + same city | 12 rows | `dup_group_id`; keep the most complete; check coordinates (*Sarla Hospital, Mumbai*: same PIN, coordinates 300 km apart) |
| I2 | Same name + same PIN | ~15 | Same |
| I3 | **Merged records**: combinations of G1, G9, E3, C8, B6, B10 | §3 score | `merge_suspect_score` 0–6. At ≥ 3, the facility trust level drops and the UI says *"this record may combine several facilities"* |

### J. Coverage & context

| # | Red flag | Count | Action |
|---|---|---|---|
| J1 | Top 5 states = 50% of facilities; Ladakh, Lakshadweep and DNH‑DD = 0 | — | The UI must say *"few facilities in our data for this area"* |
| J2 | 201 of 754 districts have no facilities; 246 NFHS districts have none | — | Show search radius and data density with every result |
| J3 | 88% private; only 467 public or government | — | Warn users that government PHCs/CHCs are under-represented |
| J4 | Evidence volume tracks web footprint (ρ ≈ 0.8 with URL count), an SEO bias | — | Cap or log-scale counts; reward **agreement across fields**, not volume |
| J5 | NFHS: 4,125 `*` (suppressed) and 5,068 `(x)` (low reliability) cells; state typos (`Maharastra`); duplicate district names across states | — | Parse with a reliability flag; join on state + district |

---

## 2. Validation playbook: how to tell whether a claim is true

There are three levels. **L1** uses the dataset itself, **L2** uses our reference files, and **L3** uses outside sources. L1 and L2 can run on all 9,989 records this weekend. L3 is for spot checks and top results, and makes a good demo slide.

### 2.1 Phone numbers

| Level | Check | Tool | Result |
|---|---|---|---|
| L1 | Parse and validate against the Indian numbering plan; classify as mobile, fixed or toll-free | `phonenumbers` (`pip install phonenumbers`): `parse(x,"IN")`, `is_valid_number`, `number_type` | `phone_valid`, `phone_type` |
| L1 | Shared-number check: number → count of facilities. ≥ 10 = helpline (removed from the facility); 2–9 = check whether the names share a brand | groupby | `phone_shared_n` |
| L1 | Does `officialPhone` appear in the phone list *and* not in the shared set? | set logic | `official_phone_ok` |
| L2 | **Landline location check**: a fixed-line area code identifies its city. Compare it with the PIN's district and state | `phonenumbers.geocoder.description_for_number(n,"en")` gives a city/region for Indian fixed lines. Alternative: the STD prefix → state mapping learned from consistent records (192 prefixes learned; **149 facilities mismatch**) | `phone_geo_conflict` |
| L1 | Phone list draws on several cities (≥ 3 distinct area-code states) | geocoder | merge signal |
| L3 | **Call 15–20 top recommended facilities** ("Is this X hospital? Do you offer dialysis?") | people | Demo slide: *"we called N; M confirmed"*. An honest, strong validation |
| L3 | Mobile numbers can't be located (mobile number portability); WhatsApp Business presence is a manual check only | — | — |

**Rule:** usable phone = valid, not shared by ≥ 10 facilities, and (fixed line → area code consistent with the PIN). Show at most two, preferring numbers that also appear on the facility's own website.

### 2.2 Location

| Level | Check | Result |
|---|---|---|
| L1 | Valid PIN format; PIN regex-extracted from the address if the field is broken | `pin6` |
| L1 | Do the address lines and city agree with each other (all PINs in the text in the same district)? | `addr_consistent` |
| L2 | PIN → India Post (median centroid, district, state). Distance from coordinates to the PIN centroid | `geo_mismatch_km` |
| L2 | Does the city string appear in the PIN's district name or its post-office names (fuzzy match)? | `city_matches_pin` |
| L2 | Inside the India bounding box; state = PIN state | `geo_status` |
| L3 | **OpenStreetMap corroboration**: download India `amenity=hospital|clinic|doctors|dentist` POIs **once** via Overpass (tens of thousands of points, a small file). Fuzzy-match the facility name within 2 km of its coordinates *or* of its PIN centroid | `osm_match` and `osm_dist_km`. It shows **which location is right** in a conflict |
| L3 | Reverse geocoding (Nominatim, 1 request/sec): only for conflicts among top results | district check |

**Decision rule for which location to trust:**
1. Coordinates within 25 km of the PIN: **use the coordinates**, location *verified*.
2. Conflict, and OSM matches near one of the two: **use that one**, *verified (OSM)*.
3. Conflict, and the city matches the PIN district: **use the PIN centroid**, *approximate (PIN)*.
4. Conflict, and nothing agrees: **PIN centroid**, *unverified*. The UI says *"coordinates are 180 km from the stated PIN code; showing approximate location"*.
5. Only a PIN: *approximate (PIN)*. Only coordinates: *unverified*.

> On Databricks Free Edition, outbound internet from compute may be restricted. Run the Overpass download locally, upload the result as a table, and do the matching in Databricks.

### 2.3 Does the facility exist (and is it the facility the record says)?

| Level | Signal | Weight |
|---|---|---|
| L1 | Number of **independent source domains** (own site + practo + justdial > facebook only) | + |
| L1 | Own-domain website (not business.site or a directory) | + |
| L1 | Recent activity (social post ≥ 2024, page update ≥ 2024) | + |
| L1 | Aggregator URL slugs mention the facility name (E3) | +/− (strong) |
| L1 | `.gov.in` / `nic.in` source (empanelment) | ++ |
| L1 | NABH accreditation mentioned in the record | + (verify at L3) |
| L1 | Not merge-suspect (§3) | + |
| L3 | **Official registries**, the strongest proof: **ABDM Health Facility Registry** (national facility registry, public search), **PM‑JAY / Ayushman Bharat empanelled-hospital list** (searchable by district; lists the specialties each hospital is empanelled for, which is service-level proof), **NABH** accredited-hospital list, **CGHS / ECHS / ESIC** empanelment lists (the data already cites esic.nic.in) | +++ |
| L3 | OSM or Google Maps place match (§2.2) | ++ |
| L3 | Website check for top results: it loads, and mentions the same address or phone | + |

**Weekend-realistic L3:** pick the 3 demo queries (e.g. dialysis near Patna, C‑section near Lucknow, trauma near a highway). For their top 5 results, check PM‑JAY, NABH and the phone by hand. Record the result in a small `manual_verification` table. The app then shows **"Verified"** for those, and the pitch says *"our Strong label agreed with the registries N of M times"*. That is a measured precision for your trust score.

### 2.4 Services & equipment

For each (facility, service) pair, compute an **evidence profile**:

1. **Field agreement**: which of specialty, procedure, equipment and capability mention it (word-boundary regex plus synonyms; placeholders, padding, other-hospital sentences and research sentences removed first).
2. **Specificity bonus**: concrete details ("10 dialysis machines", "1.5T MRI", "Siemens", "20-bed NICU", "Level III NICU").
3. **Prerequisite rules** (clinical plausibility):

| Service | Supporting evidence expected | Contradiction |
|---|---|---|
| Dialysis | nephrology, haemodialysis machines, RO water plant | dentist or eye clinic |
| Emergency C‑section | obstetrics + operation theatre + anaesthesia; blood bank / 24×7 a plus | clinic with no beds, no OT |
| NICU | paediatrics or neonatology + incubators / warmers / ventilators / CPAP | no paediatrics at all |
| Cardiac surgery | cardiology / CT surgery + cath lab + ICU + OT | clinic or dentist |
| MRI / CT | equipment text (field strength or slice count) | dentist (except CBCT, a dental CT, so don't flag "CBCT") |
| Burn care | plastic surgery / burns unit + ICU | — |
| Trauma | 24×7 emergency + orthopaedics + general surgery + CT + ICU / blood bank | clinic, no beds |

4. **Source of the sentence**: own site or `.gov` > aggregator > research paper.
5. **Facility trust modifier** (location, phone, merge suspicion).

**Claim levels shown to the user:**

| Level | Rule |
|---|---|
| **Verified** | Confirmed by a registry (PM‑JAY specialty, NABH) or a phone call |
| **Strong** | ≥ 2 fields agree + prerequisites met + no type conflict + facility not merge-suspect |
| **Moderate** | 1 specific mention in procedure, equipment or capability + no conflict |
| **Inferred** | Not stated, but prerequisites present (e.g. C‑section from obstetrics + OT + anaesthesia), and labelled as inferred |
| **Weak** | Description or specialty tag only, aggregator-only, or research language |
| **Contradicted** | Type conflict, prerequisite missing, or the sentence names another hospital |

Inference matters: only **449** facilities mention C‑section at all (79% in one field, 4 in ≥ 3 fields), while 4,935 claim obstetrics. Without an Inferred tier, C‑section queries will mostly come back empty.

---

## 3. How the flags combine

```
facility_trust  = f(location_status, phone_ok, source_quality, merge_suspect_score, staleness, registry_match)
claim_strength  = f(field_agreement, specificity, prerequisites, contradictions, source_of_sentence)
merge_suspect_score = list_truncated + names_other_hospital(>=5) + foreign_sources + phones>20
                      + geo_conflict>100km + multiple_PINs          (0–6)
rank_score      = claim_strength × facility_trust × distance_decay(km, location_precision)
```

Every flag carries a **plain-language reason string**, so the app can show *"Why this facility"* and *"What we couldn't verify"*.

---

## 4. Team split (4 people)

**Order of work:** Person 1 goes first, because everyone builds on the clean base table. While P1 works (about the first 1.5–2 h), P2–P4 write their rules and dictionaries against the notebook's in-memory dataframe. Then P2–P4 run in parallel. Everyone meets at the end for the trust score.

**Shared contract** (agree on this before starting):
- Every output is a table keyed by `unique_id`.
- Flags are boolean columns named `flag_<name>`.
- Each table has one `reasons` array column holding short human-readable sentences.
- Raw values are kept as `raw_<col>`.
- Write each output to a Delta table: `fac_base`, `fac_geo`, `fac_contact`, `fac_claims`.

### Person 1: Ingestion, structure & base table (the foundation)
**Owns:** A1–A6, F1–F7, G2, G4, G5, G6, I1–I2, J5 (NFHS parse).
- Escape-aware load; **stitch the 30 truncated records**; quarantine the 88 fragments; drop the 11 duplicates.
- Parse JSON lists and remove blanks and repeats; normalise missing values; set types; merge `farmacy` into pharmacy.
- Numeric sanity (NULL + `raw_`), size bands, and the "1 doctor" semantics flag.
- Specialty normalisation to the camelCase vocabulary.
- `dup_group_id`.
- Parse NFHS (`*` → null, `(x)` → value + low-reliability flag; state name fixes).
- **Delivers** `fac_base` and `data_quality_report.md` section 1 (counts for each step).

### Person 2: Location & geography
**Owns:** B1–B13, J1–J2.
- India Post reference build (bounding-box filter, median centroid, PIN → district/state).
- State normalisation; PIN extraction and validation; AP/Telangana rule.
- `geo_mismatch_km`, `geo_status`, `city_matches_pin`, `multiple_pins`, shared-coordinate flag.
- **OSM corroboration**: one Overpass download plus fuzzy name match within 2 km.
- Location decision rule (§2.2): `best_lat`, `best_lon`, `location_precision`, `location_trust`.
- User-input geocoder (city/PIN/district → coordinates, with the alias table).
- District density table for the "under-covered area" message (joined to NFHS).
- **Delivers** `fac_geo` and the geocoder function.

### Person 3: Contacts, sources & identity (does the facility exist / is it a merge?)
**Owns:** C1–C8, D1–D9, E1–E6, G9, I3.
- `phonenumbers` validation, shared-number blacklist, `officialPhone` check, landline area code ↔ state.
- Email and website checks; copied-follower check; staleness flag.
- Source domain classification (own / gov / aggregator / off-topic); **aggregator URL slug ↔ name match**.
- **Other-hospital-name detector** in evidence text (outputs the offending sentences so P4 can drop them).
- `merge_suspect_score`, `facility_trust`.
- Organise the **L3 manual verification**: PM‑JAY, NABH, ABDM lookups and phone calls for the demo queries' top results.
- **Delivers** `fac_contact` and `manual_verification`.

### Person 4: Services, equipment & claim evidence
**Owns:** G1, G3, G7, G8, G10–G12, H1–H5.
- Clean the evidence: remove placeholders, padding, non-medical equipment and research sentences, plus P3's other-hospital sentences.
- Service dictionary (synonyms + word-boundary regex) for at least the 14 services in the EDA. Keep the matched **snippet + field + source URL** for citation.
- Specificity extraction (counts, Tesla, slice, brand, bed count).
- Prerequisite and contradiction rules (§2.4) and the Inferred tier.
- `claim_strength` per (facility, service), with reason strings.
- **Delivers** `fac_claims` (long table: unique_id, service, level, snippets, fields, reasons).

### Together (final block)
- Join `fac_base` + `fac_geo` + `fac_contact` + `fac_claims`, then compute `rank_score`.
- **Measure the trust score** against the manual verification ("Strong agreed with registries in N/M").
- UI text: *Why this facility* / *What we couldn't verify* / *Data coverage in this area*.

---

## 5. Checklist (copy into your tracker)

- [ ] P1 escape-aware load, stitch 30, quarantine 88, drop 11
- [ ] P1 list parsing and cleanup, numeric NULL + raw, size bands, specialty normalisation, NFHS parse
- [ ] P2 PIN reference, state fix, geo_mismatch, geo_status, OSM match, best location, geocoder
- [ ] P3 phonenumbers, shared blacklist, area code check, email/web, source classes, slug match, other-hospital detector, merge score
- [ ] P3 manual verification of demo top-5s (PM‑JAY / NABH / call)
- [ ] P4 evidence cleanup, service dictionary, snippets, prerequisites, inferred tier, claim levels
- [ ] All: join, rank, measure precision, reason strings, data_quality_report.md
