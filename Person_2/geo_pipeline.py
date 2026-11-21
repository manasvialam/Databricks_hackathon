"""
Person 2 - Location & geography pipeline  ->  table `fac_geo` (keyed by unique_id).

Owns red flags B1-B13 and J1-J2 from RED_FLAGS_AND_VALIDATION.md.

Contract (shared with the other three people)
  * keyed by `unique_id`
  * boolean flags are named `flag_<name>`
  * one `reasons` column (JSON list of short human-readable sentences)
  * raw values are kept as `raw_<col>`

No regex in this file uses a backslash on purpose (character classes only), so it is safe to paste anywhere.
"""
import json
import re
import difflib
from pathlib import Path

import numpy as np
import pandas as pd

INDIA_BBOX = dict(lat=(6.0, 37.6), lon=(68.0, 97.5))
BS = chr(92)
UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

# thresholds (km) - documented in README
T_CONSISTENT = 25      # coordinates this close to the PIN centroid are "consistent"
T_SEVERE = 100         # beyond this the coordinates are almost certainly wrong or merged
T_PROBABLE = 100       # same district as the PIN and within this distance -> keep coordinates ("probable")
STATE_OUTLIER_KM = 1000


# ----------------------------------------------------------------------------- small helpers
def haversine_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * np.arcsin(np.sqrt(a))


def in_india(lat, lon):
    return pd.Series(lat).between(*INDIA_BBOX["lat"]).values & pd.Series(lon).between(*INDIA_BBOX["lon"]).values


def _words(s):
    return [w for w in re.split("[^a-z]+", str(s).lower()) if w]


def skey(s):
    """Letters-only key with 'and'/'the' removed: 'Jammu & Kashmir' == 'JAMMU AND KASHMIR'."""
    return "".join(w for w in _words(s) if w not in ("and", "the"))


def lkey(s):
    """Letters-only key (keeps every word)."""
    return "".join(_words(s))


def _mode1(s):
    m = s.mode()
    return m.iat[0] if len(m) else np.nan


# ----------------------------------------------------------------------------- alias tables (B1, B11)
STATE_ALIASES = {
    "tamilnadu": "TAMIL NADU", "orissa": "ODISHA", "up": "UTTAR PRADESH", "chattisgarh": "CHHATTISGARH",
    "nctdelhi": "DELHI", "nctofdelhi": "DELHI", "newdelhi": "DELHI", "delhincr": "DELHI", "pondicherry": "PUDUCHERRY",
    "pudducherry": "PUDUCHERRY", "uttaranchal": "UTTARAKHAND", "maharastra": "MAHARASHTRA", "telengana": "TELANGANA",
    "ts": "TELANGANA", "karnatka": "KARNATAKA", "punjabregion": "PUNJAB", "chandigarhut": "CHANDIGARH",
    "jandk": "JAMMU AND KASHMIR", "jk": "JAMMU AND KASHMIR", "andamannicobar": "ANDAMAN AND NICOBAR ISLANDS",
    "andamannicobarislands": "ANDAMAN AND NICOBAR ISLANDS", "dadranagarhaveli": "DADRA AND NAGAR HAVELI AND DAMAN AND DIU",
    "damandiu": "DADRA AND NAGAR HAVELI AND DAMAN AND DIU", "daman": "DADRA AND NAGAR HAVELI AND DAMAN AND DIU",
    "dadranagarhavelidamandiu": "DADRA AND NAGAR HAVELI AND DAMAN AND DIU",
}

# old / colloquial city name -> current official name (used for facility cities AND for user input)
CITY_ALIASES = {
    "bangalore": "bengaluru", "banglore": "bengaluru", "bengalore": "bengaluru", "bangaluru": "bengaluru", "bengaluru": "bengaluru", "bengalooru": "bengaluru", "gurgaon": "gurugram", "trivandrum": "thiruvananthapuram",
    "bombay": "mumbai", "calcutta": "kolkata", "madras": "chennai", "poona": "pune", "cochin": "kochi",
    "mysore": "mysuru", "mangalore": "mangaluru", "baroda": "vadodara", "allahabad": "prayagraj", "benaras": "varanasi",
    "banaras": "varanasi", "pondicherry": "puducherry", "vizag": "visakhapatnam", "waltair": "visakhapatnam",
    "belgaum": "belagavi", "hubli": "hubballi", "shimoga": "shivamogga", "tumkur": "tumakuru", "gulbarga": "kalaburagi",
    "bijapur": "vijayapura", "bellary": "ballari", "trichy": "tiruchirappalli", "trichinopoly": "tiruchirappalli",
    "calicut": "kozhikode", "alleppey": "alappuzha", "trichur": "thrissur", "palghat": "palakkad", "quilon": "kollam",
    "cuddapah": "kadapa", "ahmadabad": "ahmedabad", "navimumbai": "navimumbai", "bhubaneshwar": "bhubaneswar",
    "baranagar": "baranagar", "new delhi": "delhi", "newdelhi": "delhi", "gauhati": "guwahati", "jullundur": "jalandhar",
    "simla": "shimla", "cawnpore": "kanpur", "ootacamund": "udhagamandalam", "ooty": "udhagamandalam", "mhow": "mhow",
    "panaji": "panaji", "panjim": "panaji", "nagercoil": "nagercoil", "kanyakumari": "kanniyakumari",
    "thiruvanathapuram": "thiruvananthapuram", "thiruvanthapuram": "thiruvananthapuram", "ernakulam": "ernakulam", "secunderabad": "hyderabad",
    "noida": "gautambuddhanagar", "greaternoida": "gautambuddhanagar", "faridabad": "faridabad",
}
CITY_ALIASES = {lkey(k): lkey(v) for k, v in CITY_ALIASES.items()}


def canon_city(s):
    k = lkey(s)
    return CITY_ALIASES.get(k, k)


# ----------------------------------------------------------------------------- base table (stand-in for Person 1's fac_base)
def load_base(fac_path):
    """Minimal clean-up so Person 2 can work independently of Person 1.

    Same rules as P1 (A1, A2, A4, A5): escape-aware read, keep rows whose unique_id is a UUID,
    drop exact duplicate rows, normalise 'null'/'' to NaN.
    NOT done here (P1 owns it): stitching the 30 truncated records, so those 30 have no coordinates yet.
    Swap in P1's `fac_base` by passing it to `build_fac_geo(base=...)` - it only needs the columns listed in REQUIRED.
    """
    raw = pd.read_csv(fac_path, escapechar=BS, dtype=str, keep_default_na=False, low_memory=False)
    ok = raw.unique_id.str.fullmatch(UUID)
    fac = raw[ok].drop_duplicates().reset_index(drop=True)
    fac = fac.replace({"": np.nan, "null": np.nan, "NULL": np.nan})
    info = {"raw_rows": len(raw), "fragment_rows": int((~ok).sum()), "after_dedup": len(fac)}
    return fac, info


REQUIRED = ["unique_id", "name", "address_line1", "address_line2", "address_line3", "address_city",
            "address_stateOrRegion", "address_zipOrPostcode", "latitude", "longitude"]


# ----------------------------------------------------------------------------- India Post reference (B12, B13)
def build_reference(pin_path):
    """Clean per-PIN centroid, state, district + district/state tables.

    B12: 7% of offices have no coordinates and ~2.6k are garbage (outside India). We keep an office coordinate only if it
    is inside the India bounding box AND within 1000 km of its own state's median, then take the MEDIAN per PIN.
    """
    pin = pd.read_csv(pin_path, dtype=str, keep_default_na=False, na_values=["", "NA"], low_memory=False)
    pin["pincode"] = pin["pincode"].astype(str).str.strip()
    pin["lat"] = pd.to_numeric(pin.latitude, errors="coerce")
    pin["lon"] = pd.to_numeric(pin.longitude, errors="coerce")
    pin = pin.dropna(subset=["pincode", "statename"]).copy()
    pin["state"] = pin.statename
    pin["dkey"] = pin.district.map(lkey)
    canon = sorted(pin.state.dropna().unique())

    inb = pd.Series(in_india(pin.lat.fillna(0), pin.lon.fillna(0)), index=pin.index) & pin.lat.notna()
    sm = pin[inb].groupby("state")[["lat", "lon"]].median().rename(columns={"lat": "slat", "lon": "slon"})
    pin = pin.join(sm, on="state")
    pin["km_state"] = np.where(inb, haversine_km(pin.lat, pin.lon, pin.slat, pin.slon), np.nan)
    pin["coord_ok"] = inb & (pin.km_state <= STATE_OUTLIER_KM)
    stats = {
        "offices": len(pin), "pincodes": int(pin.pincode.nunique()),
        "offices_missing_coords": int(pin.lat.isna().sum()),
        "offices_outside_india": int((pin.lat.notna() & ~inb).sum()),
        "offices_far_from_state": int((inb & (pin.km_state > STATE_OUTLIER_KM)).sum()),
        "offices_usable": int(pin.coord_ok.sum()),
    }

    g = pin.groupby("pincode")
    ref = pd.DataFrame({
        "state": g.state.agg(_mode1), "district": g.district.agg(_mode1), "dkey": g.dkey.agg(_mode1),
        "n_offices": g.size(), "n_states": g.state.nunique(), "n_districts": g.district.nunique(),
    })
    cent = pin[pin.coord_ok].groupby("pincode")[["lat", "lon"]].median()
    ref = ref.join(cent)
    # spread of offices around the PIN centroid (how trustworthy is the centroid?)
    ok = pin[pin.coord_ok].join(cent.rename(columns={"lat": "clat", "lon": "clon"}), on="pincode")
    ok["d"] = haversine_km(ok.lat, ok.lon, ok.clat, ok.clon)
    ref["spread_km"] = ok.groupby("pincode").d.median()
    ref["centroid_source"] = np.where(ref.lat.notna(), "offices", None)
    ref["spans_states"] = ref.n_states > 1
    ref["spans_districts"] = ref.n_districts > 1

    # district table (state + district) with centroid; used for fallback, density and the geocoder
    d = pin.dropna(subset=["district"]).groupby(["state", "dkey"])
    dist = pd.DataFrame({"district": d.district.agg(_mode1), "n_pins": d.pincode.nunique(), "n_offices": d.size()})
    dist = dist.join(pin[pin.coord_ok].groupby(["state", "dkey"])[["lat", "lon"]].median())
    dist = dist.reset_index()

    # fallback centroid for PINs with no usable office coordinate: the district centroid
    dmap = dist.set_index(["state", "dkey"])[["lat", "lon"]]
    miss = ref.lat.isna()
    idx = pd.MultiIndex.from_arrays([ref.loc[miss, "state"], ref.loc[miss, "dkey"]])
    fb = dmap.reindex(idx)
    ref.loc[miss, "lat"] = fb.lat.values
    ref.loc[miss, "lon"] = fb.lon.values
    ref.loc[miss & ref.lat.notna(), "centroid_source"] = "district"
    stats["pins_no_office_centroid"] = int(miss.sum())
    stats["pins_still_no_centroid"] = int(ref.lat.isna().sum())

    # state centroids + post-office names per PIN (for the city-vs-PIN check)
    state_c = pin[pin.coord_ok].groupby("state")[["lat", "lon"]].median()

    def base_name(x):
        return "".join(w for w in _words(x) if len(w) > 1 and w not in ("bo", "so", "ho"))
    office_keys = pin.groupby("pincode").officename.agg(lambda s: {base_name(x) for x in s if isinstance(x, str)}).to_dict()

    # PINs that the directory lists in two states: keep a record per state so a facility can pick the right one
    state_options = {}
    for pc_, grp in pin[pin.pincode.isin(ref.index[ref.spans_states])].groupby("pincode"):
        for st_, gg in grp.groupby("state"):
            okc = gg[gg.coord_ok]
            state_options[(pc_, st_)] = dict(
                district=_mode1(gg.district), dkey=_mode1(gg.dkey),
                lat=float(okc.lat.median()) if len(okc) else float(ref.lat[pc_]),
                lon=float(okc.lon.median()) if len(okc) else float(ref.lon[pc_]), n=len(gg))
    pin_states = {}
    for (pc_, st_) in state_options:
        pin_states.setdefault(pc_, []).append(st_)

    # place index for the city-vs-PIN check: district names and town post offices -> (state, lat, lon)
    places = {}
    for r_ in dist.itertuples():
        if pd.notna(r_.lat):
            places.setdefault(canon_city(r_.district), []).append((r_.state, r_.lat, r_.lon))
    po = pin[pin.coord_ok & pin.officetype.isin(["SO", "HO"])].copy()
    po["nm"] = po.officename.map(base_name)
    for r_ in po.groupby(["nm", "state"])[["lat", "lon"]].median().reset_index().itertuples():
        places.setdefault(canon_city(r_.nm), []).append((r_.state, r_.lat, r_.lon))

    stats["pins_span_states"] = int(ref.spans_states.sum())
    stats["pins_span_districts"] = int(ref.spans_districts.sum())
    stats["pins_span_districts_pct"] = round(float(ref.spans_districts.mean()) * 100, 1)

    return {"pin": pin, "ref": ref, "district": dist, "state_centroid": state_c, "office_keys": office_keys,
            "canon": canon, "stats": stats, "norm_state": make_state_normalizer(canon),
            "state_options": state_options, "pin_states": pin_states, "places": places}


# ----------------------------------------------------------------------------- state normaliser (B1, B2)
def make_state_normalizer(canon):
    by_key = {skey(n): n for n in canon}
    alias = {skey(k): v for k, v in STATE_ALIASES.items() if v in set(canon)}
    seqs = sorted(((" ".join(w for w in _words(n) if w not in ("and", "the")), n) for n in canon), key=lambda t: -len(t[0]))

    def norm(s):
        if not isinstance(s, str):
            return np.nan
        k = skey(s)
        if k in by_key:
            return by_key[k]
        if k in alias:
            return alias[k]
        padded = " " + " ".join(w for w in _words(s) if w not in ("and", "the")) + " "
        for seq, n in seqs:                       # e.g. "Ghaziabad, Uttar Pradesh"
            if " " + seq + " " in padded:
                return n
        return np.nan
    return norm


# ----------------------------------------------------------------------------- PIN cleaning (B3, B4, B10)
PIN_RE = re.compile("(?<![0-9])[1-9][0-9]{2}[ -]?[0-9]{3}(?![0-9])")


def extract_pins(*texts):
    out = []
    for t in texts:
        if isinstance(t, str):
            out += [re.sub("[^0-9]", "", m) for m in PIN_RE.findall(t)]
    return out


def clean_pin_field(z):
    """Return (pin6 or NaN, was_cleaned)."""
    if not isinstance(z, str):
        return np.nan, False
    d = re.sub("[ ,.-]", "", z)
    if re.fullmatch("[1-9][0-9]{5}", d):
        return d, d != z
    return np.nan, False


# ----------------------------------------------------------------------------- nearest PIN to a coordinate
def nearest_pin(lat, lon, ref, chunk=500):
    """Index (into ref) + distance (km) of the nearest PIN centroid, for arrays of coordinates."""
    r = ref[ref.centroid_source == "offices"]
    P = np.c_[r.lat.values, r.lon.values]
    Q = np.c_[lat, lon]
    idx = np.full(len(Q), -1)
    dist = np.full(len(Q), np.nan)
    ok = ~np.isnan(Q).any(axis=1)
    qi = np.where(ok)[0]
    for a in range(0, len(qi), chunk):
        sel = qi[a:a + chunk]
        q = Q[sel]
        dl = q[:, None, 0] - P[None, :, 0]
        dn = (q[:, None, 1] - P[None, :, 1]) * np.cos(np.radians(q[:, None, 0]))
        d2 = dl * dl + dn * dn
        j = d2.argmin(1)
        idx[sel] = j
        dist[sel] = np.sqrt(d2[np.arange(len(sel)), j]) * 111.0
    return r.index.values[np.where(idx >= 0, idx, 0)], np.where(idx >= 0, dist, np.nan), ok


# ----------------------------------------------------------------------------- NFHS district mapping
_NF = [  # (state, NFHS district name) -> India Post district name. Renames and spelling variants only.
    ("ANDHRA PRADESH", "Sri Potti Sriramulu Nellore", "SPSR NELLORE"), ("ANDHRA PRADESH", "Sri Potti Sriramulu Nello", "SPSR NELLORE"),  # NFHS truncates the name
("ASSAM", "Kamrup Metropolitan", "KAMRUP METRO"),
    ("CHHATTISGARH", "Koriya", "KOREA"), ("CHHATTISGARH", "Uttar Bastar Kanker", "KANKER"), ("GUJARAT", "The Dangs", "DANG"),
    ("HARYANA", "Gurgaon", "GURUGRAM"), ("HARYANA", "Mewat", "NUH"), ("JAMMU AND KASHMIR", "Punch", "POONCH"),
    ("JAMMU AND KASHMIR", "Shupiyan", "SHOPIAN"), ("JHARKHAND", "Purbi Singhbhum", "EAST SINGHBUM"),
    ("JHARKHAND", "Pashchimi Singhbhum", "WEST SINGHBHUM"), ("KARNATAKA", "Belgaum", "BELAGAVI"), ("KARNATAKA", "Bijapur", "VIJAYAPURA"),
    ("KARNATAKA", "Bellary", "BALLARI"), ("KARNATAKA", "Bangalore", "BENGALURU URBAN"), ("KARNATAKA", "Bangalore Rural", "BENGALURU RURAL"),
    ("KARNATAKA", "Mysore", "MYSURU"), ("KARNATAKA", "Gulbarga", "KALABURAGI"), ("LAKSHADWEEP", "Lakshadweep", "LAKSHADWEEP DISTRICT"),
    ("MADHYA PRADESH", "Khargone (West Nimar)", "KHARGONE"), ("MADHYA PRADESH", "Khandwa (East Nimar)", "EAST NIMAR"),
    ("MADHYA PRADESH", "Narsimhapur", "NARSINGHPUR"), ("MAHARASHTRA", "Raigarh", "RAIGAD"), ("MAHARASHTRA", "Bid", "BEED"),
    ("ODISHA", "Debagarh", "DEOGARH"), ("ODISHA", "Baudh", "BOUDH"), ("ODISHA", "Subarnapur", "SONEPUR"),
    ("PUDUCHERRY", "Puducherry", "PONDICHERRY"), ("PUNJAB", "Muktsar", "SRI MUKTSAR SAHIB"), ("PUNJAB", "Sahibzada Ajit Singh Nagar", "S.A.S Nagar"),
    ("RAJASTHAN", "Dhaulpur", "DHOLPUR"), ("TAMIL NADU", "Thoothukkudi", "TUTICORIN"), ("TELANGANA", "Warangal Urban", "WARANGAL"),
    ("UTTAR PRADESH", "Jyotiba Phule Nagar", "AMROHA"), ("UTTAR PRADESH", "Mahamaya Nagar", "HATHRAS"), ("UTTAR PRADESH", "Allahabad", "PRAYAGRAJ"),
    ("UTTAR PRADESH", "Sant Ravidas Nagar (Bhadohi)", "BHADOHI"), ("UTTAR PRADESH", "Kanshiram Nagar", "KASGANJ"),
    ("UTTARAKHAND", "Garhwal", "PAURI GARHWAL"), ("WEST BENGAL", "Koch Bihar", "COOCHBEHAR"), ("WEST BENGAL", "Uttar Dinajpur", "DINAJPUR UTTAR"),
    ("WEST BENGAL", "Dakshin Dinajpur", "DINAJPUR DAKSHIN"), ("WEST BENGAL", "North Twenty Four Pargana", "24 PARAGANAS NORTH"),
    ("WEST BENGAL", "South Twenty Four Pargana", "24 PARAGANAS SOUTH"), ("WEST BENGAL", "Hugli", "HOOGHLY"), ("WEST BENGAL", "Haora", "HOWRAH"),
    ("WEST BENGAL", "Paschim Medinipur", "MEDINIPUR WEST"), ("WEST BENGAL", "Purba Medinipur", "MEDINIPUR EAST"),
]
NFHS_DISTRICT_ALIASES = {(s, lkey(n)): lkey(i) for s, n, i in _NF}
# Not mapped on purpose: 'Chandel' (filed under Mizoram in NFHS; Chandel is in Manipur - source error) and 'Warangal Rural'
# (India Post has a single WARANGAL; it is matched to 'Warangal Urban').


def map_nfhs(reference, nfhs_path, extra_aliases=None, cutoff=0.82):
    """India Post (state, district) -> NFHS district row. Returns (nfhs_df, mapping dict, unmatched NFHS rows)."""
    nf = pd.read_csv(nfhs_path, dtype=str, low_memory=False)
    norm = reference["norm_state"]
    nf["state"] = nf.state_ut.map(norm)
    nf["dkey"] = nf.district_name.map(lkey)
    aliases = {**NFHS_DISTRICT_ALIASES, **(extra_aliases or {})}
    nf["dkey_ip"] = [aliases.get((s, d), d) for s, d in zip(nf.state, nf.dkey)]
    ip_by_state = reference["district"].groupby("state").dkey.apply(list).to_dict()
    mapping = {}
    matched = []
    for i, r in nf.iterrows():
        cands = ip_by_state.get(r.state, [])
        if r.dkey_ip in cands:
            k = r.dkey_ip
        else:
            m = difflib.get_close_matches(r.dkey_ip, cands, n=1, cutoff=cutoff)
            k = m[0] if m else None
        matched.append(k)
        if k:
            mapping[(r.state, k)] = i
    nf["dkey_matched"] = matched
    return nf, mapping, nf[nf.dkey_matched.isna()]


# ----------------------------------------------------------------------------- the main build
def build_fac_geo(base, reference, osm=None, progress=print):
    """Return fac_geo (one row per unique_id)."""
    ref, pin = reference["ref"], reference["pin"]
    norm_state = reference["norm_state"]
    office_keys = reference["office_keys"]
    missing = [c for c in REQUIRED if c not in base.columns]
    assert not missing, f"base is missing columns: {missing}"
    f = base[REQUIRED].copy().reset_index(drop=True)
    g = pd.DataFrame({"unique_id": f.unique_id})

    # ---- raw copies (contract: raw_<col>)
    for c in ["address_stateOrRegion", "address_zipOrPostcode", "address_city", "latitude", "longitude"]:
        g["raw_" + c.replace("address_", "")] = f[c].values
    lat = pd.to_numeric(f.latitude, errors="coerce")
    lon = pd.to_numeric(f.longitude, errors="coerce")

    # ---- B1/B2: state
    g["state_norm"] = f.address_stateOrRegion.map(norm_state)
    g["flag_state_field_not_a_state"] = f.address_stateOrRegion.notna() & g.state_norm.isna()

    # ---- B3/B4/B10: PIN
    cleaned = [clean_pin_field(z) for z in f.address_zipOrPostcode]
    pin_field = pd.Series([c[0] for c in cleaned], index=f.index, dtype=object)
    g["flag_pin_reformatted"] = [c[1] for c in cleaned]
    g["flag_pin_malformed"] = f.address_zipOrPostcode.notna() & pin_field.isna()
    in_dir = set(ref.index)
    g["flag_pin_invalid"] = pin_field.notna() & ~pin_field.isin(in_dir)
    text_pins = [extract_pins(a, b, c) for a, b, c in zip(f.address_line1, f.address_line2, f.address_line3)]
    pin6, pin_source = [], []
    for fld, tp in zip(pin_field, text_pins):
        valid_text = [p for p in tp if p in in_dir]
        if isinstance(fld, str) and fld in in_dir:
            pin6.append(fld); pin_source.append("field")
        elif valid_text:
            pin6.append(valid_text[0]); pin_source.append("address_text")
        elif isinstance(fld, str):
            pin6.append(fld); pin_source.append("field_not_in_directory")
        else:
            pin6.append(np.nan); pin_source.append("none")
    g["pin6"] = pin6
    g["pin_source"] = pin_source
    g["pin_valid"] = g.pin6.isin(in_dir)
    distinct = []
    for fld, tp in zip(pin_field, text_pins):
        s = {p for p in ([fld] if isinstance(fld, str) else []) + tp if p in in_dir}
        distinct.append(sorted(s))
    g["n_distinct_pins"] = [len(s) for s in distinct]
    g["flag_multiple_pins"] = g.n_distinct_pins >= 2
    g["flag_multiple_pin_states"] = [len({ref.state[p] for p in s}) > 1 for s in distinct]
    # L1: do all PINs found in the address (field + address lines) point to ONE district? (null when there is no valid PIN at all)
    g["addr_consistent"] = [(len({(ref.state[p], ref.dkey[p]) for p in s}) == 1) if s else np.nan for s in distinct]

    # ---- PIN-derived facts
    r = ref.reindex(g.pin6)
    g["pin_state"] = r.state.values
    g["pin_district"] = r.district.values
    g["pin_dkey"] = r.dkey.values
    g["pin_lat"] = r.lat.values
    g["pin_lon"] = r.lon.values
    g["pin_centroid_source"] = r.centroid_source.values
    g["pin_spread_km"] = r.spread_km.values
    g["flag_pin_spans_districts"] = r.spans_districts.fillna(False).values.astype(bool)
    g["flag_pin_spans_states"] = r.spans_states.fillna(False).values.astype(bool)

    # ---- B8: coordinates (swap fix, NULL outside India)
    inside = in_india(lat.fillna(0), lon.fillna(0)) & lat.notna().values
    swapped = lat.notna().values & ~inside & in_india(lon.fillna(0), lat.fillna(0))
    g["flag_latlon_swapped"] = swapped
    lat2 = np.where(swapped, lon, lat)
    lon2 = np.where(swapped, lat, lon)
    inside2 = in_india(np.nan_to_num(lat2), np.nan_to_num(lon2)) & ~np.isnan(lat2)
    g["flag_coords_outside_india"] = lat.notna().values & ~inside2
    g["lat"] = np.where(inside2, lat2, np.nan)
    g["lon"] = np.where(inside2, lon2, np.nan)
    has_xy = g.lat.notna().values

    # ---- PINs the directory lists in two states: pick the option that matches the stated state, else the nearest to the coordinates
    chosen = 0
    for i in np.where(g.flag_pin_spans_states.values & g.pin6.notna().values)[0]:
        p = g.pin6.iat[i]
        opts = reference["pin_states"].get(p, [])
        pick = g.state_norm.iat[i] if g.state_norm.iat[i] in opts else None
        if pick is None and has_xy[i] and opts:
            pick = min(opts, key=lambda s: haversine_km(g.lat.iat[i], g.lon.iat[i], reference["state_options"][(p, s)]["lat"], reference["state_options"][(p, s)]["lon"]))
        if pick is not None and pick != g.pin_state.iat[i]:
            o = reference["state_options"][(p, pick)]
            g.iat[i, g.columns.get_loc("pin_state")] = pick
            g.iat[i, g.columns.get_loc("pin_district")] = o["district"]
            g.iat[i, g.columns.get_loc("pin_dkey")] = o["dkey"]
            g.iat[i, g.columns.get_loc("pin_lat")] = o["lat"]
            g.iat[i, g.columns.get_loc("pin_lon")] = o["lon"]
            chosen += 1
    progress(f"PINs listed in two states: re-pointed {chosen} facilities to the state option that matches their address/coordinates")

    # ---- nearest PIN to the coordinates (state/district per coordinates)
    ni, nd, ok = nearest_pin(g.lat.values, g.lon.values, ref)
    nr = ref.reindex(ni)
    g["coord_pin"] = np.where(ok, ni, None)
    g["coord_state"] = np.where(ok, nr.state.values, None)
    g["coord_district"] = np.where(ok, nr.district.values, None)
    g["coord_dkey"] = np.where(ok, nr.dkey.values, None)
    g["coord_nearest_pin_km"] = nd

    # ---- B9: coordinates shared by different facilities
    key = pd.Series(list(zip(np.round(g.lat, 5), np.round(g.lon, 5))), index=g.index).where(has_xy)
    n_share = key.map(key.value_counts())
    g["shared_coord_n"] = n_share.fillna(0).astype(int)
    g["flag_shared_coords"] = g.shared_coord_n > 1
    g["geocode_precision"] = np.where(g.flag_shared_coords, "locality", np.where(has_xy, "coordinates", "none"))

    # ---- state resolution (B5): AP <-> Telangana rule, then PIN > coordinates > stated
    st, pst, cst = g.state_norm, g.pin_state, g.coord_state
    pair = {"ANDHRA PRADESH", "TELANGANA"}
    both = st.notna() & pst.notna()
    g["flag_state_conflict"] = both & (st != pst)
    g["flag_state_conflict_ap_telangana"] = g.flag_state_conflict & np.array([({a, b} == pair) for a, b in zip(st, pst)])
    g["flag_state_conflict_other"] = g.flag_state_conflict & ~g.flag_state_conflict_ap_telangana
    final, source = [], []
    for s, p, c, conf, ap in zip(st, pst, cst, g.flag_state_conflict, g.flag_state_conflict_ap_telangana):
        if isinstance(p, str) and not conf:
            final.append(p); source.append("pin+stated" if isinstance(s, str) else "pin")
        elif ap:                                        # playbook B5: AP <-> Telangana, always trust the PIN (2014 split)
            final.append(p); source.append("pin_ap_telangana")
        elif conf:
            if isinstance(c, str) and c == s:
                final.append(s); source.append("stated+coords")
            else:
                final.append(p); source.append("pin")
        elif isinstance(s, str):
            final.append(s); source.append("stated")
        elif isinstance(c, str):
            final.append(c); source.append("coords")
        else:
            final.append(np.nan); source.append("none")
    g["state_final"] = final
    g["state_source"] = source
    g["flag_state_recovered_from_pin"] = g.state_norm.isna() & g.pin_state.notna()
    g["flag_coord_state_mismatch"] = has_xy & g.state_final.notna() & g.coord_state.notna() & (g.state_final != g.coord_state) & (g.coord_nearest_pin_km < 50)

    # ---- the PIN is distrusted when the address state AND the coordinates both disagree with it
    # (directory error, e.g. Agartala PIN 799001 is filed under Telangana). The PIN's own fields are blanked so nothing is
    # measured against a centroid in the wrong state; the original PIN stays in pin6.
    bad_pin = (g.state_source == "stated+coords").values
    g["pin_state_listed"] = np.where(bad_pin, g.pin_state, None)      # what the directory says, kept for the reason text
    g["flag_pin_state_unreliable"] = bad_pin
    for c in ["pin_state", "pin_district", "pin_dkey", "pin_lat", "pin_lon"]:
        g.loc[bad_pin, c] = np.nan
    g.loc[bad_pin, "pin_valid"] = False

    # ---- B6/B7: coordinates vs the PIN centroid
    has_pin_c = g.pin_lat.notna().values
    km = np.where(has_xy & has_pin_c, haversine_km(g.lat, g.lon, g.pin_lat, g.pin_lon), np.nan)
    g["geo_mismatch_km"] = np.round(km, 1)
    g["flag_geo_mismatch_25km"] = km > T_CONSISTENT
    g["flag_geo_mismatch_100km"] = km > T_SEVERE
    # contract values: consistent | conflict | coords_only | pin_only | invalid (neither a usable PIN nor usable coordinates)
    g["geo_status"] = np.select(
        [has_xy & has_pin_c & (km <= T_CONSISTENT), has_xy & has_pin_c & (km > T_CONSISTENT), has_xy & ~has_pin_c, ~has_xy & has_pin_c],
        ["consistent", "conflict", "coords_only", "pin_only"], "invalid")

    # ---- district resolution
    pdk = g.pin_dkey
    cdk = g.coord_dkey
    g["district_final_key"] = np.where(g.pin_valid & pdk.notna(), pdk, np.where(pd.notna(cdk), cdk, None))
    g["district_final"] = np.where(g.pin_valid & g.pin_district.notna(), g.pin_district, np.where(pd.notna(g.coord_district), g.coord_district, None))
    g["district_state"] = np.where(g.pin_valid & g.pin_state.notna(), g.pin_state, np.where(pd.notna(g.coord_state), g.coord_state, None))
    g["district_source"] = np.where(g.pin_valid & pdk.notna(), "pin", np.where(pd.notna(cdk), "coords", "none"))
    bothd = pdk.notna() & cdk.notna() & has_xy
    same_state = g.pin_state == g.coord_state
    g["flag_district_conflict"] = bothd & ~(same_state & (pdk == cdk))
    district_agree = bothd & same_state & (pdk == cdk)

    # ---- B11: city vs PIN area (aliases applied)
    city_k = f.address_city.map(canon_city)
    g["city_key"] = city_k
    cm = []
    places = reference["places"]
    for ck, p, pdist, pst_, plat_, plon_ in zip(city_k, g.pin6, g.pin_dkey, g.pin_state, g.pin_lat, g.pin_lon):
        if not ck or len(ck) < 3 or not isinstance(pdist, str):
            cm.append(np.nan); continue
        ok_ = False
        if isinstance(pst_, str) and ck == skey(pst_):            # Delhi, Chandigarh, Puducherry, Goa ...: city == state/UT
            ok_ = True
        if not ok_:
            cand = set(office_keys.get(p, set())) | {pdist, canon_city(pdist)}
            for o in cand:
                if len(o) < 4:
                    continue
                if ck == o or (len(ck) >= 4 and (ck in o or o in ck)):
                    ok_ = True; break
            if not ok_:                                     # typo tolerance
                ok_ = bool(difflib.get_close_matches(ck, [x for x in cand if len(x) >= 4], n=1, cutoff=0.85))
        if not ok_ and isinstance(pst_, str) and not np.isnan(plat_):   # a place of that name lies within 30 km of the PIN centre
            for st_, la_, lo_ in places.get(ck, []):
                if st_ == pst_ and haversine_km(la_, lo_, plat_, plon_) <= 30:
                    ok_ = True; break
        cm.append(ok_)
    g["city_matches_pin"] = cm
    g["flag_city_mismatch"] = pd.Series(cm, index=g.index).eq(False)

    # ---- optional OSM corroboration (L3) - columns exist either way
    g["osm_match"] = np.nan
    g["osm_dist_km"] = np.nan
    g["osm_near"] = None
    if osm is not None:
        g = _apply_osm(g, f, osm, has_xy)

    # ---- location decision rule (section 2.2)
    consistent = (g.geo_status == "consistent").values
    conflict = (g.geo_status == "conflict").values
    probable = conflict & district_agree.values & (km <= T_PROBABLE)
    city_ok = g.city_matches_pin.eq(True).values
    osm_c = (g.osm_near == "coords").values
    osm_p = (g.osm_near == "pin").values
    only_pin = ~has_xy & has_pin_c
    only_xy = has_xy & ~has_pin_c
    xy_state_ok = only_xy & (g.state_source == "stated+coords").values   # no usable PIN, but address state and coordinates agree

    status = np.select(
        [consistent, conflict & osm_c, conflict & osm_p, probable, conflict & city_ok, conflict, only_pin, xy_state_ok, only_xy],
        ["verified", "verified_osm", "verified_osm", "probable", "approximate_pin", "unverified", "approximate_pin", "probable", "unverified"],
        "unknown")
    use_xy = np.isin(status, ["verified", "probable"]) | ((status == "verified_osm") & osm_c) | (status == "unverified") & only_xy
    use_pin = ((status == "approximate_pin")) | ((status == "verified_osm") & osm_p) | ((status == "unverified") & conflict)
    best_lat = np.where(use_xy, g.lat, np.where(use_pin, g.pin_lat, np.nan))
    best_lon = np.where(use_xy, g.lon, np.where(use_pin, g.pin_lon, np.nan))
    precision = np.where(use_xy, g.geocode_precision, np.where(use_pin, "pin_centroid", "none"))

    # last resort: district centroid
    dc =reference["district"].set_index(["state", "dkey"])[["lat", "lon"]]
    need = np.isnan(best_lat) & g.district_final_key.notna().values & g.district_state.notna().values
    if need.any():
        got = dc.reindex(pd.MultiIndex.from_arrays([g.district_state[need], g.district_final_key[need]]))
        best_lat[need] = got.lat.values
        best_lon[need] = got.lon.values
        have = ~np.isnan(best_lat) & need
        precision = np.where(have, "district_centroid", precision)
        status = np.where(have, "approximate_district", status)

    g["best_lat"] = np.round(best_lat, 6)
    g["best_lon"] = np.round(best_lon, 6)
    g["location_precision"] = precision
    g["location_trust"] = status

    # ---- trust score (0..1): documented in README
    base_trust = {"verified_osm": 1.0, "verified": 0.90, "probable": 0.75, "approximate_pin": 0.60,
                  "approximate_district": 0.40, "unverified": 0.25, "unknown": 0.0}
    t = pd.Series(status).map(base_trust).astype(float).values
    t = t - 0.15 * (g.geocode_precision == "locality").values * (status == "verified")
    t = t - 0.10 * g.flag_multiple_pins.values - 0.10 * g.flag_state_conflict_other.values - 0.05 * g.flag_city_mismatch.values \
        - 0.05 * g.flag_pin_spans_districts.values * (g.pin_source != "none").values - 0.10 * g.flag_district_conflict.values
    g["location_trust_score"] = np.round(np.clip(t, 0, 1), 2)
    g["location_trust_level"] = pd.cut(g.location_trust_score, [-0.01, 0.35, 0.65, 1.0], labels=["low", "medium", "high"])

    g["reasons"] = _reasons(g, state_names=f.address_stateOrRegion, city=f.address_city, raw_zip=f.address_zipOrPostcode)
    return g


def _apply_osm(g, f, osm, has_xy):
    """osm: DataFrame(name_key, lat, lon). Fuzzy name match within 2 km of the coordinates OR of the PIN centroid."""
    from difflib import SequenceMatcher  # noqa
    osm = osm.dropna(subset=["lat", "lon"]).copy()
    osm["nk"] = osm.name.map(lkey)
    by_cell = {}
    for i, (la, lo) in enumerate(zip(osm.lat.values, osm.lon.values)):
        by_cell.setdefault((int(la * 20), int(lo * 20)), []).append(i)

    olat, olon, onk = osm.lat.values, osm.lon.values, osm.nk.values

    def near(la, lo, nk):
        """Distance (km) to the closest OSM place within 2 km whose name is >= 80% similar; NaN if none."""
        if np.isnan(la) or not nk:
            return np.nan
        cand = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                cand += by_cell.get((int(la * 20) + dx, int(lo * 20) + dy), [])
        if not cand:
            return np.nan
        cand = np.array(cand)
        d = haversine_km(la, lo, olat[cand], olon[cand])          # vectorised: one call per facility
        for j in np.argsort(d):
            if d[j] > 2.0:
                break
            if difflib.SequenceMatcher(None, nk, onk[cand[j]]).ratio() >= 0.8:
                return float(d[j])
        return np.nan
    nk = f.name.map(lkey).values
    dc = np.array([near(a, b, n) for a, b, n in zip(g.lat, g.lon, nk)])
    dp = np.array([near(a, b, n) for a, b, n in zip(g.pin_lat, g.pin_lon, nk)])
    g["osm_near"] = np.where(~np.isnan(dc), "coords", np.where(~np.isnan(dp), "pin", None))
    g["osm_dist_km"] = np.where(~np.isnan(dc), dc, dp)
    g["osm_match"] = ~(np.isnan(dc) & np.isnan(dp))
    return g


def _reasons(g, state_names, city, raw_zip):
    out = []
    for i in range(len(g)):
        r = g.iloc[i]
        msg = []
        raw_state = state_names.iat[i]
        if r.flag_state_field_not_a_state:
            msg.append(f"State field held '{raw_state}', which is not a state; state taken from the PIN ({r.state_final}).")
        if r.flag_pin_state_unreliable:
            msg.append(f"PIN {r.pin6} is listed under {str(r.pin_state_listed).title()} in the India Post directory, but the address and the coordinates are in {str(r.state_final).title()}; the PIN was ignored.")
        if r.flag_state_conflict_ap_telangana:
            msg.append(f"Address says {str(r.state_norm).title()} but PIN {r.pin6} is in {str(r.pin_state).title()}; trusted the PIN (2014 state split).")
        elif r.flag_state_conflict_other and not r.flag_pin_state_unreliable:
            msg.append(f"Address state ({str(r.state_norm).title()}) differs from the PIN's state ({str(r.pin_state).title()}).")
        if r.flag_pin_reformatted:
            msg.append(f"PIN was written as '{raw_zip.iat[i]}' and was cleaned to {r.pin6}.")
        if r.pin_source == "address_text":
            msg.append(f"PIN field was unusable; PIN {r.pin6} was read from the address text.")
        if r.flag_pin_invalid and r.pin_source != "address_text":
            msg.append("PIN is not in the India Post directory; location is approximate.")
        if r.pin_source == "none":
            msg.append("No usable PIN code.")
        if r.flag_multiple_pins:
            msg.append("Address text mentions more than one PIN code" + (" in different states" if r.flag_multiple_pin_states else "") + "; the record may combine several facilities.")
        if r.flag_coords_outside_india:
            msg.append("Coordinates fall outside India and were discarded.")
        if r.flag_latlon_swapped:
            msg.append("Latitude and longitude looked swapped and were corrected.")
        km = r.geo_mismatch_km
        if r.flag_geo_mismatch_100km:
            msg.append(f"Coordinates are {km:.0f} km from the stated PIN code, so they are probably wrong or merged.")
        elif r.flag_geo_mismatch_25km:
            msg.append(f"Coordinates are {km:.0f} km from the stated PIN code centroid.")
        if r.flag_shared_coords:
            msg.append(f"{int(r.shared_coord_n)} facilities share these exact coordinates (locality-level geocode, not the building).")
        if r.flag_district_conflict:
            msg.append(f"PIN points to {str(r.pin_district).title()} district but the coordinates fall in {str(r.coord_district).title()}.")
        if r.flag_coord_state_mismatch:
            msg.append(f"Coordinates fall in {str(r.coord_state).title()}, not {str(r.state_final).title()}.")
        if r.flag_city_mismatch:
            msg.append(f"City '{city.iat[i]}' does not match the PIN's area ({str(r.pin_district).title()}).")
        if r.flag_pin_spans_districts and r.pin_source != "none":
            msg.append("This PIN code covers more than one district, so district assignment is approximate.")
        if r.osm_match is True or r.osm_match == True:  # noqa
            msg.append(f"A matching place exists in OpenStreetMap within {r.osm_dist_km:.1f} km.")
        s = r.location_trust
        tail = {
            "verified": "Location verified: coordinates agree with the PIN code.",
            "verified_osm": "Location verified against OpenStreetMap.",
            "probable": ("Using the coordinates: the address state and the coordinates agree." if r.flag_pin_state_unreliable
                         else "Using the coordinates: they are in the same district as the PIN but not close to its centre."),
            "approximate_pin": "Showing the approximate location of the PIN code area.",
            "approximate_district": "Only the district is known; showing the district centre.",
            "unverified": "Location could not be verified.",
            "unknown": "No usable location information.",
        }[s]
        msg.append(tail)
        out.append(json.dumps(msg, ensure_ascii=False))
    return out


# ----------------------------------------------------------------------------- J1 / J2: coverage & density
def build_density(geo, reference, nfhs=None, nfhs_mapping=None, base=None):
    """District-level coverage table (J2) and state-level table (J1).

    A facility counts toward a district via its PIN (or coordinates when there is no PIN).
    `n_trusted` counts facilities whose location_trust_level is not 'low'.
    """
    d = reference["district"].copy()
    gk = geo.dropna(subset=["district_final_key", "district_state"])
    cnt = gk.groupby(["district_state", "district_final_key"]).agg(
        n_facilities=("unique_id", "size"),
        n_trusted=("location_trust_level", lambda s: int((s != "low").sum())),
        n_verified=("location_trust", lambda s: int(s.isin(["verified", "verified_osm", "probable"]).sum())),
    ).reset_index().rename(columns={"district_state": "state", "district_final_key": "dkey"})
    d = d.merge(cnt, on=["state", "dkey"], how="left")
    for c in ["n_facilities", "n_trusted", "n_verified"]:
        d[c] = d[c].fillna(0).astype(int)
    if base is not None and "facilityTypeId" in base.columns:
        t = base[["unique_id", "facilityTypeId", "operatorTypeId"]].merge(geo[["unique_id", "district_state", "district_final_key"]], on="unique_id")
        t = t.dropna(subset=["district_state"])
        pub = t[t.operatorTypeId.isin(["public", "government"])].groupby(["district_state", "district_final_key"]).size().rename("n_public")
        hos = t[t.facilityTypeId == "hospital"].groupby(["district_state", "district_final_key"]).size().rename("n_hospitals")
        for s in (pub, hos):
            s.index.names = ["state", "dkey"]
            d = d.merge(s.reset_index(), on=["state", "dkey"], how="left")
            d[s.name] = d[s.name].fillna(0).astype(int)
    d["data_density"] = pd.cut(d.n_facilities, [-1, 0, 3, 15, 10 ** 6], labels=["none", "sparse", "moderate", "dense"])
    msg = {"none": "No facilities in our data for this district; results will come from further away.",
           "sparse": "Few facilities in our data for this district; absence of a service here may just mean missing data.",
           "moderate": "", "dense": ""}
    d["coverage_message"] = d.data_density.astype(str).map(msg)
    if nfhs is not None and nfhs_mapping is not None:
        inv = {k: v for k, v in nfhs_mapping.items()}
        d["nfhs_row"] = [inv.get((s, k)) for s, k in zip(d.state, d.dkey)]
        d["nfhs_district"] = d.nfhs_row.map(lambda i: nfhs.district_name.iat[int(i)] if pd.notna(i) else None)
        d["nfhs_matched"] = d.nfhs_row.notna()
    st = geo.dropna(subset=["state_final"]).groupby("state_final").agg(
        n_facilities=("unique_id", "size"), n_trusted=("location_trust_level", lambda s: int((s != "low").sum()))).reset_index()
    allst = pd.DataFrame({"state_final": reference["canon"]})
    st = allst.merge(st, how="left", on="state_final").fillna({"n_facilities": 0, "n_trusted": 0})
    st["n_facilities"] = st.n_facilities.astype(int)
    st["n_trusted"] = st.n_trusted.astype(int)
    st["share_pct"] = (st.n_facilities / st.n_facilities.sum() * 100).round(1)
    st["n_districts"] = st.state_final.map(d.groupby("state").size()).fillna(0).astype(int)
    st["districts_with_zero"] = st.state_final.map(d[d.n_facilities == 0].groupby("state").size()).fillna(0).astype(int)
    st["coverage_message"] = np.where(st.n_facilities < 30, "Very few facilities in our data for this state/UT; treat gaps as missing data, not as absence of care.", "")
    return d, st.sort_values("n_facilities", ascending=False)
