"""
Person 1 – Base table builder
=============================
Implements the Person 1 section of RED_FLAGS_AND_VALIDATION.md.

Inputs  (Person_1/dataset/):
    facilities.csv, nfhs_5_district_health_indicators.csv, india_post_pincode_directory.csv
Outputs (Person_1/output/):
    fac_base.parquet            one row per facility, cleaned + flags + raw_* originals + reasons
    fac_base_preview.csv        first 200 rows (lists as JSON) for eyeballing
    facilities_quarantine.csv   the fragment rows (text pieces of broken records)
    nfhs_clean.parquet / .csv   NFHS-5 parsed, with low-reliability flags and join keys
    data_quality_report.md      every step with counts (generated from this run)
    run_stats.json              the same numbers, machine-readable

Run:  python Person_1/build_fac_base.py
On Databricks: upload the parquet files and `spark.read.parquet(...).write.saveAsTable("fac_base")`.
"""
import csv, json, re, sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
DATA = HERE / "dataset"
OUT = HERE / "output"
OUT.mkdir(exist_ok=True)

UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
LIST_COLS = ["source_types", "source_ids", "phone_numbers", "websites", "affiliationTypeIds",
             "specialties", "procedure", "equipment", "capability", "source_urls"]
EVIDENCE_LISTS = ["specialties", "procedure", "equipment", "capability"]
INT_COLS = ["yearEstablished", "numberDoctors", "capacity", "distinct_social_media_presence_count",
            "number_of_facts_about_the_organization", "post_metrics_post_count",
            "engagement_metrics_n_followers", "engagement_metrics_n_likes", "engagement_metrics_n_engagements"]
FLOAT_COLS = ["latitude", "longitude", "area"]
DATE_COLS = ["recency_of_page_update", "post_metrics_most_recent_social_media_post_date"]
BOOL_COLS = ["acceptsVolunteers", "affiliated_staff_presence", "custom_logo_presence"]
DEAD_COLS = ["countries", "acceptsVolunteers", "area", "organization_type", "address_country",
             "address_countryCode", "source", "content_table_id", "coordinates"]
LOW_INFO_SPECIALTIES = {"internalMedicine"}
CURRENT_YEAR = 2026

S = {}        # run statistics -> report
NOTES = []    # things found while building that the team should know


def stat(key, value):
    S[key] = value
    return value


# ---------------------------------------------------------------------------
# STEP 1  Load (A1)
# ---------------------------------------------------------------------------
def load_raw():
    path = DATA / "facilities.csv"
    head = path.read_text(encoding="utf-8")[:200]
    if head.startswith("version https://git-lfs"):
        sys.exit("facilities.csv is a Git LFS pointer, not data. Run `git lfs pull` or see the report.")
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")
    stat("raw_physical_lines", len(lines) - (1 if lines[-1] == "" else 0))
    stat("raw_escaped_quotes", text.count('\\"'))
    stat("raw_doubled_quotes", text.count('""'))
    try:
        pd.read_csv(path, low_memory=False)
        stat("naive_read_csv", "succeeded")
    except Exception as e:  # noqa: BLE001
        stat("naive_read_csv", f"fails: {type(e).__name__}: {str(e)[:90]}")
    raw = pd.read_csv(path, escapechar="\\", dtype=str, keep_default_na=False)
    stat("raw_rows_parsed", len(raw))
    # one physical line per parsed row (header is line 0) -> verify so we can use raw lines for repair
    assert len(raw) == S["raw_physical_lines"] - 1
    return raw, lines[1:]


# ---------------------------------------------------------------------------
# STEP 2  Split real records vs fragments (A2) and repair truncated records (A3)
# ---------------------------------------------------------------------------
def _parse_line(line, double_quote=False):
    if double_quote:
        return next(csv.reader([line]))
    return next(csv.reader([line], escapechar="\\", doublequote=False))


def _is_list(s):
    try:
        return isinstance(json.loads(s), list)
    except Exception:  # noqa: BLE001
        return False


def _valid_post(post, post_cols):
    """The 23 post-description fields must look right before we accept a split."""
    try:
        d = dict(zip(post_cols, post))
        float(d["latitude"]); float(d["longitude"])
        return bool(d["cluster_id"]) and _is_list(d["specialties"]) and _is_list(d["source_urls"])
    except Exception:  # noqa: BLE001
        return False


def _merge_split_lists(fields):
    """Last resort for tails whose JSON lists were split into one field per item (quotes lost).
    Re-join pieces from a field starting with '[' to the field ending with ']' into one JSON list."""
    out, i, changed = [], 0, False
    while i < len(fields):
        f = fields[i]
        if f.startswith("[") and not _is_list(f):
            pieces = [f]
            while not pieces[-1].rstrip().rstrip('"').endswith("]") and i + 1 < len(fields):
                i += 1
                pieces.append(fields[i])
            items = [p.strip().strip('"').lstrip("[").rstrip("]").strip('"').strip() for p in pieces]
            out.append(json.dumps([x for x in items if x and x != "null"], ensure_ascii=False))
            changed = True
        elif f.startswith("{") and not f.rstrip().endswith("}"):
            pieces = [f]
            while not pieces[-1].rstrip().endswith("}") and i + 1 < len(fields):
                i += 1
                pieces.append(fields[i])
            out.append(",".join(pieces))       # GeoJSON; dead column, rebuilt from lat/lon anyway
            changed = True
        else:
            out.append(f)
        i += 1
    return out, changed


def _decode_tail(final_line, post_cols):
    """Return (method, description_tail, post_fields) from the last fragment line, or None.
    Some tails are escaped once (normal CSV with \\"), some were escaped twice; try both."""
    n_post = len(post_cols)
    # The description's opening quote is on the record's first line; its closing quote is in this
    # last line. Re-adding the opening quote ('"' + line) makes the line valid CSV again.
    candidates = []
    for p1 in ('"', ""):                       # first pass: CSV with backslash escapes
        try:
            first = _parse_line(p1 + final_line)
        except Exception:  # noqa: BLE001
            continue
        candidates.append((f"pass1{'+quote' if p1 else ''}", first))
        joined = ",".join(first).rstrip(",")
        for p2 in ('"', ""):                   # second pass: tail that was re-quoted (doubled quotes)
            try:
                candidates.append((f"pass1{'+quote' if p1 else ''}, pass2{'+quote' if p2 else ''}",
                                   _parse_line(p2 + joined, double_quote=True)))
            except Exception:  # noqa: BLE001
                pass
    for label, fields in list(candidates):
        merged, changed = _merge_split_lists(fields)
        if changed:
            candidates.append((label + ", lists re-joined", merged))
    for label, fields in candidates:
        for k in range(3, len(fields)):
            if not _is_list(fields[k]):
                continue
            post = fields[k - 3:k - 3 + n_post]
            post += [""] * (n_post - len(post))
            if _valid_post(post, post_cols):
                tail = ",".join(fields[:k - 3]).strip().strip('"').strip()
                return label, tail, post
    return None


def split_and_repair(raw, lines):
    cols = list(raw.columns)
    post_cols = cols[cols.index("description") + 1:]
    stat("n_post_description_cols", len(post_cols))
    is_rec = raw["unique_id"].str.fullmatch(UUID.pattern)
    stat("real_record_rows", int(is_rec.sum()))
    stat("fragment_rows", int((~is_rec).sum()))

    owner, cur = {}, None
    for i in raw.index:
        if is_rec[i]:
            cur = i
        else:
            owner[i] = cur
    owner = pd.Series(owner, dtype="Int64")
    truncated = [i for i in raw.index[is_rec] if (raw.loc[i, post_cols] == "").all()]
    stat("truncated_records", len(truncated))
    stat("fragments_belonging_to_truncated", int(owner.isin(truncated).sum()))

    raw = raw.copy()
    raw["repair_method"] = ""
    repaired, failed = [], []
    for i in truncated:
        frags = owner[owner == i].index.tolist()
        middle = [lines[j].rstrip(",").replace('\\"', '"') for j in frags[:-1]]
        res = _decode_tail(lines[frags[-1]], post_cols)
        if res is None:
            failed.append(raw.loc[i, "name"])
            continue
        label, tail, post = res
        desc = "\n".join([raw.loc[i, "description"]] + middle + ([tail] if tail else []))
        raw.loc[i, "raw_description_truncated"] = raw.loc[i, "description"]
        raw.loc[i, "description"] = desc
        d = dict(zip(post_cols, post))
        try:
            json.loads(d["coordinates"])
        except Exception:  # noqa: BLE001  rebuild the redundant GeoJSON from lat/lon
            post[post_cols.index("coordinates")] = json.dumps(
                {"coordinates": [float(d["longitude"]), float(d["latitude"])], "type": "Point"})
        raw.loc[i, post_cols] = post
        raw.loc[i, "repair_method"] = label
        repaired.append(raw.loc[i, "unique_id"])
    stat("truncated_repaired", len(repaired))
    stat("truncated_repair_failed", failed)
    stat("repair_methods", Counter(raw.loc[raw.repair_method != "", "repair_method"]).most_common())

    quarantine = raw.loc[~is_rec, cols].copy()
    quarantine.insert(0, "attached_to_unique_id", raw.loc[owner.reindex(quarantine.index).astype(int), "unique_id"].values)
    quarantine.insert(1, "attached_to_name", raw.loc[owner.reindex(quarantine.index).astype(int), "name"].values)
    quarantine.insert(2, "used_in_repair", quarantine["attached_to_unique_id"].isin(repaired))
    quarantine.insert(3, "source_line_number", quarantine.index + 2)   # +1 header, +1 one-based
    recs = raw.loc[is_rec].copy()
    recs["flag_repaired_record"] = recs["unique_id"].isin(repaired)
    return recs, quarantine


# ---------------------------------------------------------------------------
# STEP 3  Exact duplicates (A4)
# ---------------------------------------------------------------------------
def drop_exact_duplicates(recs):
    base_cols = [c for c in recs.columns if c not in ("repair_method", "raw_description_truncated", "flag_repaired_record")]
    dup_ids = recs.loc[recs["unique_id"].duplicated(keep=False), "unique_id"]
    stat("duplicate_unique_ids", int(dup_ids.nunique()))
    stat("duplicate_rows_identical", bool(recs.loc[dup_ids.index, base_cols].drop_duplicates().shape[0] == dup_ids.nunique()))
    stat("duplicate_names", sorted(recs.loc[dup_ids.index, "name"].unique().tolist()))
    before = len(recs)
    recs = recs.drop_duplicates(subset=base_cols).reset_index(drop=True)
    stat("rows_dropped_as_duplicates", before - len(recs))
    stat("facilities_final", len(recs))
    assert recs["unique_id"].is_unique
    return recs


# ---------------------------------------------------------------------------
# STEP 4  Missing values (A5) and list cleaning (G2, G4)
# ---------------------------------------------------------------------------
def normalise_missing(df):
    tokens = {"empty string": (df == "").sum(), "'null'": (df == "null").sum(), "'NULL'": (df == "NULL").sum()}
    stat("missing_tokens_total", {k: int(v.sum()) for k, v in tokens.items()})
    df = df.replace({"": np.nan, "null": np.nan, "NULL": np.nan})
    return df


def clean_lists(df):
    rows = []
    for c in LIST_COLS:
        df[f"raw_{c}"] = df[c]
        parsed = df[c].map(lambda x: json.loads(x) if isinstance(x, str) else None)
        bad = int(df[c].notna().sum() - parsed.notna().sum())
        raw_len = parsed.map(lambda l: len(l) if isinstance(l, list) else 0)
        n_items = int(raw_len.sum())
        n_blank = int(parsed.map(lambda l: sum(1 for x in l if str(x).strip() == "") if isinstance(l, list) else 0).sum())

        def clean(l):
            if not isinstance(l, list):
                return None
            seen, out = set(), []
            for x in l:
                s = re.sub(r"\s+", " ", str(x)).strip()
                if s and s not in seen:
                    seen.add(s); out.append(s)
            return out or None

        cleaned = parsed.map(clean)
        n_after = int(cleaned.map(lambda l: len(l) if l else 0).sum())
        was_list = parsed.notna()
        became_missing = int((was_list & cleaned.isna()).sum())
        df[c] = cleaned
        df[f"n_{c}"] = cleaned.map(lambda l: len(l) if l else 0).astype("int16")
        if c in EVIDENCE_LISTS or c in ("source_urls", "phone_numbers", "websites"):
            df[f"rawlen_{c}"] = raw_len.astype("int16")
        rows.append(dict(column=c, json_parse_failures=bad, items_before=n_items, blank_items=n_blank,
                         items_after=n_after, removed=n_items - n_after,
                         lists_at_50_cap=int((raw_len == 50).sum()),
                         facilities_now_missing=int(cleaned.isna().sum()),
                         empty_or_blank_only_lists_to_missing=became_missing))
    stat("list_cleaning", rows)
    # list cap: computed on RAW lengths, because de-duplication hides the cap
    df["flag_list_truncated"] = (df[[f"rawlen_{c}" for c in EVIDENCE_LISTS]] == 50).any(axis=1)
    stat("flag_list_truncated", int(df["flag_list_truncated"].sum()))
    return df


# ---------------------------------------------------------------------------
# STEP 5  Dead / redundant columns (A6), types, categories (A7)
# ---------------------------------------------------------------------------
def verify_and_move_dead_columns(df):
    checks = {}
    for c in DEAD_COLS:
        s = df[c]
        checks[c] = {"non_null": int(s.notna().sum()), "distinct_values": int(s.nunique())}
    lat = pd.to_numeric(df["latitude"], errors="coerce"); lon = pd.to_numeric(df["longitude"], errors="coerce")
    g = df["coordinates"].dropna().map(json.loads)
    same = np.allclose(g.map(lambda d: d["coordinates"][1]), lat[g.index]) and \
        np.allclose(g.map(lambda d: d["coordinates"][0]), lon[g.index])
    checks["coordinates"]["equals_latitude_longitude"] = bool(same)
    checks["content_table_id"]["equals_source_content_id_pct"] = round(
        float((df["content_table_id"] == df["source_content_id"]).mean() * 100), 2)
    for c in ["organization_type", "address_country", "address_countryCode", "source"]:
        checks[c]["values"] = df[c].value_counts(dropna=False).to_dict()
    stat("dead_columns", checks)
    df = df.rename(columns={c: f"raw_{c}" for c in DEAD_COLS})
    return df


def set_types(df):
    conv = {}
    for c in INT_COLS:
        x = pd.to_numeric(df[c], errors="coerce")
        conv[c] = int((df[c].notna() & x.isna()).sum())
        frac = x.dropna() % 1
        assert (frac == 0).all(), c
        df[c] = x.astype("Int64")
    for c in ["latitude", "longitude"]:
        x = pd.to_numeric(df[c], errors="coerce")
        conv[c] = int((df[c].notna() & x.isna()).sum())
        df[c] = x
    df["raw_area"] = pd.to_numeric(df["raw_area"], errors="coerce")
    unparsed_dates = {}
    for c in DATE_COLS:
        df[f"raw_{c}"] = df[c]
        # strict ISO only: "October 20" / "2 months ago" have no reliable year -> leave missing, keep raw text
        x = pd.to_datetime(df[c].where(df[c].str.fullmatch(r"\d{4}-\d{2}-\d{2}", na=False)), errors="coerce", format="%Y-%m-%d")
        bad = df[c].notna() & x.isna()
        conv[c] = int(bad.sum())
        unparsed_dates[c] = sorted(df.loc[bad, c].unique().tolist())
        df[c] = x
    stat("unparsed_date_values", unparsed_dates)
    for c in ["affiliated_staff_presence", "custom_logo_presence"]:
        df[c] = df[c].map({"true": True, "false": False}).astype("boolean")
    df["raw_acceptsVolunteers"] = df["raw_acceptsVolunteers"].map({"true": True, "false": False}).astype("boolean")
    stat("type_conversion_failures", conv)
    return df


def fix_categories(df):
    df["raw_facilityTypeId"] = df["facilityTypeId"]
    df["raw_operatorTypeId"] = df["operatorTypeId"]
    stat("facilityTypeId_before", df["facilityTypeId"].fillna("<missing>").value_counts().to_dict())
    stat("operatorTypeId_before", df["operatorTypeId"].fillna("<missing>").value_counts().to_dict())
    df["facilityTypeId"] = df["facilityTypeId"].replace({"farmacy": "pharmacy"})
    df["operatorTypeId"] = df["operatorTypeId"].replace({"government": "public"})
    stat("facilityTypeId_after", df["facilityTypeId"].fillna("<missing>").value_counts().to_dict())
    stat("operatorTypeId_after", df["operatorTypeId"].fillna("<missing>").value_counts().to_dict())
    return df


# ---------------------------------------------------------------------------
# STEP 6  Specialties (G5, G6)
# ---------------------------------------------------------------------------
def normalise_specialties(df):
    key = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
    fac_count = Counter(s for l in df["specialties"].dropna() for s in set(l))
    code_like = re.compile(r"[a-z][A-Za-z0-9]*")            # camelCase incl. acronyms (painMedicinePMR)
    by_key = defaultdict(list)
    for s, n in fac_count.items():
        by_key[key(s)].append((s, n))
    canon = {}
    for k, variants in by_key.items():
        # prefer code-like spelling, then most frequent
        best = sorted(variants, key=lambda v: (not code_like.fullmatch(v[0]), -v[1]))[0][0]
        for s, _ in variants:
            canon[s] = best
    changed = {s: c for s, c in canon.items() if s != c}

    def norm(l):
        if not l:
            return None
        out = []
        for s in l:
            c = canon.get(s, s)
            if c not in out:
                out.append(c)
        return out

    df["specialties"] = df["specialties"].map(norm)
    df["n_specialties"] = df["specialties"].map(lambda l: len(l) if l else 0).astype("int16")
    after = Counter(s for l in df["specialties"].dropna() for s in l)
    df["specialties_informative"] = df["specialties"].map(
        lambda l: [s for s in l if s not in LOW_INFO_SPECIALTIES] or None if l else None)
    singles = {s for s, n in after.items() if n == 1}
    df["specialties_rare"] = df["specialties"].map(lambda l: [s for s in l if s in singles] or None if l else None)
    stat("specialties", dict(
        distinct_before=len(fac_count), distinct_after=len(after),
        spellings_merged=len(changed), facility_mentions_changed=int(sum(fac_count[s] for s in changed)),
        code_like_after=sum(1 for s in after if code_like.fullmatch(s)),
        not_code_like_after=sum(1 for s in after if not code_like.fullmatch(s)),
        used_by_one_facility_after=len(singles),
        internalMedicine_share_pct=round(after["internalMedicine"] / len(df) * 100, 1),
        examples_merged=sorted(changed.items(), key=lambda kv: -fac_count[kv[0]])[:12],
        examples_rare_kept=sorted(singles)[:15],
        top_not_code_like=[(s, after[s]) for s in sorted((s for s in after if not code_like.fullmatch(s)),
                                                          key=lambda s: -after[s])[:10]],
    ))
    return df


# ---------------------------------------------------------------------------
# STEP 7  Numbers (F1–F7)
# ---------------------------------------------------------------------------
def numeric_sanity(df):
    """Team decision (21 Nov): do NOT delete large doctor/bed counts or old founding years.
    Keep them, put them in a top 'very large / super-speciality scale' band, flag extremes for
    verification (see verify_external.py). Only values that cannot be real are cleared:
    0 doctors / 0 beds (= unknown) and 'years' below 1500 (0, 7, 15)."""
    small_types = df["facilityTypeId"].isin(["clinic", "dentist", "doctor", "pharmacy"])
    for c in ["numberDoctors", "capacity", "yearEstablished"]:
        df[f"raw_{c}"] = df[c]
    rep = {}

    d = df["numberDoctors"]
    m_zero = d == 0
    df.loc[m_zero.fillna(False), "numberDoctors"] = pd.NA
    d = df["numberDoctors"]
    df["flag_doctors_extreme"] = (d > 1000).fillna(False).astype(bool)
    df["flag_doctors_high_for_type"] = (small_types & (d > 50)).fillna(False).astype(bool)
    rep["numberDoctors"] = dict(present=int(df["raw_numberDoctors"].notna().sum()), zero_to_missing=int(m_zero.sum()),
                                over_1000_kept_flagged=int(df["flag_doctors_extreme"].sum()),
                                over_1000_rows=df.loc[df["flag_doctors_extreme"], ["name", "address_city", "facilityTypeId", "numberDoctors"]]
                                .astype(str).values.tolist(),
                                small_type_over_50_flagged=int(df["flag_doctors_high_for_type"].sum()))

    b = df["capacity"]
    m_zero = b == 0
    df.loc[m_zero.fillna(False), "capacity"] = pd.NA
    b = df["capacity"]
    df["flag_capacity_extreme"] = (b > 3000).fillna(False).astype(bool)
    df["flag_beds_high_for_type"] = (small_types & (b > 200)).fillna(False).astype(bool)
    rep["capacity"] = dict(present=int(df["raw_capacity"].notna().sum()), zero_to_missing=int(m_zero.sum()),
                           over_3000_kept_flagged=int(df["flag_capacity_extreme"].sum()),
                           over_3000_rows=df.loc[df["flag_capacity_extreme"], ["name", "address_city", "capacity"]].astype(str).values.tolist(),
                           small_type_over_200_flagged=int(df["flag_beds_high_for_type"].sum()))

    y = df["yearEstablished"]
    m_bad = (y < 1500) | (y > CURRENT_YEAR)
    m_old = (y >= 1500) & (y < 1800)
    rep["yearEstablished"] = dict(present=int(y.notna().sum()), not_a_year_to_missing=int(m_bad.sum()),
                                  not_a_year_rows=df.loc[m_bad.fillna(False), ["name", "address_city", "yearEstablished"]].astype(str).values.tolist(),
                                  before_1800_kept_flagged=int(m_old.sum()),
                                  before_1800_rows=df.loc[m_old.fillna(False), ["name", "address_city", "yearEstablished"]].astype(str).values.tolist())
    df["flag_year_invalid"] = m_bad.fillna(False).astype(bool)
    df["flag_year_very_old"] = m_old.fillna(False).astype(bool)
    df.loc[m_bad.fillna(False), "yearEstablished"] = pd.NA

    df["flag_one_doctor_many_beds"] = ((df["numberDoctors"] == 1) & (df["capacity"] >= 100)).fillna(False).astype(bool)
    rep["one_doctor_many_beds"] = int(df["flag_one_doctor_many_beds"].sum())
    rep["numberDoctors_eq_1"] = int((df["numberDoctors"] == 1).sum())

    cap = df["capacity"]
    df["size_band"] = pd.cut(cap.astype("float"), [0, 30, 100, 500, np.inf], right=False,
                             labels=["small (<30 beds)", "medium (30-99 beds)", "large (100-499 beds)",
                                     "very large / super-speciality scale (500+ beds)"]
                             ).astype(object).where(cap.notna(), "unknown").astype(str)
    doc = df["numberDoctors"]
    df["doctor_band"] = pd.cut(doc.astype("float"), [0, 2, 10, 50, 100, np.inf], right=False,
                               labels=["1 doctor", "2-9 doctors", "10-49 doctors", "50-99 doctors",
                                       "very large / super-speciality scale (100+ doctors)"]
                               ).astype(object).where(doc.notna(), "unknown").astype(str)
    rep["size_band"] = df["size_band"].value_counts().to_dict()
    rep["doctor_band"] = df["doctor_band"].value_counts().to_dict()
    ge10 = cap[cap >= 10]
    rep["capacity_multiple_of_10_pct"] = round(float((ge10 % 10 == 0).mean() * 100), 1)
    rep["missing_after_cleaning_pct"] = {c: round(float(df[c].isna().mean() * 100), 1)
                                         for c in ["capacity", "numberDoctors", "yearEstablished"]}
    rep["clinic_capacity_missing_pct"] = round(float(df.loc[df.facilityTypeId == "clinic", "capacity"].isna().mean() * 100), 1)
    stat("numeric", rep)
    return df


# ---------------------------------------------------------------------------
# STEP 7b  display_name: facility name without the address glued onto it
# ---------------------------------------------------------------------------
ADDR_WORDS = r"(road|rd\.?|marg|street|st\.|nagar|colony|sector|floor|plot|shop|near|opp\.?|opposite|chowk|complex|lane|cross|main|layout|phase|block|midc|behind|beside|p\.?\s?o\.?|dist\.?|district|bazar|bazaar|circle|square|highway|nh[- ]?\d)"


def make_display_name(df):
    has_pin = df["name"].str.contains(r"(?<!\d)\d{3}\s?\d{3}(?!\d)", regex=True, na=False)

    def clean(n):
        n = re.sub(r'^\{\s*"name"\s*:\s*"', "", n).rstrip('"}').strip()     # JSON-wrapped names
        n = re.sub(r"[\x00-\x1f]+\w*", " ", n)                                # control characters

        # cut at the first separator after which an address starts; keep the part before it
        parts = [p for p in re.split(r"\s*(?:,|\s[-\u2013\u2014]\s|\s\(|\s\|\s)\s*", n) if p.strip()]
        out = parts[0]
        if len(out.split()) < 2 and len(parts) > 1:      # e.g. "Apollo, Spectra Hospital" -> keep 2nd piece
            out += " " + parts[1]
        # second trim: inside the first piece, cut at the first address word / house number after word 2
        toks = out.split()
        trim_word = re.compile(r"^(road|rd\.?|marg|street|st\.?|floor|1st|2nd|3rd|first|second|ground|tower|building|"
                               r"bypass|complex|plaza|p\.?o\.?|vill\.?|distt\.?|master|nagar|colony|sector|plot|shop|"
                               r"opp\.?|near|nr\.?|behind|main)$", re.I)
        for i in range(2, len(toks)):
            if trim_word.match(toks[i]) or (re.search(r"\d", toks[i]) and i < len(toks) - 1) \
                    or re.fullmatch(r"[A-Z]?\d+[A-Z]?|\d+/\d+", toks[i]):
                cut = i - 1 if (i >= 3 and re.fullmatch(r"[A-Z][a-z]+|[A-Z]{2,}|[A-Z]\d+", toks[i - 1]) and trim_word.match(toks[i]) and toks[i].lower() in ("road", "rd", "rd.", "street", "st", "st.", "marg", "bypass", "tower", "building")) else i
                toks = toks[:cut]
                break
        out = " ".join(toks)
        out = re.sub(r"\s*[-,(]\s*$", "", out).strip()
        out = re.sub(r"\s+(near|opp\.?|opposite)\b.*$", "", out, flags=re.I).strip()
        return out if len(out) >= 4 else n

    df["display_name"] = df["name"]
    df.loc[has_pin, "display_name"] = df.loc[has_pin, "name"].map(clean)
    changed = has_pin & (df["display_name"] != df["name"])
    stat("display_name", dict(names_with_pin=int(has_pin.sum()), shortened=int(changed.sum()),
                              examples=df.loc[changed, ["name", "display_name"]].head(15).values.tolist(),
                              unchanged_with_pin=df.loc[has_pin & ~changed, "name"].head(10).tolist()))
    return df


# ---------------------------------------------------------------------------
# STEP 8  Near-duplicate groups (I1, I2)
# ---------------------------------------------------------------------------
def duplicate_groups(df):
    name_key = df["name"].fillna("").str.lower().str.replace(r"[^a-z0-9]", "", regex=True)
    city_key = df["address_city"].fillna("").str.lower().str.replace(r"[^a-z0-9]", "", regex=True)
    pin = df["address_zipOrPostcode"].fillna("").str.replace(r"\s", "", regex=True)
    pin = pin.where(pin.str.fullmatch(r"\d{6}"), "")
    parent = list(range(len(df)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a

    pairs = {}
    for label, k in [("name+city", name_key + "|" + city_key), ("name+PIN", name_key + "|" + pin)]:
        valid = (name_key != "") & (k.str.split("|").str[1] != "")
        grp = df.index[valid].to_series().groupby(k[valid]).apply(list)
        grp = grp[grp.map(len) > 1]
        pairs[label] = dict(groups=int(len(grp)), rows=int(grp.map(len).sum()))
        for members in grp:
            for m in members[1:]:
                parent[find(m)] = find(members[0])
    roots = pd.Series([find(i) for i in range(len(df))], index=df.index)
    sizes = roots.map(roots.value_counts())
    in_group = sizes > 1
    completeness = df.notna().sum(axis=1)
    df["dup_group_id"] = pd.Series(pd.NA, index=df.index, dtype="string")
    df.loc[in_group, "dup_group_id"] = "dup_" + df.loc[roots[in_group], "unique_id"].str[:8].values
    df["is_primary"] = True
    df["dup_confidence"] = pd.Series(pd.NA, index=df.index, dtype="string")
    df["flag_possible_duplicate"] = in_group.values
    for r, members in roots[in_group].groupby(roots[in_group]).groups.items():
        members = list(members)
        same_pin = pin[members].nunique() == 1 and pin[members].iloc[0] != ""
        lat, lon = df.loc[members, "latitude"], df.loc[members, "longitude"]
        la, lo = np.radians(lat.astype(float)), np.radians(lon.astype(float))
        span = 2 * 6371 * np.arcsin(np.sqrt(np.sin((la.max() - la.min()) / 2) ** 2 +
                                            np.cos(la.max()) * np.cos(la.min()) * np.sin((lo.max() - lo.min()) / 2) ** 2))
        likely = same_pin or (pd.notna(span) and span <= 2)
        df.loc[members, "dup_confidence"] = "likely" if likely else "possible"
        if likely:
            best = completeness[members].sort_values(ascending=False, kind="stable").index[0]
            df.loc[[m for m in members if m != best], "is_primary"] = False
    stat("duplicate_groups", dict(by_rule=pairs, groups_total=int(df["dup_group_id"].nunique()),
                                  confidence=df.loc[in_group].groupby("dup_confidence")["dup_group_id"].nunique().to_dict(),
                                  rows_in_groups=int(in_group.sum()), non_primary_rows=int((~df["is_primary"]).sum()),
                                  examples=df.loc[in_group, ["dup_group_id", "dup_confidence", "name", "address_city", "address_zipOrPostcode",
                                                             "latitude", "longitude", "is_primary"]]
                                  .sort_values("dup_group_id").astype(str).values.tolist()[:40]))
    return df


# ---------------------------------------------------------------------------
# STEP 9  Plain-language reasons
# ---------------------------------------------------------------------------
def add_reasons(df):
    def reasons(r):
        out = []
        if r["flag_repaired_record"]:
            out.append("This record was broken in the source file and was repaired by re-joining its pieces.")
        if r["flag_doctors_extreme"]:
            out.append(f"Doctor count of {r['numberDoctors']} is extremely high (possibly a chain-wide total); kept but not verified.")
        if r["flag_capacity_extreme"]:
            out.append(f"Bed count of {r['capacity']} is extremely high; kept but not verified.")
        if r["flag_year_invalid"]:
            out.append(f"Founding year '{r['raw_yearEstablished']}' is not a valid year and was removed.")
        if r["flag_year_very_old"]:
            out.append(f"Founding year {r['yearEstablished']} is very old; kept, check the verification columns.")
        if r["flag_one_doctor_many_beds"]:
            out.append("Lists 1 doctor but 100+ beds; the doctor count probably reflects one named doctor, not total staff.")
        if r["flag_doctors_high_for_type"]:
            out.append(f"{r['numberDoctors']} doctors is unusually high for a {r['facilityTypeId']}.")
        if r["flag_beds_high_for_type"]:
            out.append(f"{r['capacity']} beds is unusually high for a {r['facilityTypeId']}.")
        if r["flag_list_truncated"]:
            out.append("Some service lists hit the 50-item limit of the source data, so they may be incomplete or merged from several sources.")
        if r["flag_possible_duplicate"]:
            if r["dup_confidence"] == "likely":
                out.append("Likely duplicate: another record has the same name and the same PIN code or location."
                           + ("" if r["is_primary"] else " The other record is more complete."))
            else:
                out.append("Possible duplicate: another record in the same city has the same name but a different PIN/location.")
        return out
    df["reasons"] = df.apply(reasons, axis=1)
    stat("rows_with_any_reason", int(df["reasons"].map(len).gt(0).sum()))
    return df


# ---------------------------------------------------------------------------
# STEP 10  NFHS (J5)
# ---------------------------------------------------------------------------
def build_nfhs():
    pin = pd.read_csv(DATA / "india_post_pincode_directory.csv", dtype=str, usecols=["statename"])
    canon_states = set(pin["statename"].dropna().str.upper())
    n = pd.read_csv(DATA / "nfhs_5_district_health_indicators.csv", dtype=str, keep_default_na=False)
    ind = list(n.columns[2:])
    star = n[ind] == "*"
    paren = n[ind].apply(lambda s: s.str.fullmatch(r"\(-?[\d.]+\)"))
    vals = {c: pd.to_numeric(n[c].str.strip("()").replace("*", np.nan), errors="coerce") for c in ind}
    lowrel = {f"lowrel_{c}": paren[c].astype(bool) for c in ind}
    out = pd.concat([n[["district_name", "state_ut"]], pd.DataFrame(vals), pd.DataFrame(lowrel)], axis=1)
    unparsed = int(((n[ind] != "*") & out[ind].isna()).sum().sum())
    fix = {"MAHARASTRA": "MAHARASHTRA", "NCT OF DELHI": "DELHI", "JAMMU & KASHMIR": "JAMMU AND KASHMIR",
           "ANDAMAN & NICOBAR ISLANDS": "ANDAMAN AND NICOBAR ISLANDS",
           "DADRA AND NAGAR HAVELI & DAMAN AND DIU": "THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU"}
    out["state_key"] = n["state_ut"].str.upper().replace(fix)
    out["district_key"] = n["district_name"].str.lower().str.replace(r"[^a-z0-9]", "", regex=True)
    out["join_key"] = out["state_key"] + "|" + out["district_key"]
    dup_names = n["district_name"].value_counts()
    stat("nfhs", dict(rows=len(n), indicators=len(ind), cells=int(star.size),
                      suppressed_star_to_missing=int(star.values.sum()),
                      low_reliability_parenthesised=int(paren.values.sum()),
                      unparsed_cells=unparsed,
                      states_fixed={k: v for k, v in fix.items() if k in set(n.state_ut.str.upper())},
                      states_not_matching_india_post=sorted(set(out.state_key) - canon_states),
                      district_names_in_multiple_states=sorted(dup_names[dup_names > 1].index.tolist()),
                      join_key_unique=bool(out["join_key"].is_unique)))
    return out


# ---------------------------------------------------------------------------
def main():
    raw, lines = load_raw()
    recs, quarantine = split_and_repair(raw, lines)
    recs = drop_exact_duplicates(recs)
    recs = normalise_missing(recs)
    recs = clean_lists(recs)
    recs = verify_and_move_dead_columns(recs)
    recs = set_types(recs)
    recs = fix_categories(recs)
    recs = normalise_specialties(recs)
    recs = numeric_sanity(recs)
    recs = make_display_name(recs)
    recs = duplicate_groups(recs)
    recs = add_reasons(recs)
    recs = recs.drop(columns=["repair_method"])

    # missingness after cleaning (scale + evidence)
    stat("missing_after_cleaning_pct", {c: round(float(recs[c].isna().mean() * 100), 1) for c in
                                        ["specialties", "procedure", "equipment", "capability", "description",
                                         "numberDoctors", "capacity", "yearEstablished", "latitude", "officialPhone"]})

    # order columns: key, core, flags, derived, raw
    flags = sorted(c for c in recs.columns if c.startswith("flag_"))
    rawc = sorted(c for c in recs.columns if c.startswith("raw_") or c.startswith("rawlen_"))
    derived = ["display_name", "size_band", "doctor_band", "dup_group_id", "dup_confidence", "is_primary", "specialties_informative", "specialties_rare"] + \
              sorted(c for c in recs.columns if c.startswith("n_"))
    core = [c for c in recs.columns if c not in flags + rawc + derived + ["reasons"]]
    recs = recs[core + derived + flags + ["reasons"] + rawc]

    recs.to_parquet(OUT / "fac_base.parquet", index=False)
    recs.to_parquet(OUT / "fac_base_clean.parquet", index=False)   # input for verify_external.py (keeps reruns repeatable)
    prev = recs.head(200).copy()
    for c in prev.columns:
        if prev[c].map(lambda v: isinstance(v, list)).any():
            prev[c] = prev[c].map(lambda v: json.dumps(v, ensure_ascii=False) if isinstance(v, list) else v)
    prev.to_csv(OUT / "fac_base_preview.csv", index=False)
    quarantine.to_csv(OUT / "facilities_quarantine.csv", index=False)
    nf = build_nfhs()
    nf.to_parquet(OUT / "nfhs_clean.parquet", index=False)
    nf.to_csv(OUT / "nfhs_clean.csv", index=False)

    # read back to prove the files are valid
    back = pd.read_parquet(OUT / "fac_base.parquet")
    stat("output_fac_base_shape", list(back.shape))
    stat("output_columns", {"total": back.shape[1], "flags": len(flags), "raw": len(rawc), "derived": len(derived)})
    stat("output_nfhs_shape", list(pd.read_parquet(OUT / "nfhs_clean.parquet").shape))
    stat("output_quarantine_rows", len(quarantine))
    stat("flag_counts", {c: int(back[c].sum()) for c in flags})
    stat("column_list", list(back.columns))
    (OUT / "run_stats.json").write_text(json.dumps(S, indent=2, default=str))
    print(json.dumps({k: S[k] for k in ["facilities_final", "truncated_repaired", "output_fac_base_shape", "flag_counts"]},
                     indent=2, default=str))


if __name__ == "__main__":
    main()
