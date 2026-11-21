# Person 1 Report: Clean Base Table + Verification Against Real Data

**What this is:** a plain-language account of what Person 1's work did to the facility data, why, and what came out, with the numbers that back it up. All numbers come from the pipeline run (`output/run_stats.json`, `output/verification_stats.json`). The step-by-step counts are in [`output/data_quality_report.md`](output/data_quality_report.md).

**Updated 21 Nov 2026** with the team's decisions:
- Keep large bed and doctor counts as "very large / super-speciality scale".
- Keep very old founding years.
- Add a clean `display_name`.
- Verify the data against real outside sources, and add a recognition column.

---

## 1. The result in one paragraph

The file had **10,088 rows**. 88 were not facilities (broken pieces of records). We **repaired all 30 broken records**, removed **11 exact duplicate copies**, and ended with **9,989 facilities** in one table: `fac_base.parquet`, 148 columns.

Every facility was then checked against real outside data:
- the official **India Post** PIN directory, for the address;
- **Wikidata**, an independent public database of 3,105 Indian hospitals and medical schools, for founding year, beds and Wikipedia presence;
- **web searches** for every extreme value.

Results:
- **6,378 addresses (63.9%) are verified** and **1,470 (14.7%) contradict official data**.
- **285 facilities were matched to Wikidata**. **116 founding years are confirmed** by Wikidata, and 24 disagree with it (both values are now shown).
- **Of the 15 extreme values checked on the web, 2 are confirmed, 2 are chain-wide totals, 8 are contradicted and 3 couldn't be checked.**

Each facility also has a **recognition tier** (high 166, moderate 435, some 2,185, no evidence found 7,203), built from verifiable signals. Every claim comes with a written evidence list.

---

## 2. Where to find everything

```
Person_1/
├── build_fac_base.py      step 1: clean the data                      (~15 s)
├── verify_external.py     step 2: verify against outside data          (~35 s, uses cached downloads)
├── make_report.py         step 3: write data_quality_report.md from the numbers
├── PERSON1_REPORT.md      this file
├── dataset/               the 3 input CSVs (real data)
├── external/              outside data used for verification
│   ├── wd1.csv, wd2.csv                     Wikidata: Indian hospitals + their alternative names
│   ├── wd1_medschool.csv, wd2_medschool.csv Wikidata: Indian medical schools (e.g. AIIMS Rishikesh)
│   └── manual_web_checks.csv                web checks of extreme values, with source URLs
└── output/
    ├── fac_base.parquet          9,989 rows × 148 columns  ← the table P2, P3, P4 use
    ├── fac_base_preview.csv      first 200 rows, opens in Excel
    ├── facilities_quarantine.csv 88 broken pieces
    ├── nfhs_clean.parquet/.csv   NFHS-5 district data, cleaned
    ├── wikidata_matches.csv      285 facility ↔ Wikidata matches, with method / similarity / distance
    ├── value_corrections.csv     32 values replaced (web) or filled (Wikidata)
    ├── value_disputes.csv        36 values where the record and Wikidata disagree
    ├── data_quality_report.md    every step with counts (for the pitch)
    └── run_stats.json, verification_stats.json
```

**To rerun:** `python Person_1/build_fac_base.py && python Person_1/verify_external.py && python Person_1/make_report.py`

---

## 3. Cleaning (what changed since the last version)

Steps 1–10 from the first version are unchanged (full detail in `data_quality_report.md`):
- loading the file correctly, and repairing the 30 broken records (30/30);
- removing 11 duplicates;
- making "missing" mean one thing, and cleaning lists (blanks and repeats removed);
- `flag_list_truncated` (3,226 facilities);
- setting aside 9 dead columns, and fixing types and categories;
- merging 451 specialty spellings;
- NFHS cleaning.

**Changes from your decisions:**

| Topic | Before | Now |
|---|---|---|
| Very large doctor counts (>1,000) | removed | **kept**, flagged `flag_doctors_extreme` (11), and checked on the web |
| Very large bed counts (>3,000) | removed above 5,000 | **kept**, flagged `flag_capacity_extreme` (2), and checked on the web |
| Clinics/dentists with 50+ doctors | flagged (18) | still flagged only; now **22**, because the large counts are no longer removed |
| Founding years before 1800 | removed | **kept**, flagged `flag_year_very_old` (2: INHS Asvini 1756, Changethu 1723), and checked on the web |
| "Years" 0, 7, 15 | removed | still removed (5 rows): they can't be years. Originals kept in `raw_yearEstablished` |
| Size labels | `size_band` | `size_band` (beds) **and** `doctor_band` (doctors). Top band in both: **"very large / super-speciality scale"** (500+ beds: 254 facilities; 100+ doctors: 178) |
| Names with an address in them | not changed | new **`display_name`**: 121 names contained a PIN, all shortened, e.g. *"Dr. Mutha Hospital, P - 67, MIDC, … Nashik - 422007"* → *"Dr. Mutha Hospital"*. `name` is unchanged |

About 5 of the 121 display names still carry a leftover word, e.g. *"Siddhi Vinayak Hospital Punit"* and *"Indira IVF Clinic Rudra"*. One is a building name in the source itself (*"OM PLAZA"*).

---

## 4. Verification: how I checked whether the data is true

The dataset can't prove itself. So each kind of claim was compared with a source that doesn't depend on the dataset, wherever one existed:

| What | Checked against | Independent? | Columns |
|---|---|---|---|
| Address | **India Post PIN directory** (official government data) + Wikidata location | ✅ yes | `address_check`, `address_evidence` |
| Founding year | **Wikidata** "inception" date; **web search** for extremes; facility's own text | ✅ Wikidata and web; ⚠️ own text is the same source | `year_check`, `year_evidence` |
| Beds | **Wikidata** "number of hospital beds"; **web search**; own text | same as above | `capacity_check`, `capacity_evidence` |
| Doctors | **web search** for extremes; own text | same as above | `doctors_check`, `doctors_evidence` |
| Reputation / standing | Wikipedia (via Wikidata), accreditation claimed in the record, teaching status, verified age | partly | `recognition_tier`, `recognition_score`, `recognition_evidence` |

Every check writes **plain-English evidence**, e.g. *"PIN 110002 = Central district, Delhi (India Post); stated state 'Telangana' differs from the PIN's state; coordinates are 1,871.0 km from the PIN centre"*.

### 4.1 Matching our facilities to Wikidata (and how I checked the matching itself)
- Wikidata has **3,105 Indian hospitals and medical schools**: 704 with a founding date, 106 with a bed count, 611 with an English Wikipedia article.
- A facility is matched only if **the names agree AND it is within 15 km**, using either its coordinates or its PIN centre (because ~16% of coordinates are wrong). Its own website domain can lower the name bar slightly. Generic words ("hospital", "medical"), state names and the facility's own city are ignored when comparing names. A specialty mismatch (Dental vs not) is penalised. One Wikidata item can match only one facility.
- **I checked the matches by eye: about 310 in 7 random samples.** The first version made real mistakes, and I fixed the rules each time:

| Error found | Example | Fix |
|---|---|---|
| Chains matched to the wrong branch | *Fortis Gurugram* → a Fortis entry 1,731 km away; *AIIMS Bhubaneswar* → AIIMS New Delhi | Always require distance ≤ 15 km |
| Scraped website lists contain other hospitals' sites | *Chinmaya Hrudayalaya* → *Narayana Hrudayalaya* | Use only `officialWebsite` |
| Names sharing only a city name | *Kottayam Dental Home* → *General Hospital, Kottayam* | Ignore city words |
| Same type, different town | *Taluk HQ Hospital Punalur* → *Cherthala Taluk HQ Hospital* | Keep the town when the name is only an institution type |
| Different kind of institution | *Patna Medical College* → *Patna Dental College* | Penalise specialty-word mismatch |
| Teaching hospitals missing | *AIIMS Rishikesh* not found | Added medical schools to the Wikidata pull |

- **Final accuracy:** 50/50 correct in a general sample, and 29/30 in a medical-school sample. The miss was *SVIMS Tirupati* → *Sri Venkateswara Medical College*. Two doubtful matches remain: *Krishna Clinic* → Krishna Heart Institute, and *Regional Mental Hospital Nagpur* → Yerwada Mental Hospital.
- **Result: 285 facilities matched** (median distance 0.13 km), 147 of them with an English Wikipedia article. The 4 wrong or doubtful matches found in the audit are rejected in the code: the 3 above plus *Max Centre for Liver & Biliary Sciences* → ILBS, a different hospital.
- **Limit:** only ~3% of our facilities are on Wikidata, mostly large or well-known ones. Small clinics can't be checked this way.

### 4.2 Addresses

| Result | Facilities | Meaning |
|---|---|---|
| **verified** | 6,378 (63.9%) | PIN exists, state matches, coordinates within 10 km of the PIN centre, and the city appears in the PIN's district or post-office names |
| consistent | 1,145 | Same, but 10–25 km away or city name not found |
| partly consistent | 707 | 25–100 km away |
| **conflict** | 1,470 (14.7%) | State contradicts the PIN, or coordinates more than 100 km from the PIN |
| unverifiable | 283 | No valid PIN |
| partly verified | 6 | No valid PIN, but Wikidata places the facility at these coordinates |

- Hospitals have **more** conflicts (17.9%) than clinics (10.8%). Big hospitals are the ones most often merged with other facilities' data.
- **Limit:** this confirms the PIN, city, state and coordinates agree with official data. It **cannot** confirm the street or building. Person 2 can go further (OpenStreetMap, which this network couldn't reach).

### 4.3 Founding years

| Result (final) | Facilities |
|---|---|
| confirmed by Wikidata (±1 year) | 116 |
| close to Wikidata (2–5 years apart: usually registration vs opening) | 18 |
| confirmed by web check | 4 (INHS Asvini 1756, RIMS 1960, Goa Medical College 1842, Mohak 2010) |
| **corrected by web check** | 3 (IMS & SUM 1978 → 2007, Oyster & Pearl 1960 → 2008, MIOT 1987 → 1999) |
| **filled from Wikidata** (record had none) | 24 |
| **disputed: record vs Wikidata** (both shown) | 24 |
| consistent with the facility's own text ("established in 1987") | 2,978 |
| conflicts with the facility's own text | 245 |
| no other source | 1,379 |
| missing | 4,995 (+200 where only the facility's own text has a year; not filled, because it's the same source) |

Some of the disputed cases are probably record errors: *PGIMER Chandigarh* (record 1997, Wikidata 1962), *SSKM / PG Hospital Kolkata* (1999 vs 1707), *Medical College Kolkata* (2004 vs 1835). But I only replace values I have checked (see §4.6), because Wikidata is sometimes the one that's wrong.

### 4.4 Beds and doctors
- **Beds:**
  - 25 confirmed by Wikidata (within 20%).
  - 12 disputed (both values shown), e.g. *Sankara Nethralaya* 250 vs 1,000 in Wikidata; *Osmania General Hospital* 2,000 vs 1,168.
  - 4 filled from Wikidata; 1 corrected by web check (Wockhardt Nagpur 1,600 → 118, from its NABH certificate).
  - 1,585 consistent with the facility's own text.
  - 134 differ from the text, often because the text mentions one unit (e.g. "20-bed ICU").
- **Doctors:** 414 consistent with the facility's own text, 160 differ. No outside source covers doctor counts at scale.

### 4.5 Every extreme value, checked on the web (with sources)

| Facility | Claim | Verdict | What the sources say |
|---|---|---|---|
| KGMU Lucknow | 4,000 beds | ✅ **confirmed** | KGMU's NIRF 2025 submission: 4,000 beds |
| Harsh Hospital, Motihari | 200,000 beds | ❌ contradicted | No source; the only figure found (30 beds) is a different Harsh Hospital in Patna |
| INHS Asvini, Mumbai | founded 1756 | ✅ **confirmed** | Indian Navy / Wikipedia: King's Seamen's Hospital, Colaba, 1756 |
| Changethu Ayurveda | founded 1723 | ⚠️ unverified | Family Ayurveda tradition from the 17th century; no source gives 1723 |
| Nithya Hospital, Dharmapuri | 15,000 doctors | ❌ contradicted | Small hospital, 2 listed specialties |
| KIMS, Hyderabad | 6,000 doctors | ❌ contradicted | Whole group ~979 doctors (directory); branches 51–114 |
| Sahyadri, Pune | 2,000 doctors | ⚠️ chain-wide | Sahyadri's own site: 2,000+ clinicians across the chain |
| Wockhardt, Nagpur | 1,400 doctors | ❌ contradicted | NABH certificate: 118 beds; directories ~41–150 doctors |
| Narhari, Vadodara | 2,860 doctors | ⚠️ unverified | No public figure |
| Scientific Pathology, Agra | 5,000 doctors | ❌ contradicted | 3 labs + 11 collection centres |
| Vijaya Diagnostic, Visakhapatnam | 3,000 doctors | ❌ contradicted | Annual report: 300+ doctors across all 151 centres |
| Medall Diagnostics, Chennai | 2,500 doctors | ⚠️ chain-wide | National chain, no doctor count published |
| Nova IVF, Bengaluru | 1,500 doctors | ⚠️ unverified | Chain of 62–83+ centres; no doctor count |
| Asian Eye Hospital, Pune | 1,100 doctors | ❌ contradicted | Single eye hospital; ~2 named doctors |
| Megavision, Pimpri | 3,000 doctors | ❌ contradicted | Two diagnostic centres |

**Takeaway:** as agreed, the values are **kept** and banded as "very large / super-speciality scale". But 8 of the 13 doctor/bed extremes are contradicted, and 2 more are chain-wide totals. So the app should **show the verdict next to the number** (`capacity_check` / `doctors_check` now say e.g. *"web: contradicted"*), and the source links are in `web_check_sources`.

### 4.6 Real values instead of the dataset's values

You asked for the real values to replace the dataset's where we know them. **Rules:**

1. **A web check found a specific value** → it replaces the record value. The `*_source` column names the source URL. (4 values)
2. **The record is empty and Wikidata has a value** → filled from Wikidata. (28 values: 24 years, 4 bed counts)
3. **The record and Wikidata disagree, and no web check yet** → the record stays, Wikidata's value goes in `*_alt_value`, and the check says *"disputed"*. (36 values: 24 years, 12 bed counts)

**Why not always use Wikidata?** I checked 8 of the year disagreements on the web:
- Wikidata was right in 1: MIOT opened in 1999.
- The record was right in 3: RIMS 1960, Goa Medical College 1842, Mohak 2010. Wikidata's dates there are an upgrade, a precursor school, and an unsupported year.
- Neither was right in 2: Oyster & Pearl opened in 2008; IMS & SUM in 2007.
- 2 are unresolved: Anandalok and Chandulal Chandrakar.

So copying Wikidata blindly would add new errors.

**Doctor counts:** none of the 8 contradicted doctor counts could be replaced. The sources only give ranges or chain-wide totals, e.g. Wockhardt Nagpur "~41–150 doctors" and Vijaya "300+ across 151 centres". Putting a made-up number in would be worse, so the record value stays and `doctors_check` says "web: contradicted".

The dataset's original value is always in `raw_<col>`. Every change is listed in `output/value_corrections.csv` and every disagreement in `output/value_disputes.csv`. The 36 disputes are the obvious next thing to web-check.

### 4.7 Reputation: the new `recognition_tier` column

**Is it necessary?** I think yes, as a **tie-breaker and a trust signal**, not as the main ranking. Between two hospitals that both have strong evidence for dialysis, a teaching hospital with a Wikipedia article and verified NABH accreditation is a safer suggestion. The app can show the reasons.

**What it is NOT:** a patient-review score. I couldn't find a lawful, free source of reviews that covers 10,000 Indian facilities:
- Google ratings need a paid API key.
- Scraping Justdial or Practo breaks their terms of service and is unreliable.

So the score counts **verifiable signs of standing**:

| Signal | Points | Source |
|---|---|---|
| English Wikipedia article | +3 | Wikidata match (independent, editorially reviewed) |
| On Wikidata only | +1 | Wikidata |
| NABH / JCI accreditation claimed | +2 | the record's text (claim, not checked against the NABH register) |
| NABH entry-level / pre-accreditation, or NABL (lab) | +1 | the record's text (138 facilities claim only entry-level NABH, so it is scored lower) |
| Teaching hospital / medical college / academic | +2 | name + affiliation |
| Operating ≥ 50 years | +2 | year confirmed by Wikidata/web, or consistent with own text |
| Operating 25–49 years | +1 | same |

**Tiers:** high (≥5) **166** · moderate (3–4) **435** · some (1–2) **2,185** · no evidence found (0) **7,203**.

- **High** examples: PGIMER Chandigarh, Sankara Nethralaya, Narayana Hrudayalaya, AIIMS Rishikesh, CMC Ludhiana, Sher-i-Kashmir Institute of Medical Sciences.
- **"No evidence found" means unknown, not bad.** Most small clinics have no Wikipedia page or accreditation listed, but may be perfectly good.
- **Known undercount:** some famous hospitals score lower when their record is mixed up. *Tata Memorial Hospital* only reaches "some": its PIN is in Nagpur, so it can't be location-matched to Wikidata.

---

## 5. How I checked the final output

Checks on the final table, **all passed:**
- 9,989 rows with unique IDs.
- All flags are true/false.
- Large values kept (max 15,000 doctors and 200,000 beds, as decided).
- Old years kept (earliest 1723).
- No zero doctors or beds left.
- Extreme flags: 11 doctors, 2 beds.
- `display_name`, `address_check`, `year_check`, `capacity_check`, `doctors_check` and `recognition_tier` filled on every row.
- 15 facilities carry web sources.
- Every row has a `reasons` list.

The earlier cleaning checks also still hold: lists have no blanks or repeats, there are no leftover null tokens, `raw_` originals are kept, and NFHS and quarantine counts are correct.

---

## 6. Other things I found

1. **The data files in the repo are Git LFS placeholders.** Since commit `fc98979`, `Dataset/*.csv` are 133-byte pointers, and Git LFS isn't installed here. I restored the real files from commit `3f2ca4d`: `facilities.csv` has an identical hash; the other two differ only by Windows line endings. Teammates need `git lfs pull`.
2. **OpenStreetMap's bulk download (Overpass) is unreachable from this network.** Nominatim works, but its rules forbid geocoding ~10,000 records. Person 2 may need to run the OSM step on another network.
3. **The NABH register is published as PDFs per hospital** (`portal.nabh.co/Documents/AccreditedList/...`). Two showed up in the web searches, e.g. Wockhardt Nagpur's certificate confirming 118 beds. It's possible to check accreditation claims against it for top results, but there's no single downloadable list.
4. **One repaired record is clearly merged:** *Mother And Child Care, Ghaziabad* has a University of Lucknow staff list as its description and coordinates in Kanpur.

---

## 7. Open questions

1. **Reviews:** no API key is available (decided 21 Nov). Scraping Google Maps, Justdial or Practo is against their terms and gets blocked, so it isn't part of the pipeline. For the demo, a teammate can look up the Google rating of the few facilities shown and record it by hand, with the link.
2. **What the app shows when a number is contradicted** (e.g. *Nithya Hospital: 15,000 doctors*, web says it's a small hospital): show the number as-is, or show *"doctor count unverified (record says 15,000; sources suggest a small hospital)"*? Recommended: the second.
3. **Recognition points (§4.7):** should NABH/JCI accreditation (an inspection of quality) count more than a Wikipedia article (a sign of fame)? Recommended: accreditation +3, Wikipedia +2.
4. **36 disputed values:** web-check them next so the real value can replace the record where confirmed?
5. **Committing:** commit the code and reports, and leave the data and outputs out (the repo sends `.csv` to Git LFS)?

## 8. What teammates can rely on in `fac_base` (148 columns)

| Column type | Examples |
|---|---|
| Key | `unique_id` |
| Cleaned values | `name`, `display_name`, `address_*`, `facilityTypeId`, `numberDoctors`, `capacity`, `yearEstablished`, `specialties`, `procedure`, `equipment`, `capability`, `latitude`, `longitude`, `source_urls`… |
| Bands | `size_band`, `doctor_band` |
| Real values | `yearEstablished_source`, `capacity_source`, `numberDoctors_source` (where each value comes from); `yearEstablished_alt_value`, `capacity_alt_value` (+ `_alt_source`) when Wikidata disagrees |
| Verification | `address_check` + `address_evidence`, `pin6`, `pin_state`, `pin_district`, `km_coords_to_pin`, `city_matches_pin`, `year_check` + `year_evidence`, `capacity_check` + `capacity_evidence`, `doctors_check` + `doctors_evidence`, `web_check_sources` |
| Wikidata | `wd_qid`, `wd_label`, `wd_match_method`, `wd_name_similarity`, `wd_distance_km`, `wd_inception_year`, `wd_beds`, `wd_enwiki` |
| Recognition | `recognition_tier`, `recognition_score`, `recognition_evidence` |
| Flags | `flag_repaired_record`, `flag_list_truncated`, `flag_doctors_extreme`, `flag_capacity_extreme`, `flag_year_very_old`, `flag_year_invalid`, `flag_one_doctor_many_beds`, `flag_doctors_high_for_type`, `flag_beds_high_for_type`, `flag_possible_duplicate` |
| Text for the app | `reasons` |
| Originals | `raw_<col>`, `rawlen_<col>`, `raw_description_truncated` |

**Overlap with Person 2:** `address_check` already does most of Person 2's PIN, state and coordinate checks. Person 2 can reuse it and spend their time on OpenStreetMap and choosing the best location, instead of redoing it.
