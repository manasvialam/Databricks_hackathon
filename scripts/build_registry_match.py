"""
Match facilities_final.parquet to the PM-JAY empanelment list (hem_hospitals.csv, National Health Authority).

Output (scripts/out/):
  registry_match.parquet        one row per facility that has at least a 'possible' match
  registry_match_review.csv     ~100 pairs for hand labelling (fill the `label` column: correct / wrong / unsure)
  registry_match_summary.json   counts used by the app and the report

Tiers (see the plan, "Registry badge"):
  verified  name + place (same PIN or within 1.5 km), or phone + name + place. Only this tier may show a badge.
  possible  weaker signals. UI text only: "possible registry match, confirm by phone". Never a badge.
  none      no row.
Precision of 'verified' must be hand-checked (>= 95% on the review sample) before the badge ships.

Run:  python scripts/build_registry_match.py
"""
import collections
import difflib
import json
import re
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
FAC, HEM, OUT = ROOT / "facilities_final.parquet", ROOT / "hem_hospitals.csv", ROOT / "scripts" / "out"

STOP = set("hospital hospitals clinic clinics nursing home homes centre center multispeciality multi speciality super specialty "
           "speciality health care healthcare medical pvt ltd private limited the and of research institute institutes dr sri shri smt "
           "dispensary polyclinic maternity road near opp opposite".split())

# HEM empanelled specialty package -> our service ids (a package is the hospital's own application, not a capability audit)
SERVICE_MAP = {
    "obstetrics": ["Obstetrics and Gynaecology"],
    "c_section": ["Obstetrics and Gynaecology"],
    "nicu": ["Neo-natal care Packages"],
    "burn_care": ["Burns Management"],
    "trauma_emergency": ["Polytrauma", "Emergency Room Packages (Care requiring less than 12 hrs stay)"],
    "oncology": ["Medical Oncology", "Surgical Oncology", "Radiation Oncology"],
    "cardiac_surgery": ["Cardiovascular and Cardiac Surgery"],
    "cath_lab": ["Cardiology"],
}


def core(s):
    t = re.findall("[a-z0-9]+", str(s).lower())
    return [x for x in t if x not in STOP] or t


def name_sim(a, b):
    sa, sb = set(a), set(b)
    return max(len(sa & sb) / max(len(sa | sb), 1), difflib.SequenceMatcher(None, "".join(a), "".join(b)).ratio())


def p10(x):
    d = re.sub("[^0-9]", "", str(x))
    return d[-10:] if len(d) >= 10 else None


def hav(a, b, c, d):
    a, b, c, d = map(np.radians, (a, b, c, d))
    x = np.sin((c - a) / 2) ** 2 + np.cos(a) * np.cos(c) * np.sin((d - b) / 2) ** 2
    return 6371 * 2 * np.arcsin(np.sqrt(x))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cols = ["unique_id", "name", "display_name", "pin6", "geo_pin6", "best_lat", "best_lon", "phones_clean",
            "address_line1", "address_line2", "address_city"]
    f = pd.read_parquet(FAC, columns=cols)
    h = pd.read_csv(HEM, dtype=str, encoding="utf-8-sig", keep_default_na=False, na_values=["", "NA", "NULL", "null"])
    h["lat"] = pd.to_numeric(h.hospLatitude, errors="coerce")
    h["lon"] = pd.to_numeric(h.hospLongitude, errors="coerce")
    list_date = datetime.fromtimestamp(HEM.stat().st_mtime).strftime("%Y-%m-%d")

    f["nm"] = f.display_name.fillna(f.name).map(core)
    f["pin"] = f.pin6.fillna(f.geo_pin6)
    f["addr"] = (f.address_line1.fillna("") + " " + f.address_line2.fillna("") + " " + f.address_city.fillna("")).map(lambda s: set(core(s)))
    f["ph"] = f.phones_clean.map(lambda a: set(p for p in map(p10, a) if p) if a is not None else set())
    h["nm"] = h.hospName.map(core)
    h["addr"] = h.hospAddress.fillna("").map(lambda s: set(core(s)))
    h["phs"] = [set(p for p in (p10(a), p10(b)) if p and len(set(p)) > 2) for a, b in zip(h.hospMobileNumber, h.hospContactNumber)]

    # helpline numbers (shared by many rows in either list) are not evidence of identity
    cnt = collections.Counter(p for s in f.ph for p in s) + collections.Counter(p for s in h.phs for p in s)
    helpline = {p for p, c in cnt.items() if c > 3}
    f["ph"] = f.ph.map(lambda s: s - helpline)
    h["phs"] = h.phs.map(lambda s: s - helpline)

    by_pin = h.groupby("pincode").indices
    grid, pidx = collections.defaultdict(list), collections.defaultdict(list)
    cell = lambda a, b: (int(a * 50), int(b * 50))  # about 2 km
    for i, (a, b) in enumerate(zip(h.lat, h.lon)):
        if not (np.isnan(a) or np.isnan(b)):
            grid[cell(a, b)].append(i)
    for i, s in enumerate(h.phs):
        for p in s:
            pidx[p].append(i)

    rows = []
    for r in f.itertuples():
        cand = set(by_pin.get(r.pin, []))
        ok = not (np.isnan(r.best_lat) or np.isnan(r.best_lon))
        if ok:
            x, y = cell(r.best_lat, r.best_lon)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    cand.update(grid.get((x + dx, y + dy), []))
        for p in r.ph:
            cand.update(pidx.get(p, []))
        best = None
        for i in cand:
            ns = name_sim(r.nm, h.nm.iat[i])
            km = hav(r.best_lat, r.best_lon, h.lat.iat[i], h.lon.iat[i]) if ok else np.nan
            ph = bool(r.ph & h.phs.iat[i])
            sp = r.pin == h.pincode.iat[i]
            ao = len(r.addr & h.addr.iat[i]) / max(len(r.addr | h.addr.iat[i]), 1)
            sc = ns + 0.25 * ph + 0.10 * sp + (0.10 if km <= 1.5 else 0) + 0.10 * ao
            if best is None or sc > best[0]:
                best = (sc, i, ns, km, ph, sp, ao)
        if best is not None:
            rows.append((r.unique_id,) + best)
    m = pd.DataFrame(rows, columns=["unique_id", "score", "hi", "name_sim", "km", "phone", "same_pin", "addr_overlap"])
    place = m.same_pin | (m.km <= 1.5)
    name_place = (m.name_sim >= 0.85) & place
    phone_name = m.phone & (m.name_sim >= 0.6) & (m.same_pin | (m.km <= 5))
    verified = name_place | phone_name
    possible = ~verified & (((m.name_sim >= 0.7) & place) | (m.name_sim >= 0.8) | (m.phone & (m.name_sim >= 0.5)))
    m["tier"] = np.select([verified, possible], ["verified", "possible"], "none")
    m["method"] = np.select([name_place, phone_name], ["name+place", "phone+name"], "weak")
    m = m[m.tier != "none"].copy()

    # one HEM row can only be 'verified' for its best-scoring facility
    m = m.sort_values("score", ascending=False)
    dup = m.duplicated("hi", keep="first") & (m.tier == "verified")
    m.loc[dup, "tier"] = "possible"
    m.loc[dup, "method"] = m.loc[dup, "method"] + "+shared"

    H = h.iloc[m.hi.values].reset_index(drop=True)
    m = m.reset_index(drop=True)
    specs = H.specialityNames.fillna("").map(lambda s: [x.strip() for x in s.split("|") if x.strip()])
    out = pd.DataFrame({
        "unique_id": m.unique_id, "tier": m.tier, "method": m.method,
        "name_sim": m.name_sim.round(3), "km": m.km.round(2), "same_pin": m.same_pin, "phone_match": m.phone, "addr_overlap": m.addr_overlap.round(2),
        "hem_facility_id": H.facilityId, "hfr_id": H.hfrId, "hem_name": H.hospName, "hem_type": H.type,
        "ownership": H.hospTypeCode.map({"G": "government", "P": "private"}),
        "nabh": H.is_nabh_accredited.eq("1"), "trauma_burn": H.is_trauma_burn_care.eq("1"),
        "suspended": (H.is_suspended.eq("1") | H.is_de_empanelled.eq("1") | H.is_blacklisted.eq("1")),
        "empanelled_date": H.empaneledDate.str[:10], "hem_specialties": specs,
    })
    out["registry_services"] = specs.map(lambda l: [s for s, names in SERVICE_MAP.items() if set(names) & set(l)])
    out.loc[out.hem_type.eq("Standalone Dialysis Centre"), "registry_services"] = out.loc[out.hem_type.eq("Standalone Dialysis Centre"), "registry_services"].map(lambda l: l + ["dialysis"])
    out["badge_eligible"] = out.tier.eq("verified") & ~out.suspended
    out["list_as_of"] = list_date
    out.to_parquet(OUT / "registry_match.parquet", index=False)

    # hand-labelling sample: verified, possible, plus a few rows right at the verified threshold
    rng = np.random.default_rng(7)
    ff = f.set_index("unique_id")
    parts = []
    for tier, n in (("verified", 45), ("possible", 55)):
        s = out[out.tier == tier]
        parts.append(s.iloc[rng.choice(len(s), min(n, len(s)), replace=False)])
    rev = pd.concat(parts)
    rev.insert(1, "our_name", rev.unique_id.map(ff.display_name.fillna(ff.name)))
    rev.insert(2, "our_city", rev.unique_id.map(ff.address_city))
    rev.insert(3, "our_pin", rev.unique_id.map(ff.pin))
    rev["hem_address"] = H.set_index(out.unique_id).hospAddress.reindex(rev.unique_id).values
    rev["hem_pin"] = H.set_index(out.unique_id).pincode.reindex(rev.unique_id).values
    rev["label"] = ""
    rev[["unique_id", "tier", "method", "our_name", "our_city", "our_pin", "hem_name", "hem_address", "hem_pin", "km", "name_sim", "label"]].to_csv(OUT / "registry_match_review.csv", index=False)

    summary = {
        "facilities": int(len(f)), "hem_rows": int(len(h)), "list_as_of": list_date,
        "verified": int((out.tier == "verified").sum()), "possible": int((out.tier == "possible").sum()),
        "badge_eligible": int(out.badge_eligible.sum()), "helpline_numbers_ignored": len(helpline),
        "verified_state_note": "state agreement is checked in the notebook; precision needs the hand-labelled review sample",
        "hem_not_matched_verified": int(len(h) - out[out.tier == "verified"].hem_facility_id.nunique()),
    }
    (OUT / "registry_match_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    print(out.groupby(["tier", "method"]).size())


if __name__ == "__main__":
    main()
