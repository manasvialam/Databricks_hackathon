"""
Export the data the TypeScript geocoder needs, reusing Person 2's pipeline (Person_2/geo_pipeline.py, geocoder.py).

Writes web/data/geocoder.json:
  states       canonical state names (India Post)
  pins         { pincode: [lat, lon, stateIdx, districtName] }  clean median centroids
  places       { normalised name: [[stateIdx, district, lat, lon, level, label, weight], ...] }  districts, towns, verified facility cities
  stateCentroid{ state: [lat, lon] }
  cityAlias / stateAlias   alias tables shared with facility cleaning

Run:  python scripts/export_geocoder_data.py
"""
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "Person_2"))
import geo_pipeline as gp  # noqa: E402
import geocoder as G  # noqa: E402


def main():
    ref = gp.build_reference(ROOT / "Dataset" / "india_post_pincode_directory.csv")
    geo = pd.read_csv(ROOT / "Person_2" / "outputs" / "fac_geo.csv",
                      usecols=["unique_id", "location_trust", "city_key", "state_final", "best_lat", "best_lon", "district_final"])
    gc = G.Geocoder(ref, geo)
    states = list(ref["canon"])
    sidx = {s: i for i, s in enumerate(states)}
    pr = ref["ref"].dropna(subset=["lat", "lon"])
    pins = {p: [round(float(r.lat), 4), round(float(r.lon), 4), sidx.get(r.state, -1), r.district] for p, r in pr.iterrows()}
    level_code = {"district": "d", "post_office": "p", "city": "c"}
    places = {}
    for key, cands in gc.index.items():
        places[key] = [[sidx.get(c["state"], -1), c["district"], round(c["lat"], 4), round(c["lon"], 4), level_code.get(c["level"], "d"), c["label"], c["weight"]] for c in cands]
    sc = ref["state_centroid"]
    out = {
        "states": states, "pins": pins, "places": places,
        "stateCentroid": {s: [round(float(r.lat), 4), round(float(r.lon), 4)] for s, r in sc.iterrows()},
        "cityAlias": gp.CITY_ALIASES, "stateAlias": {gp.skey(k): v for k, v in gp.STATE_ALIASES.items()},
    }
    dest = ROOT / "web" / "data" / "geocoder.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"states {len(states)} | pins {len(pins)} | place names {len(places)} | {dest.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
