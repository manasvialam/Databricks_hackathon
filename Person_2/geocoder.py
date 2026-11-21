"""
User-input geocoder: "Patna", "Bangalore", "800001", "Jaipur, Rajasthan", "25.59, 85.13", "Aurangabad"  ->  coordinates.

Built only from the India Post directory + Person 2's `fac_geo` (no internet needed, runs on Databricks Free Edition).
Resolution order: coordinates -> PIN code -> exact city/district/post-office name (alias table applied) -> fuzzy match.
Ambiguous names (e.g. "Aurangabad" is in Bihar and Maharashtra) return all candidates and ask the caller to disambiguate.

    gc = Geocoder.build("data/india_post_pincode_directory.csv", fac_geo)
    gc.geocode("Bangalore")            # -> {'status': 'ok', 'lat': ..., 'lon': ..., 'level': 'district', ...}
    gc.geocode("Aurangabad")           # -> {'status': 'ambiguous', 'candidates': [...]}
    gc.geocode("Aurangabad", state="Bihar")
    gc.within_radius(lat, lon, 50, fac_geo)   # facilities near a point + data-density message
"""
import re
import difflib

import numpy as np
import pandas as pd

from geo_pipeline import (build_reference, canon_city, haversine_km, in_india, lkey, skey, _words)

LEVEL_ORDER = {"coordinates": 0, "pin": 1, "post_office": 2, "city": 2, "district": 3, "state": 4}
FUZZY_CUTOFF = 0.84


class Geocoder:
    def __init__(self, reference, fac_geo=None):
        self.ref = reference
        pin = reference["pin"]
        self.pin_ref = reference["ref"]
        self.norm_state = reference["norm_state"]
        self.canon_states = reference["canon"]

        # ---- name index: key -> list of candidate dicts (state, district, lat, lon, level, label, weight)
        idx = {}

        def add(key, state, district, lat, lon, level, label, w):
            if not key or pd.isna(lat) or pd.isna(lon):
                return
            idx.setdefault(key, []).append(dict(state=state, district=district, lat=float(lat), lon=float(lon), level=level, label=label, weight=int(w)))

        d = reference["district"]
        for r in d.itertuples():
            add(canon_city(r.district), r.state, r.district, r.lat, r.lon, "district", r.district.title(), r.n_offices)
        # post offices (S.O / H.O are towns; B.O are villages and would swamp the index) - median coords per (name, state, district)
        po = pin[pin.coord_ok & pin.officetype.isin(["SO", "HO"])].copy()
        po["nm"] = po.officename.map(lambda x: "".join(w for w in _words(x) if len(w) > 1 and w not in ("bo", "so", "ho")))
        g = po.groupby(["nm", "state", "district"]).agg(lat=("lat", "median"), lon=("lon", "median"), n=("pincode", "size")).reset_index()
        for r in g.itertuples():
            add(canon_city(r.nm), r.state, r.district, r.lat, r.lon, "post_office", r.nm.title(), r.n)
        # facility cities that were verified (their own city name is a legitimate place name)
        if fac_geo is not None and "city_key" in fac_geo:
            v = fac_geo[fac_geo.location_trust.isin(["verified", "probable"]) & fac_geo.city_key.notna() & fac_geo.state_final.notna()]
            gc = v.groupby(["city_key", "state_final"]).agg(lat=("best_lat", "median"), lon=("best_lon", "median"), n=("unique_id", "size"),
                                                            district=("district_final", lambda s: s.mode().iat[0] if len(s.mode()) else None)).reset_index()
            gc = gc[gc.n >= 3]            # one mislocated facility must not create a phantom city
            for r in gc.itertuples():
                add(r.city_key, r.state_final, r.district, r.lat, r.lon, "city", r.city_key.title(), r.n)
        self.index = idx
        self.keys = list(idx)
        self.state_c = reference["state_centroid"]

    @classmethod
    def build(cls, pin_path, fac_geo=None):
        return cls(build_reference(pin_path), fac_geo)

    # ------------------------------------------------------------------ public API
    def geocode(self, query, state=None):
        q = (query or "").strip()
        if not q:
            return self._fail("empty query")
        # 1) PIN code (accept '800 001', '800-001')
        digits = re.sub("[ -]", "", q)
        if re.fullmatch("[1-9][0-9]{5}", digits):
            if digits in self.pin_ref.index:
                r = self.pin_ref.loc[digits]
                conf = 1.0 if r.centroid_source == "offices" else 0.7
                return self._ok(r.lat, r.lon, "pin", f"PIN {digits}", r.state, r.district, conf,
                                note=None if r.centroid_source == "offices" else "PIN centre estimated from the district")
            return self._fail(f"PIN {digits} is not in the India Post directory")
        # 2) coordinates
        m = re.fullmatch("[ ]*(-?[0-9]+[.]?[0-9]*)[ ]*[,; ][ ]*(-?[0-9]+[.]?[0-9]*)[ ]*", q)
        if m:
            la, lo = float(m.group(1)), float(m.group(2))
            if in_india([la], [lo])[0]:
                return self._ok(la, lo, "coordinates", q, None, None, 1.0)
            if in_india([lo], [la])[0]:
                return self._ok(lo, la, "coordinates", q, None, None, 0.9, note="latitude/longitude looked swapped and were corrected")
            return self._fail("coordinates are outside India")
        # 3) name (optionally 'city, state' or the state given separately)
        st = self.norm_state(state) if state else np.nan
        parts = [p.strip() for p in q.split(",") if p.strip()]
        name = parts[0]
        if len(parts) > 1 and pd.isna(st):
            for p in parts[1:]:
                s2 = self.norm_state(p)
                if isinstance(s2, str):
                    st = s2
        # a bare state name
        s_only = self.norm_state(name)
        if isinstance(s_only, str) and s_only in self.state_c.index and len(parts) == 1 and pd.isna(st):
            r = self.state_c.loc[s_only]
            return self._ok(r.lat, r.lon, "state", name, s_only, None, 0.5, note="only the state centre is known; give a city, district or PIN for a better answer")
        key = canon_city(name)
        cands = self.index.get(key, [])
        matched_by = "exact"
        if not cands:
            close = difflib.get_close_matches(key, self.keys, n=3, cutoff=FUZZY_CUTOFF)
            if close:
                cands = [c for k in close for c in self.index[k]]
                matched_by = "fuzzy"
        if isinstance(st, str):
            cands = [c for c in cands if c["state"] == st]
        if not cands:
            return self._fail(f"could not find '{name}'" + (f" in {st.title()}" if isinstance(st, str) else ""))
        return self._resolve(cands, name, matched_by)

    def within_radius(self, lat, lon, km, fac_geo, min_trust="low"):
        """Facilities within `km` of a point, nearest first, plus a data-density message (J2)."""
        g = fac_geo.dropna(subset=["best_lat"])
        d = haversine_km(lat, lon, g.best_lat.values, g.best_lon.values)
        out = g.assign(distance_km=np.round(d, 1))[d <= km].sort_values("distance_km")
        if min_trust != "low":
            out = out[out.location_trust_level.astype(str).isin(["high"] if min_trust == "high" else ["medium", "high"])]
        n = len(out)
        msg = ""
        if n == 0:
            msg = f"No facilities in our data within {km:g} km. This usually means missing data, not an absence of care."
        elif n < 5:
            msg = f"Only {n} facilities in our data within {km:g} km; a missing service here may just mean missing data."
        return out, {"radius_km": km, "n_facilities": n, "message": msg}

    def reverse(self, lat, lon):
        """Coordinates -> (state, district, PIN) of the nearest PIN centroid."""
        from geo_pipeline import nearest_pin
        i, d, ok = nearest_pin(np.array([lat]), np.array([lon]), self.pin_ref)
        if not ok[0]:
            return None
        r = self.pin_ref.loc[i[0]]
        return {"pin": i[0], "state": r.state, "district": r.district, "distance_to_pin_centre_km": round(float(d[0]), 1)}

    # ------------------------------------------------------------------ internals
    def _resolve(self, cands, name, matched_by):
        # collapse duplicates of the same (state, district); prefer the strongest level, then the largest weight
        best = {}
        for c in cands:
            k = (c["state"], c["district"])
            if k not in best or (LEVEL_ORDER[c["level"]], -c["weight"]) < (LEVEL_ORDER[best[k]["level"]], -best[k]["weight"]):
                best[k] = c
        lst = sorted(best.values(), key=lambda c: (LEVEL_ORDER[c["level"]], -c["weight"]))
        conf = 0.95 if matched_by == "exact" else 0.75
        if len(lst) == 1:
            c = lst[0]
            return self._ok(c["lat"], c["lon"], c["level"], c["label"], c["state"], c["district"], conf)
        # several places with this name: if one is clearly dominant (much bigger), take it but flag it
        top, second = lst[0], lst[1]
        states = {c["state"] for c in lst}
        if len(states) == 1:
            return self._ok(top["lat"], top["lon"], top["level"], top["label"], top["state"], top["district"], conf * 0.9,
                            note=f"{len(lst)} places share this name in {top['state'].title()}; showing the main one")
        return {"status": "ambiguous", "query": name, "message": f"'{name}' exists in {len(states)} states; please add the state.",
                "candidates": [dict(label=c["label"], state=c["state"].title(), district=str(c["district"]).title(), lat=round(c["lat"], 4), lon=round(c["lon"], 4)) for c in lst[:6]]}

    @staticmethod
    def _ok(lat, lon, level, label, state, district, conf, note=None):
        return {"status": "ok", "lat": round(float(lat), 6), "lon": round(float(lon), 6), "level": level, "matched": label,
                "state": state, "district": district, "confidence": round(conf, 2), "note": note}

    @staticmethod
    def _fail(msg):
        return {"status": "not_found", "message": msg}


# ----------------------------------------------------------------------------- contract function (RED_FLAGS_AND_VALIDATION.md, Person 2)
_DEFAULT = None


def set_default_geocoder(gc):
    """Register the Geocoder that geocode_user_input() should use (build it once, e.g. at app start)."""
    global _DEFAULT
    _DEFAULT = gc


def geocode_user_input(text, state=None, geocoder=None):
    """city / PIN / district / 'lat, lon'  ->  (lat, lon, precision).

    precision is how exact the answer is: 'coordinates' | 'pin' | 'post_office' | 'city' | 'district' | 'state'.
    On failure returns (None, None, 'ambiguous') or (None, None, 'not_found'); call Geocoder.geocode() for the candidates / message.
    """
    gc = geocoder or _DEFAULT
    if gc is None:
        raise RuntimeError("build a Geocoder first and pass it in, or call set_default_geocoder(gc)")
    r = gc.geocode(text, state=state)
    if r["status"] == "ok":
        return r["lat"], r["lon"], r["level"]
    return None, None, r["status"]
