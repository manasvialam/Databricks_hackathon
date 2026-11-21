## 2. Location and geography (Person 2)

Base: 9,989 facilities. Locations were decided with the rule in the playbook plus two additions (see Notes). Table: `fac_geo` (one row per `unique_id`).

| # | Red flag | Count | Action |
|---|---|---|---|
| B1 | State field has hundreds of spellings | 234 strings -> 34 canonical | FIX: alias map + India Post names |
| B2 | City/district typed in the state field | 278 | FIX: state from the PIN (267 recovered) |
| B3 | PIN had a space/hyphen / was malformed | 156 / 73 | FIX: cleaned; else read from the address text |
| B4 | PIN not in the India Post directory | 209 | FLAG: flag_pin_invalid; falls back to coordinates or district |
| B5 | State differs from the PIN's state | 64 (26 AP/Telangana) | FLAG; AP/Telangana trust the PIN; 15 PINs ignored where address and coordinates both disagree |
| B6 | Coordinates > 25 km from the PIN centroid | 1924 | FLAG: geo_mismatch_km, geo_status = conflict |
| B7 | Coordinates > 100 km from the PIN | 1191 | FLAG + trust penalty; PIN centroid used unless OSM or district agreement supports the coordinates |
| B8 | Coordinates outside India | 6 | NULL (original kept in raw_latitude / raw_longitude) |
| B9 | Facilities on identical coordinates | 81 | FLAG: location_precision = locality |
| B10 | Address mentions 2+ distinct valid PINs | 89 | FLAG: flag_multiple_pins (feeds the merge score) |
| B11 | City name variants | 60 aliases | FIX: shared alias table, also used for user input |
| B12 | India Post coordinates missing / garbage | 11907 / 3459 | FIX: bounding box + state filter, median per PIN |
| B13 | PINs spanning two districts / two states | 1258 / 52 | FLAG: flag_pin_spans_districts / flag_pin_spans_states |
| J1 | Top-5 states share of facilities | 49.7% | state_coverage table; UI coverage note |
| J2 | Districts with no facilities (India Post / NFHS-linked) | 199 of 754 / 172 | district_density table |

### Outcome

| location_trust | facilities | share |
|---|---|---|
| verified | 7733 | 77.4% |
| verified_osm | 799 | 8.0% |
| unverified | 614 | 6.1% |
| approximate_pin | 586 | 5.9% |
| probable | 256 | 2.6% |
| unknown | 1 | 0.0% |

Trust level (score-based): high 8756, medium 617, low 616.
A usable best location exists for 9,988 of 9,989; precision: coordinates 8807, pin_centroid 1109, locality 72, none 1.

### Notes

* OpenStreetMap (87,469 places) matched 3,379 facilities. Of 1924 coordinate-vs-PIN conflicts it supported the coordinates 609 times and the PIN 190 times.
* Added tier `probable`: coordinates in the same district as the PIN and within 100 km are kept. Where OSM could arbitrate, the coordinates were right about three times in four, so discarding them would lose good data.
* Added tier `approximate_district` (only the district is known). `location_trust` therefore has seven labels, a superset of the playbook's five; map `probable` to verified-with-caution if a strict five-way label is needed.
* The India Post directory is itself wrong for some PINs (for example 799001 in Agartala is filed under Telangana). When the address state and the coordinates both disagree with the PIN, the PIN is ignored.
* B10 is counted on address fields only (stricter than the playbook's 196).
* The 30 truncated records have no coordinates until Person 1's stitched `fac_base` replaces the stand-in base.
* District-by-PIN is approximate where a PIN spans districts; `flag_district_conflict` shows where the PIN and the coordinates disagree.
