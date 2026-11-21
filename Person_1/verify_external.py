"""
Person 1 – Verification against real outside data
=================================================
Run AFTER build_fac_base.py.  Adds verification + recognition columns to output/fac_base.parquet.

What is checked, and against what:
  * Address       -> India Post PIN directory (official): PIN exists, PIN's state = stated state,
                     city appears in the PIN's district / post-office names, coordinates near the PIN centre;
                     plus Wikidata location when the facility is matched there.
  * Founding year -> Wikidata 'inception' (independent source) and the facility's own text
                     ("established in 1987") – the latter is the SAME source, so it only shows consistency.
  * Beds          -> Wikidata 'number of hospital beds' and bed counts written in the facility's own text.
  * Doctors       -> doctor counts written in the facility's own text.
  * Recognition   -> Wikipedia / Wikidata presence, accreditation claimed in the record, teaching status,
                     verified age. NOT patient reviews (no review source was available – see report).
  * Extreme values-> manual web checks recorded in external/manual_web_checks.csv (with source URLs).

Outside data used (cached in Person_1/external/):
  wd1.csv / wd2.csv                  Wikidata: every item in India that is a hospital (Q16917 or subclass) + English aliases
  wd1_medschool.csv / wd2_medschool.csv  same for medical schools (Q494230)
"""
import json, re, unicodedata
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
OUT, EXT, DATA = HERE / "output", HERE / "external", HERE / "dataset"
CURRENT_YEAR = 2026
S = {}

# ----------------------------------------------------------------------------- helpers
def hav(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371 * np.arcsin(np.sqrt(a))


AGG = ("facebook.", "justdial.", "practo.", "google.", "instagram.", "linkedin.", "twitter.", "x.com", "youtube.",
       "wikipedia.", "lybrate.", "sulekha.", "indiamart.", "business.site", "blogspot.", "wixsite.", "wordpress.com",
       "medindia.", "credihealth.", "hexahealth.", "mappls.", "onefivenine.", "proptiger.", "policyx.", "bajajfinserv",
       "zoominfo.", "docindia.", "healthfrog.", "drlogy.", "clinicspots.", "latlong.")


def domain(u):
    if not isinstance(u, str) or not u.strip():
        return None
    u = u.strip().lower()
    u = u if "://" in u else "http://" + u
    try:
        d = urlparse(u).netloc.split(":")[0]
    except ValueError:
        return None
    d = d[4:] if d.startswith("www.") else d
    return d or None


GENERIC = {"hospital", "hospitals", "clinic", "clinics", "centre", "center", "medical", "multispeciality", "multi",
           "speciality", "specialty", "super", "superspeciality", "superspecialty", "pvt", "ltd", "private", "limited",
           "the", "and", "of", "research", "care", "health", "healthcare", "institute", "sciences", "science", "nursing",
           "home", "trust", "memorial", "general", "a", "&", "in", "for", "at", "dr", "unit", "branch"}


STATES_WORDS = {"india", "andhra", "pradesh", "arunachal", "assam", "bihar", "chhattisgarh", "goa", "gujarat", "haryana",
                "himachal", "jharkhand", "karnataka", "kerala", "madhya", "maharashtra", "manipur", "meghalaya", "mizoram",
                "nagaland", "odisha", "orissa", "punjab", "rajasthan", "sikkim", "tamil", "nadu", "tamilnadu", "telangana",
                "tripura", "uttar", "uttarakhand", "west", "bengal", "delhi", "new", "jammu", "kashmir", "puducherry", "chandigarh"}


INSTITUTION_TYPES = {"taluk", "taluka", "headquarters", "hq", "district", "civil", "government", "govt", "rural", "community",
                     "primary", "sub", "divisional", "esic", "esi", "railway", "police", "mental", "regional", "state",
                     "referral", "cantonment", "military", "municipal", "corporation", "maternity", "women", "children",
                     "eye", "dental", "college", "chest", "tb", "cancer", "national", "city", "christian", "mission"}


SPECIALTY_WORDS = ("dental", "eye", "cancer", "onco", "mental", "psychiat", "ayurved", "homoeo", "homeo", "unani", "siddha",
                   "veterinar", "children", "child", "women", "maternity", "ent", "ortho", "cardiac", "heart", "kidney",
                   "neuro", "skin", "fertility", "ivf", "diagnostic", "lab", "blood")


def name_tokens(s, drop=frozenset()):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return [t for t in re.findall(r"[a-z0-9]+", s.lower()) if t not in GENERIC and t not in STATES_WORDS and t not in drop]


def name_sim(a, b, drop=frozenset()):
    """Similarity of the DISTINCTIVE words of two names (generic words, state names and the
    facility's own city/district words removed, so 'Kottayam Dental Home' != 'General Hospital, Kottayam')."""
    ta, tb = set(name_tokens(a, drop)), set(name_tokens(b, drop))
    if (ta and ta <= INSTITUTION_TYPES) or (tb and tb <= INSTITUTION_TYPES):
        # e.g. "Taluk Headquarters Hospital, Punalur": only the town distinguishes it -> keep town words
        ta, tb = set(name_tokens(a)), set(name_tokens(b))
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    seq = SequenceMatcher(None, " ".join(sorted(ta)), " ".join(sorted(tb))).ratio()
    sim = 0.5 * inter / min(len(ta), len(tb)) + 0.3 * inter / max(len(ta), len(tb)) + 0.2 * seq
    # one name says Dental/Eye/Cancer/... and the other doesn't -> different kind of institution
    if {t for t in (ta ^ tb) if any(t.startswith(k) for k in SPECIALTY_WORDS)}:
        sim -= 0.3
    return round(max(sim, 0.0), 3)


# ----------------------------------------------------------------------------- Wikidata
def load_wikidata():
    # hospitals (Q16917) + medical schools (Q494230; e.g. AIIMS Rishikesh is typed only as a medical school)
    w = pd.concat([pd.read_csv(EXT / "wd1.csv"), pd.read_csv(EXT / "wd1_medschool.csv")], ignore_index=True)
    alts = pd.concat([pd.read_csv(EXT / "wd2.csv"), pd.read_csv(EXT / "wd2_medschool.csv")]
                     ).groupby("h")["alt"].apply(lambda s: sorted(set(s)))
    w["lon"] = w["coord"].str.extract(r"Point\(([-\d.]+) ")[0].astype(float)
    w["lat"] = w["coord"].str.extract(r" ([-\d.]+)\)")[0].astype(float)
    w["inc_year"] = pd.to_numeric(w["inc"].astype(str).str[:4], errors="coerce")
    w["dom"] = w["web"].map(domain)
    g = w.groupby("h").agg(label=("hLabel", "first"), lat=("lat", "first"), lon=("lon", "first"),
                           inc_year=("inc_year", "min"), beds=("beds", "max"),
                           doms=("dom", lambda s: sorted({d for d in s if isinstance(d, str) and d})), postcode=("pc", "first"),
                           sitelinks=("sl", "max"), enwiki=("enwiki", "first"), admin=("admLabel", "first")).reset_index()
    g["alts"] = g["h"].map(alts).map(lambda v: v if isinstance(v, list) else [])
    g["qid"] = g["h"].str.rsplit("/", n=1).str[-1]
    g["postcode"] = g["postcode"].map(lambda x: None if pd.isna(x) else str(x).split(".")[0])
    S["wikidata"] = dict(items=len(g), with_coords=int(g.lat.notna().sum()), with_inception=int(g.inc_year.notna().sum()),
                         with_beds=int(g.beds.notna().sum()), with_website=int(g.doms.map(len).gt(0).sum()),
                         with_en_wikipedia=int(g.enwiki.notna().sum()))
    return g


# Matches judged wrong or doubtful in the manual audit -> rejected (facility unique_id, Wikidata QID)
REJECTED_MATCHES = {
    ("d22fe25f-42d6-4d2f-bff9-4f94f7c99816", "Q6437413"),   # Krishna Clinic -> Krishna Heart Institute (different facility)
    ("35075c4b-0e23-4c0a-b01d-ccc77fe07963", "Q17146020"),  # Regional Mental Hospital Nagpur -> Yerwada (Pune)
    ("ddfc13b1-edd5-4950-bf42-76317a817e54", "Q39052559"),  # SVIMS Tirupati -> Sri Venkateswara Medical College
    ("82c5dd40-e186-454c-97f0-ab46b45839b9", "Q6040494"),  # Max Centre for Liver & Biliary Sciences -> ILBS (different hospital)
}


def match_wikidata(df, wd, pin_cent):
    """Match each facility to at most one Wikidata hospital.
    Precision first (audited on a first version that matched chains to the wrong branch):
      * only the facility's own officialWebsite domain counts (the scraped `websites` list mixes in other hospitals)
      * a name-similarity threshold AND a distance limit are ALWAYS required;
        distance = min(distance from the record's coordinates, distance from its PIN centre), because ~16% of
        coordinates are wrong
      * one Wikidata item -> one facility (best score wins)."""
    wd_has = wd.lat.notna().values
    wlat, wlon = wd.lat.values, wd.lon.values
    own_dom = df.officialWebsite.map(domain).map(lambda d: d if isinstance(d, str) and not any(a in d for a in AGG) else None)
    rows = []
    for idx, r in df.iterrows():
        pts = [(r.latitude, r.longitude), (r.pin_lat, r.pin_lon)]
        pts = [(a, b) for a, b in pts if pd.notna(a) and pd.notna(b)]
        if not pts:
            continue
        dist_all = np.min([hav(a, b, wlat, wlon) for a, b in pts], axis=0)
        cands = np.where(wd_has & (dist_all <= 15))[0]
        best = None
        for j in cands:
            w = wd.iloc[j]
            drop = frozenset(re.findall(r"[a-z]+", f"{r.address_city} {r.pin_district} {w.admin}".lower()))
            names = {r["name"], r["display_name"]}
            sim = max(name_sim(n, l, drop) for n in names for l in [w.label] + list(w.alts))
            dist = float(dist_all[j])
            dom_hit = own_dom[idx] is not None and own_dom[idx] in w.doms
            if dom_hit and sim >= 0.7:
                method, score = "official website + name + location (<=15 km)", 3 + sim - dist / 100
            elif sim >= 0.85 and dist <= 5:
                method, score = "name + location (<=5 km)", 2 + sim - dist / 100
            elif sim >= 0.95 and dist <= 15:
                method, score = "name + location (<=15 km)", 1.5 + sim - dist / 100
            else:
                continue
            if best is None or score > best[0]:
                best = (score, j, method, sim, dist)
        if best:
            w = wd.iloc[best[1]]
            rows.append(dict(unique_id=r.unique_id, wd_qid=w.qid, wd_label=w.label, wd_match_method=best[2],
                             wd_name_similarity=best[3], wd_distance_km=round(best[4], 2), wd_score=best[0],
                             wd_inception_year=w.inc_year, wd_beds=w.beds, wd_enwiki=w.enwiki, wd_sitelinks=w.sitelinks,
                             wd_postcode=w.postcode))
    m = pd.DataFrame(rows)
    rejected = m[[(u, q) in REJECTED_MATCHES for u, q in zip(m.unique_id, m.wd_qid)]]
    m = m[[(u, q) not in REJECTED_MATCHES for u, q in zip(m.unique_id, m.wd_qid)]]
    S["wikidata_rejected_by_audit"] = rejected[["unique_id", "wd_qid", "wd_label"]].values.tolist()
    before = len(m)
    m = m.sort_values("wd_score", ascending=False).drop_duplicates("wd_qid").drop(columns="wd_score")
    S["wikidata_match"] = dict(candidate_matches=before, dropped_as_second_claim_on_same_item=before - len(m),
                               matched_facilities=len(m), by_method=m.wd_match_method.value_counts().to_dict(),
                               with_inception=int(m.wd_inception_year.notna().sum()),
                               with_beds=int(m.wd_beds.notna().sum()), with_en_wikipedia=int(m.wd_enwiki.notna().sum()),
                               distance_km_median=float(m.wd_distance_km.median()))
    return m


# ----------------------------------------------------------------------------- India Post / address
STATE_ALIAS = {"TAMILNADU": "TAMIL NADU", "ORISSA": "ODISHA", "UP": "UTTAR PRADESH", "U P": "UTTAR PRADESH",
               "CHATTISGARH": "CHHATTISGARH", "NCT OF DELHI": "DELHI", "NEW DELHI": "DELHI", "PONDICHERRY": "PUDUCHERRY",
               "PUNJAB REGION": "PUNJAB", "TS": "TELANGANA", "TELENGANA": "TELANGANA", "MAHARASTRA": "MAHARASHTRA",
               "UTTARANCHAL": "UTTARAKHAND", "J AND K": "JAMMU AND KASHMIR", "J K": "JAMMU AND KASHMIR"}
CITY_ALIAS = {"bangalore": "bengaluru", "gurgaon": "gurugram", "bombay": "mumbai", "calcutta": "kolkata", "madras": "chennai",
              "baroda": "vadodara", "trivandrum": "thiruvananthapuram", "mysore": "mysuru", "pondicherry": "puducherry",
              "cochin": "kochi", "calicut": "kozhikode", "poona": "pune", "allahabad": "prayagraj", "vizag": "visakhapatnam",
              "hubli": "hubballi", "belgaum": "belagavi", "mangalore": "mangaluru", "gulbarga": "kalaburagi"}


def load_pin():
    p = pd.read_csv(DATA / "india_post_pincode_directory.csv", dtype=str)
    p["lat"] = pd.to_numeric(p.latitude, errors="coerce"); p["lon"] = pd.to_numeric(p.longitude, errors="coerce")
    ok = p.lat.between(6, 37.6) & p.lon.between(68, 97.5)
    cent = p[ok].groupby("pincode")[["lat", "lon"]].median().rename(columns={"lat": "pin_lat", "lon": "pin_lon"})
    st = p.dropna(subset=["statename"]).groupby("pincode")["statename"].agg(lambda s: s.mode().iloc[0])
    dist = p.dropna(subset=["district"]).groupby("pincode")["district"].agg(lambda s: s.mode().iloc[0])
    words = p.groupby("pincode").apply(lambda g: " ".join(
        g[["officename", "district", "divisionname", "regionname"]].fillna("").astype(str).values.ravel()).lower())
    ref = cent.join(st.rename("pin_state"), how="outer").join(dist.rename("pin_district")).join(words.rename("pin_words"))
    return ref, sorted(p.statename.dropna().str.upper().unique())


def norm_state(s, canon):
    if not isinstance(s, str):
        return None
    t = re.sub(r"\s+", " ", re.sub(r"[^A-Z ]", " ", s.upper().replace("&", " AND "))).strip()
    if t in canon:
        return t
    if t in STATE_ALIAS:
        return STATE_ALIAS[t]
    for c in sorted(canon, key=len, reverse=True):
        if re.search(rf"\b{c}\b", t):
            return c
    return None


def address_checks(df, ref, canon):
    pin = df.address_zipOrPostcode.fillna("").str.replace(r"\s", "", regex=True)
    from_addr = (df.address_line1.fillna("") + " " + df.address_line2.fillna("") + " " + df.address_line3.fillna("")
                 ).str.extract(r"(?<!\d)([1-8]\d{2}\s?\d{3})(?!\d)")[0].str.replace(" ", "")
    df["pin6"] = pin.where(pin.str.fullmatch(r"[1-8]\d{5}"), from_addr)
    df["pin_source"] = np.where(pin.str.fullmatch(r"[1-8]\d{5}"), "postcode field",
                                np.where(from_addr.notna(), "extracted from address", "none"))
    df = df.join(ref, on="pin6")
    df["pin_valid"] = df.pin_state.notna()
    df["state_norm"] = df.address_stateOrRegion.map(lambda s: norm_state(s, canon))
    df["km_coords_to_pin"] = hav(df.latitude, df.longitude, df.pin_lat, df.pin_lon).round(1)

    def city_ok(r):
        if not r.pin_valid or not isinstance(r.address_city, str):
            return np.nan
        c = re.sub(r"[^a-z ]", " ", r.address_city.lower()).strip()
        c = CITY_ALIAS.get(c, c)
        toks = [t for t in c.split() if len(t) > 3] or c.split()
        w = r.pin_words
        for a, b in CITY_ALIAS.items():
            w = w.replace(a, b)
        return any(t in w for t in toks)
    df["city_matches_pin"] = df.apply(city_ok, axis=1)
    aptg = {frozenset({"ANDHRA PRADESH", "TELANGANA"})}

    def verdict(r):
        ev = []
        if not r.pin_valid:
            ev.append(f"PIN '{r.address_zipOrPostcode}' not found in the India Post directory" if isinstance(r.address_zipOrPostcode, str)
                      else "no PIN code in the address")
            if pd.notna(r.wd_distance_km) and r.wd_distance_km <= 2:
                ev.append(f"Wikidata places '{r.wd_label}' {r.wd_distance_km} km from these coordinates")
                return "partly verified (Wikidata location only)", ev
            return "unverifiable (no valid PIN)", ev
        ev.append(f"PIN {r.pin6} = {str(r.pin_district).title()} district, {str(r.pin_state).title()} (India Post)")
        state_conf = r.state_norm is not None and r.state_norm != r.pin_state
        split = state_conf and frozenset({r.state_norm, r.pin_state}) in aptg
        if state_conf:
            ev.append(f"stated state '{r.address_stateOrRegion}' differs from the PIN's state"
                      + (" (Andhra Pradesh/Telangana split of 2014 - PIN trusted)" if split else ""))
        if r.state_norm is None:
            ev.append(f"state field '{r.address_stateOrRegion}' is not a state name; PIN state used")
        if r.city_matches_pin is True:
            ev.append(f"city '{r.address_city}' appears in the PIN's district/post-office names")
        elif r.city_matches_pin is False:
            ev.append(f"city '{r.address_city}' does not appear in the PIN's district/post-office names")
        if pd.notna(r.km_coords_to_pin):
            ev.append(f"coordinates are {r.km_coords_to_pin:,.1f} km from the PIN centre")
        wd_ok = pd.notna(r.wd_distance_km) and r.wd_distance_km <= 2
        if pd.notna(r.wd_distance_km):
            ev.append(f"Wikidata places '{r.wd_label}' {r.wd_distance_km} km from these coordinates")
        far = pd.notna(r.km_coords_to_pin) and r.km_coords_to_pin > 100
        if (state_conf and not split) or far:
            return "conflict", ev
        near = pd.notna(r.km_coords_to_pin) and r.km_coords_to_pin <= 10
        if near and (r.city_matches_pin is True or wd_ok):
            return "verified", ev
        if pd.notna(r.km_coords_to_pin) and r.km_coords_to_pin <= 25:
            return "consistent", ev
        return "partly consistent", ev
    v = df.apply(verdict, axis=1)
    df["address_check"] = v.str[0]
    df["address_evidence"] = v.str[1]
    S["address"] = dict(pin_source=df.pin_source.value_counts().to_dict(), pin_valid=int(df.pin_valid.sum()),
                        city_matches_pin=df.city_matches_pin.value_counts(dropna=False).rename(str).to_dict(),
                        km_to_pin_median=float(df.km_coords_to_pin.median()),
                        address_check=df.address_check.value_counts().to_dict())
    return df


# ----------------------------------------------------------------------------- years / beds / doctors from own text
YEAR_PAT = re.compile(
    r"\b(?:established|estd\.?|est\.|founded|since|started|inception|incorporated|set up|setup|began|commenced|"
    r"serving since|in service since|operating since|dating back to|opened)\b[^0-9]{0,30}?((?:1[5-9]|20)\d{2})\b", re.I)
BED_PAT = re.compile(r"\b(\d{2,5})\s*\+?\s*(?:-|\s)?\s*(?:plus\s+)?(?:bed(?:ded|s)?)\b", re.I)
DOC_PAT = re.compile(r"\b(\d{2,5})\s*\+?\s*(?:doctors|specialists|consultants|physicians)\b", re.I)


def own_text(r):
    parts = [r.description or ""]
    for c in ("capability", "procedure"):
        v = r[c]
        if v is not None:
            parts.extend(map(str, v))
    return " ".join(parts)


def year_bed_doctor_checks(df):
    txt = df.apply(own_text, axis=1)
    df["year_in_text"] = txt.map(lambda t: sorted({int(y) for y in YEAR_PAT.findall(t) if 1500 <= int(y) <= CURRENT_YEAR}) or None)
    df["beds_in_text"] = txt.map(lambda t: sorted({int(b) for b in BED_PAT.findall(t) if 5 <= int(b) <= 10000}) or None)
    df["doctors_in_text"] = txt.map(lambda t: sorted({int(b) for b in DOC_PAT.findall(t) if 2 <= int(b) <= 20000}) or None)

    def year(r):
        y, ev = r.yearEstablished, []
        wdy = r.wd_inception_year
        ty = r.year_in_text if r.year_in_text is not None else []
        if pd.isna(y):
            if pd.notna(wdy):
                ev.append(f"Wikidata inception {int(wdy)} ({r.wd_qid})")
            if len(ty):
                ev.append(f"own text mentions {', '.join(map(str, ty))}")
            return ("missing - other source has a year" if ev else "missing"), ev
        y = int(y)
        if pd.notna(wdy):
            gap = abs(int(wdy) - y)
            if gap <= 1:
                return "confirmed (Wikidata)", [f"Wikidata inception {int(wdy)} ({r.wd_qid}) matches {y}"]
            if gap <= 5:
                return "close to Wikidata (2-5 years apart)", [f"Wikidata inception {int(wdy)} ({r.wd_qid}) vs {y}; "
                                                                 "small gaps are usually registration vs opening dates"]
            ev.append(f"Wikidata inception {int(wdy)} ({r.wd_qid}) is {gap} years from {y}")
            return "contradicted (Wikidata)", ev + ([f"own text mentions {', '.join(map(str, ty))}"] if len(ty) else [])
        if len(ty):
            if any(abs(t - y) <= 1 for t in ty):
                return "consistent with own text", [f"own text says established/since {', '.join(map(str, ty))}"]
            return "conflicts with own text", [f"own text mentions {', '.join(map(str, ty))}, record says {y}"]
        return "unverified", ["no independent source found"]
    v = df.apply(year, axis=1)
    df["year_check"], df["year_evidence"] = v.str[0], v.str[1]

    def beds(r):
        b, ev = r.capacity, []
        wb, tb = r.wd_beds, (r.beds_in_text if r.beds_in_text is not None else [])
        if pd.isna(b):
            return "missing", ([f"own text mentions {', '.join(map(str, tb))} beds"] if len(tb) else [])
        b = int(b)
        if pd.notna(wb):
            if abs(wb - b) <= 0.2 * max(wb, b):
                return "confirmed (Wikidata)", [f"Wikidata: {int(wb)} beds ({r.wd_qid})"]
            ev.append(f"Wikidata: {int(wb)} beds ({r.wd_qid}) vs record {b}")
            return "contradicted (Wikidata)", ev
        if len(tb):
            if any(abs(t - b) <= 0.1 * max(t, b) for t in tb):
                return "consistent with own text", [f"own text mentions {', '.join(map(str, tb))} beds"]
            return "differs from own text", [f"own text mentions {', '.join(map(str, tb))} beds (may be one unit, e.g. ICU), record says {b}"]
        return "unverified", []
    v = df.apply(beds, axis=1)
    df["capacity_check"], df["capacity_evidence"] = v.str[0], v.str[1]

    def docs(r):
        d, td = r.numberDoctors, (r.doctors_in_text if r.doctors_in_text is not None else [])
        if pd.isna(d):
            return "missing", ([f"own text mentions {', '.join(map(str, td))} doctors"] if len(td) else [])
        d = int(d)
        if len(td):
            if any(abs(t - d) <= 0.1 * max(t, d) for t in td):
                return "consistent with own text", [f"own text mentions {', '.join(map(str, td))} doctors"]
            return "differs from own text", [f"own text mentions {', '.join(map(str, td))} doctors, record says {d}"]
        return "unverified", []
    v = df.apply(docs, axis=1)
    df["doctors_check"], df["doctors_evidence"] = v.str[0], v.str[1]
    S["year_check"] = df.year_check.value_counts().to_dict()
    S["capacity_check"] = df.capacity_check.value_counts().to_dict()
    S["doctors_check"] = df.doctors_check.value_counts().to_dict()
    S["text_mentions"] = dict(year=int(df.year_in_text.notna().sum()), beds=int(df.beds_in_text.notna().sum()),
                              doctors=int(df.doctors_in_text.notna().sum()))
    return df


# ----------------------------------------------------------------------------- recognition
TEACHING = re.compile(r"medical college|institute of medical sciences|\baiims\b|all india institute|pgimer|jipmer|"
                      r"post ?graduate institute|medical university|university hospital|teaching hospital|"
                      r"christian medical college|\bcmc\b", re.I)
ACCRED = {"NABH": re.compile(r"\bNABH\b"), "JCI": re.compile(r"\bJCI\b|joint commission international", re.I),
          "NABL": re.compile(r"\bNABL\b")}


ENTRY = re.compile(r"entry[- ]?level|pre[- ]?accredit|pre[- ]?entry|applied|applying|in process|working towards|seeking", re.I)


def recognition(df):
    txt = df.apply(own_text, axis=1) + " " + df.name.fillna("")
    acad = df.affiliationTypeIds.map(lambda l: l is not None and "academic" in list(l))

    def rec(i, r):
        pts, ev = 0, []
        if isinstance(r.wd_enwiki, str):
            pts += 3; ev.append(f"has an English Wikipedia article ({r.wd_enwiki})")
        elif isinstance(r.wd_qid, str):
            pts += 1; ev.append(f"listed on Wikidata ({r.wd_qid})")
        t = txt[i]
        acc = [k for k, p in ACCRED.items() if p.search(t)]
        nabh_sents = [x for x in re.split(r"(?<=[.!?;])\s", t) if re.search(r"\bNABH\b", x)]
        entry_only = bool(nabh_sents) and all(ENTRY.search(x) for x in nabh_sents)
        if "JCI" in acc or ("NABH" in acc and not entry_only):
            pts += 2; ev.append(f"record claims {', '.join(a for a in acc if a != 'NABL')} accreditation (claim, not checked against the register)")
        elif "NABH" in acc and entry_only:
            pts += 1; ev.append("record claims NABH entry-level / pre-accreditation only (claim, not checked against the register)")
        elif "NABL" in acc:
            pts += 1; ev.append("record claims NABL (lab) accreditation (claim, not checked against the register)")
        if TEACHING.search(str(r["name"])) or acad[i]:
            pts += 2; ev.append("teaching hospital / medical college / academic affiliation")
        y = r.yearEstablished
        trusted_year = r.year_check in ("confirmed (Wikidata)", "close to Wikidata (2-5 years apart)", "consistent with own text",
                                        "web: confirmed", "corrected from Wikidata", "filled from Wikidata",
                                        "corrected from web check", "confirmed by web check")
        if pd.notna(y) and trusted_year:
            age = CURRENT_YEAR - int(y)
            if age >= 50:
                pts += 2; ev.append(f"operating since {int(y)} ({age} years, {r.year_check})")
            elif age >= 25:
                pts += 1; ev.append(f"operating since {int(y)} ({age} years, {r.year_check})")
        tier = ("high" if pts >= 5 else "moderate" if pts >= 3 else "some" if pts >= 1 else "no evidence found")
        return pts, tier, ev
    v = [rec(i, r) for i, r in df.iterrows()]
    df["recognition_score"] = [x[0] for x in v]
    df["recognition_tier"] = [x[1] for x in v]
    df["recognition_evidence"] = [x[2] for x in v]
    S["recognition"] = dict(tier=df.recognition_tier.value_counts().to_dict(),
                            components=dict(en_wikipedia=int(df.wd_enwiki.notna().sum()),
                                            wikidata_only=int((df.wd_qid.notna() & df.wd_enwiki.isna()).sum()),
                                            nabh_or_jci_claim=int(txt.str.contains(r"\bNABH\b|\bJCI\b|joint commission international", case=False, regex=True).sum()),
                                            teaching=int((df.name.str.contains(TEACHING, na=False) | acad).sum())))
    return df


# ----------------------------------------------------------------------------- manual web checks
def manual_checks(df):
    """Web-checked extreme values (external/manual_web_checks.csv, one row per facility+field, with sources).
    The web verdict overrides the automatic check for that field."""
    p = EXT / "manual_web_checks.csv"
    df["web_check_sources"] = None
    if not p.exists():
        return df
    m = pd.read_csv(p)
    col = {"capacity": ("capacity_check", "capacity_evidence"), "numberDoctors": ("doctors_check", "doctors_evidence"),
           "yearEstablished": ("year_check", "year_evidence")}
    pos = {u: i for i, u in enumerate(df.unique_id)}
    df = df.copy()
    for r in m.itertuples():
        i = pos.get(r.unique_id)
        if i is None:
            continue
        c, e = col[r.field]
        df.at[df.index[i], c] = f"web: {r.verdict}"
        df.at[df.index[i], e] = [f"web check {r.checked_on}: {r.finding}"]
        srcs = df.at[df.index[i], "web_check_sources"]
        df.at[df.index[i], "web_check_sources"] = sorted(set((list(srcs) if srcs is not None else []) + str(r.sources).split(" | ")))
    S["manual_web_checks"] = dict(rows=len(m), facilities=int(m.unique_id.nunique()), verdicts=m.verdict.value_counts().to_dict())
    return df


# ----------------------------------------------------------------------------- replace record values with verified ones
def _band(v, edges, labels):
    if pd.isna(v):
        return "unknown"
    for (lo, hi), lab in zip(edges, labels):
        if lo <= v < hi:
            return lab
    return labels[-1]


def apply_verified_values(df):
    """Where an outside source gives a specific value, use it instead of the dataset's value.
    Priority: web check with a specific value > Wikidata.  The dataset's value stays in raw_<col>;
    <col>_source says where the value now comes from.  Nothing is invented: a contradicted value with no
    specific replacement keeps the record value and its *_check says so."""
    web = pd.read_csv(EXT / "manual_web_checks.csv") if (EXT / "manual_web_checks.csv").exists() else pd.DataFrame()
    webv = {(r.unique_id, r.field): r for r in web.itertuples() if pd.notna(getattr(r, "verified_value", np.nan))}
    plan = {"yearEstablished": ("year_check", "wd_inception_year", "year_evidence"),
            "capacity": ("capacity_check", "wd_beds", "capacity_evidence"),
            "numberDoctors": ("doctors_check", None, "doctors_evidence")}
    changes, disputes = [], []
    for col, (chk, wdcol, evc) in plan.items():
        src = pd.Series(np.where(df[col].notna(), "record", None), index=df.index, dtype=object)
        alt = pd.Series(pd.NA, index=df.index, dtype="Int64")
        alt_src = pd.Series(None, index=df.index, dtype=object)
        for i in df.index:
            r = df.loc[i]
            rec = r[col]
            w = webv.get((r.unique_id, col))
            if w is not None:
                new = int(w.verified_value)
                if pd.notna(rec) and int(rec) == new:
                    src[i] = f"record, confirmed by web check ({str(w.sources).split(' | ')[0]})"
                    df.at[i, chk] = "confirmed by web check"
                else:
                    df.at[i, col] = new
                    src[i] = f"web check: {str(w.sources).split(' | ')[0]} (record said {rec})"
                    df.at[i, chk] = "corrected from web check"
                    df.at[i, evc] = list(r[evc]) + [f"value replaced: record {rec} -> {new} (web check)"]
                    changes.append((col, r.unique_id, r["name"], rec, new, "web check"))
                continue
            if wdcol is None or pd.isna(r[wdcol]) or not isinstance(r.wd_qid, str):
                continue
            wv = int(r[wdcol])
            status = r[chk]
            if pd.isna(rec) and status in ("missing - other source has a year", "missing"):
                # nothing to contradict -> fill from the independent source
                df.at[i, col] = wv
                src[i] = f"Wikidata {r.wd_qid} (record had no value)"
                df.at[i, chk] = "filled from Wikidata"
                df.at[i, evc] = list(r[evc]) + [f"value filled: none -> {wv} (Wikidata {r.wd_qid})"]
                changes.append((col, r.unique_id, r["name"], rec, wv, f"Wikidata {r.wd_qid}"))
            elif status == "contradicted (Wikidata)":
                # web checks showed Wikidata is not always right (its 'inception' is sometimes a renaming/upgrade
                # date), so keep the record value and show Wikidata's value next to it
                alt[i] = wv; alt_src[i] = f"Wikidata {r.wd_qid}"
                df.at[i, chk] = "disputed: record vs Wikidata"
                disputes.append((col, r.unique_id, r["name"], rec, wv, f"Wikidata {r.wd_qid}"))
            elif status.startswith("confirmed") or status.startswith("close"):
                src[i] = f"record, {status} {r.wd_qid}"
        df[f"{col}_alt_value"] = alt
        df[f"{col}_alt_source"] = alt_src
        df[f"{col}_source"] = src
    df["yearEstablished"] = df["yearEstablished"].astype("Int64")
    df["capacity"] = df["capacity"].astype("Int64")
    df["size_band"] = df["capacity"].map(lambda v: _band(v, [(0, 30), (30, 100), (100, 500), (500, 1e12)],
                                                         ["small (<30 beds)", "medium (30-99 beds)", "large (100-499 beds)",
                                                          "very large / super-speciality scale (500+ beds)"]))
    df["doctor_band"] = df["numberDoctors"].map(lambda v: _band(v, [(0, 2), (2, 10), (10, 50), (50, 100), (100, 1e12)],
                                                                ["1 doctor", "2-9 doctors", "10-49 doctors", "50-99 doctors",
                                                                 "very large / super-speciality scale (100+ doctors)"]))
    ch = pd.DataFrame(changes, columns=["field", "unique_id", "name", "record_value", "new_value", "source"])
    df["reasons"] = [list(rs) + [f"{c.field} {'corrected' if pd.notna(c.record_value) else 'filled in'} from {c.source}: "
                                 f"{c.record_value if pd.notna(c.record_value) else 'none'} -> {c.new_value}"
                                 for c in ch[ch.unique_id == u].itertuples()]
                     for u, rs in zip(df.unique_id, df.reasons)]
    ch.to_csv(OUT / "value_corrections.csv", index=False)
    dp = pd.DataFrame(disputes, columns=["field", "unique_id", "name", "record_value", "other_value", "other_source"])
    dp.to_csv(OUT / "value_disputes.csv", index=False)
    S["value_disputes"] = dict(total=len(dp), by_field=dp.field.value_counts().to_dict())
    kinds = ch.assign(kind=np.where(ch.record_value.notna(), "replaced", "filled"),
                      src=np.where(ch.source.str.startswith("web"), "web", "Wikidata"))
    S["value_corrections"] = dict(total=len(ch), replaced=int(ch.record_value.notna().sum()), filled=int(ch.record_value.isna().sum()),
                                  by_type={" / ".join(k): int(n) for k, n in kinds.groupby(["field", "kind", "src"]).size().items()})
    return df


# ----------------------------------------------------------------------------- main
NEW_COLS = None


def main():
    base = pd.read_parquet(OUT / "fac_base_clean.parquet")   # always start from the cleaned (unverified) table
    keep = [c for c in base.columns if not c.startswith(("wd_", "pin_", "address_check", "address_evidence", "year_", "capacity_check",
                                                          "capacity_evidence", "doctors_check", "doctors_evidence", "recognition_",
                                                          "web_check", "beds_in_text", "doctors_in_text", "city_matches_pin",
                                                          "km_coords_to_pin", "state_norm", "pin6"))
            and not c.endswith("_source")]
    df = base[keep].copy()
    ref, canon = load_pin()
    wd = load_wikidata()
    tmp = df[["unique_id", "address_zipOrPostcode"]].copy()
    tmp["pin6"] = tmp.address_zipOrPostcode.fillna("").str.replace(r"\s", "", regex=True)
    tmp = tmp.join(ref[["pin_lat", "pin_lon"]], on="pin6")
    tmp = tmp.join(ref[["pin_district"]], on="pin6")
    df["pin_lat"], df["pin_lon"], df["pin_district"] = tmp.pin_lat.values, tmp.pin_lon.values, tmp.pin_district.values
    m = match_wikidata(df, wd, ref)
    df = df.drop(columns=["pin_lat", "pin_lon", "pin_district"]).merge(m, on="unique_id", how="left")
    df = address_checks(df, ref, canon)
    df = year_bed_doctor_checks(df)
    df = manual_checks(df)
    df = apply_verified_values(df)
    df = recognition(df)
    for c in ("year_check", "capacity_check", "doctors_check"):     # final status, after web checks and corrections
        S[c] = df[c].value_counts().to_dict()
    df = df.drop(columns=["pin_words"])
    df.to_parquet(OUT / "fac_base.parquet", index=False)
    m.to_csv(OUT / "wikidata_matches.csv", index=False)
    prev = df.head(200).copy()
    for c in prev.columns:
        if prev[c].map(lambda v: isinstance(v, (list, np.ndarray))).any():
            prev[c] = prev[c].map(lambda v: json.dumps(list(v), ensure_ascii=False, default=str) if isinstance(v, (list, np.ndarray)) else v)
    prev.to_csv(OUT / "fac_base_preview.csv", index=False)
    S["output_shape"] = list(df.shape)
    (OUT / "verification_stats.json").write_text(json.dumps(S, indent=2, default=str))
    print(json.dumps(S, indent=2, default=str)[:4000])


if __name__ == "__main__":
    main()
