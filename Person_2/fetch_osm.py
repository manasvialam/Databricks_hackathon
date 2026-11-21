"""
OPTIONAL (playbook L3, section 2.2): download India's OpenStreetMap health places ONCE, so Person 2 can corroborate locations.

NOT RUN YET - it downloads a file from a public server (overpass-api.de), so run it only with the team's OK.
Expected result: roughly 30-60k points, a few MB, written to Person_2/outputs/osm_health_poi.csv with columns name, lat, lon, amenity.
Takes several minutes (one request per state, 5 s apart, to stay polite to the public Overpass server).

    python fetch_osm.py                 # download
    # then, in Python:
    osm = pd.read_csv("outputs/osm_health_poi.csv")
    geo = gp.build_fac_geo(base, ref, osm=osm)    # fills osm_match / osm_dist_km / osm_near and activates the 'verified_osm' rule

On Databricks Free Edition outbound internet from compute may be blocked: run this locally and upload the CSV.
"""
import csv
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

import geo_pipeline as gp

OUT = Path(__file__).resolve().parent / "outputs" / "osm_health_poi.csv"
ENDPOINT = "https://overpass-api.de/api/interpreter"
AMENITIES = "hospital|clinic|doctors|dentist"


def query_for(state_name):
    # `area` is matched by the state's OSM name; names that differ in OSM are simply skipped and reported
    return f"""[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="4"]["name:en"~"^{state_name}$",i]->.a;
(node["amenity"~"^({AMENITIES})$"](area.a); way["amenity"~"^({AMENITIES})$"](area.a); );
out center tags;"""


def fetch_state(st, tries=4):
    """One state, with exponential back-off: 502/504 from the public server just means 'busy', so wait and try again."""
    name = st.title().replace(" And ", " and ").replace("The Dadra", "Dadra")
    req = urllib.request.Request(ENDPOINT, data=urllib.parse.urlencode({"data": query_for(name)}).encode(), headers={"User-Agent": "datathon-geo-check/1.0"})
    err = None
    for k in range(tries):
        try:
            return json.load(urllib.request.urlopen(req, timeout=240)), None
        except Exception as e:  # noqa
            err = str(e)[:60]
            time.sleep(30 * 2 ** k)          # 30 s, 60 s, 120 s, 240 s
    return None, err


def main(only=None):
    """python fetch_osm.py                -> all states
       python fetch_osm.py MAHARASHTRA .. -> only these (merged into the existing CSV)"""
    here = Path(__file__).resolve().parent
    src = here / "data" if (here / "data").exists() else here.parent / "Dataset"
    ref = gp.build_reference(src / "india_post_pincode_directory.csv")
    states = [s for s in ref["canon"] if not only or s in only]
    rows, skipped = [], []
    for st in states:
        data, err = fetch_state(st)
        if data is None:
            skipped.append((st, err)); print(f"{st}: FAILED ({err})", flush=True); continue
        for el in data.get("elements", []):
            lat = el.get("lat") or (el.get("center") or {}).get("lat")
            lon = el.get("lon") or (el.get("center") or {}).get("lon")
            nm = (el.get("tags") or {}).get("name")
            if lat and lon and nm:
                rows.append((nm, lat, lon, el["tags"].get("amenity")))
        print(f"{st}: {len(data.get('elements', []))} elements", flush=True)
        time.sleep(10)
    OUT.parent.mkdir(exist_ok=True)
    if only and OUT.exists():                 # merge with what is already there, drop exact duplicates
        import pandas as pd
        old = pd.read_csv(OUT)
        new = pd.concat([old, pd.DataFrame(rows, columns=["name", "lat", "lon", "amenity"])]).drop_duplicates(["name", "lat", "lon"])
        new.to_csv(OUT, index=False); total = len(new)
    else:
        with open(OUT, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f); w.writerow(["name", "lat", "lon", "amenity"]); w.writerows(rows)
        total = len(rows)
    print(f"file now holds {total} named places ({OUT}); states that still failed: {skipped}")


if __name__ == "__main__":
    import sys
    main(set(a.upper() for a in sys.argv[1:]) or None)
