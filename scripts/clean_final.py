"""
Light in-place cleanup of facilities_final.parquet.

1. address_zipOrPostcode: strip inner spaces ("613 007" -> "613007"), then null anything
   that is not a 6-digit Indian PIN.
2. Coordinates: null lat/lon pairs that fall outside India's bounding box, for the
   working coordinate columns (latitude/longitude, best_lat/best_lon).
   raw_* columns are left as the untouched source record.
3. Drop columns that are exact copies of another column (see DUPLICATE_COLS). Columns that are
   only coincidentally equal (e.g. several all-False nfhs_lowrel_* flags) are kept.

Numeric outliers (capacity, numberDoctors, yearEstablished) are intentionally left as-is;
size_band / doctor_band already give the categorical view.

Idempotent: running it twice changes nothing the second time.
"""
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
FAC = ROOT / "facilities_final.parquet"

LAT_RANGE, LON_RANGE = (6.0, 37.5), (68.0, 97.5)
COORD_PAIRS = [("latitude", "longitude"), ("best_lat", "best_lon")]

# column to drop -> identical column that is kept
DUPLICATE_COLS = {
    "raw_content_table_id": "source_content_id",
    "email_raw": "email",
    "officialWebsite": "official_website",  # export_snapshot.py reads official_website
    "raw_city": "address_city",
    "raw_stateOrRegion": "address_stateOrRegion",
    "last_social_post": "post_metrics_most_recent_social_media_post_date",
    "lat": "latitude",
    "lon": "longitude",
    "n_phones_listed": "n_phone_numbers",
    "n_distinct_specialties": "n_specialties",
    "m_list_truncated": "flag_list_truncated",
    "flag_list_truncated_raw": "flag_list_truncated",
    "m_multiple_pins": "flag_multiple_pins",
    "m_geo_gt_100km": "flag_geo_mismatch_100km",
    "location_trust_input": "location_trust",
    "m_long_phone_list": "flag_long_phone_list",
    "m_foreign_sources": "foreign_sources",
    "n_other_hospital_items": "other_hospital_sentences",
    "m_names_other_hospital": "flag_names_other_hospital",
}


def main() -> None:
    df = pd.read_parquet(FAC)

    # 1. PIN codes
    z = df["address_zipOrPostcode"]
    z_norm = z.astype("string").str.replace(r"\s+", "", regex=True)
    valid = z_norm.str.fullmatch(r"[1-9]\d{5}").fillna(False).astype(bool)
    changed = (z_norm != z.astype("string")).fillna(False).astype(bool)
    reformatted = int((valid & changed).sum())
    nulled = int((~valid & z.notna()).sum())
    df["address_zipOrPostcode"] = z_norm.where(valid, pd.NA)
    print(f"zip: reformatted {reformatted}, nulled {nulled}, null now {int(df['address_zipOrPostcode'].isna().sum())}")

    # 2. Coordinates outside India
    for la, lo in COORD_PAIRS:
        bad = df[la].notna() & ~(df[la].between(*LAT_RANGE) & df[lo].between(*LON_RANGE))
        df.loc[bad, [la, lo]] = float("nan")
        print(f"{la}/{lo}: nulled {int(bad.sum())}")

    # 3. Drop columns that are exact copies of another column (kept name = the one code reads)
    for drop, keep in DUPLICATE_COLS.items():
        if drop not in df:
            continue
        assert keep in df and df[drop].map(repr).equals(df[keep].map(repr)), f"{drop} is not a copy of {keep}"
        df = df.drop(columns=drop)
    print(f"dropped duplicate columns; now {df.shape[1]} columns")

    # size_band sanity check against capacity (no change made)
    unknown = df["size_band"] == "unknown"
    assert (unknown == df["capacity"].isna()).all(), "size_band out of sync with capacity"

    df.to_parquet(FAC, index=False)
    print(f"wrote {FAC.name}: {df.shape}")


if __name__ == "__main__":
    main()
