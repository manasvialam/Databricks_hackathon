"""
Export the slim JSON snapshot the Next.js app serves from (and falls back to when the warehouse is unavailable).

Reads  facilities_final.parquet, scripts/out/registry_match.parquet (run build_registry_match.py first)
Writes web/data/facilities.snapshot.json   one record per facility (claims, evidence snippets, citations, trust, registry)
       web/data/districts.snapshot.json    district context (NFHS values, density, coverage message)
       web/data/snapshot.meta.json         counts, build date, registry list date

Run:  python scripts/export_snapshot.py
"""
import json
import math
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
FAC = ROOT / "facilities_final.parquet"
REG = ROOT / "scripts" / "out" / "registry_match.parquet"
OUT = ROOT / "web" / "data"

SIZE = {"small (<30 beds)": "small", "medium (30-99 beds)": "medium", "large (100-499 beds)": "large",
        "very large / super-speciality scale (500+ beds)": "xlarge", "unknown": None}
URL_RANK = {"gov": 0, "own_site": 1, "health_directory": 2, "general_directory": 3, "other": 4, "business_b2b": 5}

# district context shown as one-line notes in results (never used to score a facility or a person)
NFHS = {
    "inst_birth": "nfhs_institutional_birth_5y_pct",
    "csection": "nfhs_births_delivered_by_csection_5y_pct",
    "oop_public_delivery": "nfhs_average_out_of_pocket_expenditure_per_delivery_in_a_public_fac",
    "insurance": "nfhs_hh_member_covered_health_insurance_pct",
    "anaemia_pregnant": "nfhs_pregnant_w15_49_who_are_anaemic_lt_11_0_g_dl_22_pct",
    "high_bp_women": "nfhs_w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct",
    "high_sugar_women": "nfhs_w15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct",
    "stunted": "nfhs_child_u5_who_are_stunted_height_for_age_18_pct",
    "tobacco_men": "nfhs_m15_plus_who_use_any_kind_of_tobacco_pct",
}


def nz(x, nd=None):
    """None for NaN/None, python scalars otherwise."""
    if x is None:
        return None
    if isinstance(x, (float, np.floating)):
        if math.isnan(x):
            return None
        return round(float(x), nd) if nd is not None else float(x)
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.bool_,)):
        return bool(x)
    return x


def as_list(a):
    return [] if a is None else [str(x) for x in list(a)]


def claim_out(c, keep_detail):
    urls = sorted(c["cite_urls"] if c["cite_urls"] is not None else [], key=lambda u: (not u["names_facility_in_url"], URL_RANK.get(u["source_class"], 9)))
    snippets = [s for s in (c["snippets"] if c["snippets"] is not None else []) if s["category"] == "evidence"]
    return {
        "s": c["service"], "l": c["level"], "st": nz(c["claim_strength"], 2), "nf": int(c["n_fields"]),
        "f": as_list(c["fields"]), "sp": bool(c["specificity"]), "pm": bool(c["prerequisites_met"]),
        "ct": as_list(c["contradictions"]), "cr": as_list(c["claim_reasons"])[:2],
        "sn": [{"x": str(s["text"])[:240], "f": s["field"]} for s in snippets[: (3 if keep_detail else 1)]],
        "u": [{"u": u["url"], "c": u["source_class"], "n": bool(u["names_facility_in_url"])} for u in urls[: (2 if keep_detail else 1)]],
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    f = pd.read_parquet(FAC)
    reg = pd.read_parquet(REG).set_index("unique_id") if REG.exists() else pd.DataFrame()
    list_as_of = reg.list_as_of.iloc[0] if len(reg) else None
    recs = []
    for r in f.itertuples(index=False):
        if r.best_lat is None or (isinstance(r.best_lat, float) and math.isnan(r.best_lat)):
            continue
        claims = [claim_out(c, c["level"] != "Weak") for c in (r.claims if r.claims is not None else [])]
        rs = []
        for key, src in (("loc", r.geo_reasons), ("contact", r.contact_reasons), ("data", r.base_reasons), ("claims", r.p4_reasons)):
            for t in as_list(src)[:3]:
                rs.append({"k": key, "t": t})
        rg = None
        if r.unique_id in reg.index:
            m = reg.loc[r.unique_id]
            rg = {"t": m.tier, "m": m.method, "hfr": nz(m.hfr_id), "own": nz(m.ownership), "nabh": bool(m.nabh), "tb": bool(m.trauma_burn),
                  "sus": bool(m.suspended), "badge": bool(m.badge_eligible), "svc": as_list(m.registry_services),
                  "sp": as_list(m.hem_specialties)[:12], "dt": nz(m.empanelled_date), "ns": nz(m.name_sim, 2), "km": nz(m.km, 1)}
        recs.append({
            "id": r.unique_id, "nm": r.display_name or r.name, "ty": nz(r.facilityTypeId), "op": nz(r.operatorTypeId),
            "sz": SIZE.get(r.size_band), "ci": nz(r.address_city), "st": nz(r.state_final), "di": nz(r.district_final), "dk": (f"{r.district_state}|{r.district_final_key}" if nz(r.district_final_key) and nz(r.district_state) else None),
            "la": round(float(r.best_lat), 5), "lo": round(float(r.best_lon), 5), "lp": nz(r.location_precision), "lt": nz(r.location_trust),
            "ls": nz(r.location_trust_score, 2), "ft": nz(r.facility_trust), "ms": nz(r.merge_suspect_score), "h24": bool(r.is_24x7),
            "ph": as_list(r.phones_display)[:2], "ws": nz(r.official_website) if r.own_domain else None,
            "rt": None if r.recognition_tier == "no evidence found" else nz(r.recognition_tier), "wd": bool(r.wd_qid) if r.wd_qid is not None else False,
            "gv": bool(r.gov_source) if r.gov_source is not None else False, "pri": bool(r.is_primary), "ne": nz(r.n_equipment), "nsp": nz(r.n_specialties),
            "cl": claims, "rs": rs, "rg": rg,
        })
    (OUT / "facilities.snapshot.json").write_text(json.dumps(recs, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    d = f.drop_duplicates(["district_state", "district_final_key"]).dropna(subset=["district_final_key", "district_state"])
    dist = {}
    for r in d.to_dict("records"):
        dist[f'{r["district_state"]}|{r["district_final_key"]}'] = {
            "name": r["district_final"], "state": r["district_state"], "n": nz(r["district_n_facilities"]), "density": nz(r["district_data_density"]),
            "msg": nz(r["district_coverage_message"]) or None, "nfhs": {k: nz(r.get(col), 1) for k, col in NFHS.items() if nz(r.get(col)) is not None},
        }
    (OUT / "districts.snapshot.json").write_text(json.dumps(dist, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    meta = {"built": date.today().isoformat(), "facilities": len(recs), "districts": len(dist), "registry_list_as_of": list_as_of,
            "registry_verified": int(sum(1 for x in recs if x["rg"] and x["rg"]["t"] == "verified")),
            "registry_possible": int(sum(1 for x in recs if x["rg"] and x["rg"]["t"] == "possible")),
            "claims": int(sum(len(x["cl"]) for x in recs))}
    (OUT / "snapshot.meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps(meta, indent=2))
    for p in sorted(OUT.glob("*.json")):
        print(f"{p.name:28s} {p.stat().st_size / 1e6:6.2f} MB")


if __name__ == "__main__":
    main()
