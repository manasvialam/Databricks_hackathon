"""Add `sc` (plain-language specialty categories) to web/data/facilities.snapshot.json.

The raw facilities file lists each hospital's specialties as identifiers such as `orthopedicSurgery` or `cardiology`.
The app only carried 15 service claims, so a need like "leg pain" or "fever" had nothing to match on. This maps the raw
identifiers onto ~19 categories (ids shared with web/lib/specialty.ts) and stores them per facility, most-listed first.

Usage (needs the real raw file, not the Git LFS pointer):
    python scripts/add_specialties.py path/to/facilities.csv [web/data/facilities.snapshot.json]
Safe to re-run. Run it after scripts/export_snapshot.py, because that script rewrites the snapshot without `sc`.
"""
import collections, json, re, sys
import pandas as pd

# category id -> regex over the raw identifier (case-insensitive). A raw specialty can fall in several categories.
RULES = {
    "general":   r"^(internalMedicine|familyMedicine|generalPractice|geriatric|infectiousDiseases|preventiveMedicine|occupationalMedicine)",
    "dental":    r"(dentistry|dontics|dontia|oralAnd|prosthodontics|periodontics)",
    "women":     r"(gynecolog|obstetric|maternal|reproductiveEndocrinology|infertility|perinatolog)",
    "eye":       r"(ophthalm|cataract|retina|glaucoma|cornea|refractive|oculoplastic|strabismus)",
    "bones":     r"(orthop|jointReconstruction|sportsMedicine|physicalMedicineAndRehabilitation|rheumatolog|spine|handSurgery|footAnd)",
    "child":     r"(pediatric|paediatric|neonatolog)",
    "heart":     r"(cardio|vascularSurgery|cardiac|electrophysiology)",
    "surgery":   r"(generalSurgery|colorectal|transplant|plasticSurgery|bariatric|laparoscop|thoracic|surgicalOncology)",
    "ent":       r"(otolaryng|^ent$|audiolog)",
    "skin":      r"(dermatolog|trichology|cosmeticDermatology)",
    "urology":   r"(urolog|nephrolog|andrology)",
    "stomach":   r"(gastro|hepatolog|proctolog)",
    "brain":     r"(neurolog|neurosurg|spineNeurosurgery|epilep|stroke)",
    "chest":     r"(pulmonolog|respiratory|sleepMedicine|thoracic)",
    "mental":    r"(psychiatr|psycholog|addiction)",
    "cancer":    r"(oncolog|radiationTherapy|hematologyOncology)",
    "diabetes":  r"(endocrinolog|diabet|thyroid)",
    "emergency": r"(emergencyMedicine|criticalCare|traumaSurgery|intensive)",
    "tests":     r"(radiolog|patholog|nuclearMedicine|laborator|imaging)",
}
RX = {k: re.compile(v, re.I) for k, v in RULES.items()}

def categories(raw_list):
    n = collections.Counter()
    for s in raw_list:
        for k, rx in RX.items():
            if rx.search(str(s)): n[k] += 1
    return [k for k, _ in n.most_common()]

def main():
    raw_path = sys.argv[1]
    snap_path = sys.argv[2] if len(sys.argv) > 2 else "web/data/facilities.snapshot.json"
    d = pd.read_csv(raw_path, escapechar="\\", on_bad_lines="skip", engine="python")
    by_id = {}
    for uid, v in zip(d["unique_id"], d["specialties"]):
        try:
            lst = json.loads(v) if isinstance(v, str) else []
        except Exception:
            lst = []
        if isinstance(lst, list) and lst:
            by_id.setdefault(str(uid), []).extend(lst)
    snap = json.load(open(snap_path))
    have = 0
    for f in snap:
        sc = categories(by_id.get(f["id"], []))
        f["sc"] = sc
        have += bool(sc)
    json.dump(snap, open(snap_path, "w"), separators=(",", ":"), ensure_ascii=False)
    print(f"{len(snap)} facilities, {have} with specialty categories ({have/len(snap):.0%})")
    c = collections.Counter(k for f in snap for k in f["sc"])
    print(dict(c.most_common()))

if __name__ == "__main__":
    main()
