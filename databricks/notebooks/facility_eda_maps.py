# Databricks notebook source
# MAGIC %md
# MAGIC # Facility EDA: maps of India and the story behind the data
# MAGIC Reproduces the maps and charts of `EDA.ipynb` from the Delta tables in `workspace.facility_finder`
# MAGIC (`v_eda_fac`, `registry_match`, `facility_claims`) and the shared India Post pincode directory (grey dots = where people live).
# MAGIC The same pictures are saved as PNG files in the volume `/Volumes/workspace/facility_finder/raw/eda_figures/`.
# MAGIC The AI/BI dashboard "Facility finder: EDA, maps and evidence" shows interactive versions of most of them.

# COMMAND ----------

import os, numpy as np, pandas as pd
import matplotlib
matplotlib.use("Agg") if os.environ.get("EDA_HEADLESS") else None
import matplotlib.pyplot as plt

T = "workspace.facility_finder"
OUT = "/Volumes/workspace/facility_finder/raw/eda_figures"
os.makedirs(OUT, exist_ok=True)
saved = []

def done(fig, name):
    fig.savefig(f"{OUT}/{name}.png", dpi=130, bbox_inches="tight", facecolor="white")
    saved.append(name)
    plt.show()

fac = spark.sql(f"SELECT * FROM {T}.v_eda_fac").toPandas()
offices = spark.sql("""SELECT try_cast(latitude AS DOUBLE) AS lat, try_cast(longitude AS DOUBLE) AS lon
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory
  WHERE try_cast(latitude AS DOUBLE) BETWEEN 6 AND 37.5 AND try_cast(longitude AS DOUBLE) BETWEEN 68 AND 97.5""").toPandas()
reg = spark.sql(f"SELECT * FROM {T}.v_eda_registry").toPandas()
claims = spark.sql(f"""SELECT c.service, c.level, f.best_lat, f.best_lon, f.state FROM {T}.facility_claims c
  JOIN {T}.v_eda_fac f ON f.facility_id = c.facility_id WHERE f.best_lat IS NOT NULL""").toPandas()
print(len(fac), "facilities,", len(offices), "post offices with coordinates,", len(reg), "registry rows,", len(claims), "claims")

TYPE_COLORS = {"hospital": "#D1495B", "clinic": "#2E86AB", "dentist": "#3FA34D", "other": "#E8A33D"}
fac["type3"] = fac["facility_type"].where(fac["facility_type"].isin(TYPE_COLORS), "other")

def base(ax, title, alpha=0.5):
    """India drawn by the post offices themselves: no shapefile needed."""
    ax.scatter(offices.lon, offices.lat, s=1, c="#DADDE2", alpha=alpha, linewidths=0, rasterized=True)
    ax.set_xlim(67.5, 98); ax.set_ylim(5.5, 38); ax.set_aspect("equal"); ax.set_title(title, fontsize=12)
    ax.set_xlabel("longitude"); ax.set_ylabel("latitude"); ax.grid(True, color="#EEE", linewidth=0.6)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Where are the facilities, and which positions contradict their own PIN code?

# COMMAND ----------

fig, axes = plt.subplots(1, 2, figsize=(17, 9))
ax = axes[0]; base(ax, "Facility locations (grey = India Post offices = where people live)")
for t, col in TYPE_COLORS.items():
    d = fac[(fac.type3 == t) & fac.best_lat.notna()]
    ax.scatter(d.best_lon, d.best_lat, s=6, c=col, alpha=0.75, linewidths=0, label=f"{t} ({len(d):,})")
ax.legend(loc="lower left", markerscale=3, framealpha=0.9)

ax = axes[1]; base(ax, "Stated coordinates inconsistent with the stated PIN")
d = fac[fac.raw_lat.notna() & fac.km_coords_to_pin.notna()]
near, far = d[d.km_coords_to_pin <= 50], d[d.km_coords_to_pin > 50]
ax.scatter(near.raw_lon, near.raw_lat, s=3, c="#5B6470", alpha=0.6, linewidths=0, label=f"50 km or less from PIN ({len(near):,})")
ax.scatter(far.raw_lon, far.raw_lat, s=11, c="#E5222B", alpha=0.9, linewidths=0, label=f"more than 50 km from its PIN ({len(far):,})")
ax.legend(loc="upper left", markerscale=2.5, framealpha=0.9)
done(fig, "01_locations_and_pin_mismatch")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. How well is each position verified?

# COMMAND ----------

TRUST = {"verified": "#2E8B57", "verified_osm": "#1B6B8F", "probable": "#8CC084", "approximate_pin": "#F2A93B", "unverified": "#D1495B"}
fig, axes = plt.subplots(1, 3, figsize=(22, 8))
ax = axes[0]; base(ax, "Location trust label")
for k, col in TRUST.items():
    d = fac[(fac.location_trust == k) & fac.best_lat.notna()]
    ax.scatter(d.best_lon, d.best_lat, s=6, c=col, alpha=0.8, linewidths=0, label=f"{k} ({len(d):,})")
ax.legend(loc="lower left", markerscale=3)
ax = axes[1]; base(ax, "Facility trust score (0 to 100)")
d = fac[fac.best_lat.notna() & fac.facility_trust.notna()].sort_values("facility_trust")
sc = ax.scatter(d.best_lon, d.best_lat, s=7, c=d.facility_trust, cmap="viridis", alpha=0.85, linewidths=0)
plt.colorbar(sc, ax=ax, shrink=0.6, label="facility trust")
ax = axes[2]; base(ax, "Public (blue) and private (orange) facilities")
for k, col in {"private": "#E8A33D", "public": "#1B6B8F"}.items():
    d = fac[(fac.operator == k) & fac.best_lat.notna()]
    ax.scatter(d.best_lon, d.best_lat, s=8 if k == "public" else 4, c=col, alpha=0.8, linewidths=0, label=f"{k} ({len(d):,})")
ax.legend(loc="lower left", markerscale=3)
done(fig, "02_trust_maps")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Density and coverage by state

# COMMAND ----------

fig, axes = plt.subplots(1, 3, figsize=(23, 8.5), gridspec_kw={"width_ratios": [1.1, 1, 1]})
ax = axes[0]; ax.set_title("Facility density (hexagon bins)", fontsize=12)
d = fac[fac.best_lat.notna()]
hb = ax.hexbin(d.best_lon, d.best_lat, gridsize=48, bins="log", cmap="magma_r", mincnt=1, extent=(67.5, 98, 5.5, 38))
ax.set_aspect("equal"); ax.set_xlim(67.5, 98); ax.set_ylim(5.5, 38); plt.colorbar(hb, ax=ax, shrink=0.6, label="facilities (log scale)")
st = fac.dropna(subset=["state"]).groupby("state").agg(n=("facility_id", "size"), trusted=("facility_trust", lambda s: (s >= 60).mean() * 100),
                                                      h24=("is_24x7", "mean"), public=("operator", lambda s: (s == "public").mean() * 100)).sort_values("n", ascending=False)
top = st.head(18).iloc[::-1]
ax = axes[1]; ax.barh(top.index.str.title(), top.n, color="#2E86AB"); ax.set_title("Facilities per state (top 18)", fontsize=12); ax.grid(axis="x", color="#EEE")
ax = axes[2]; ax.barh(top.index.str.title(), top.trusted, color="#2E8B57"); ax.set_title("Share of facilities with trust 60 or more (%)", fontsize=12); ax.grid(axis="x", color="#EEE"); ax.set_xlim(0, 100)
done(fig, "03_density_and_states")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Services: where is strong evidence?

# COMMAND ----------

SERV = ["trauma_emergency", "icu", "dialysis", "obstetrics", "oncology", "nicu"]
fig, axes = plt.subplots(2, 3, figsize=(22, 15))
for ax, s in zip(axes.ravel(), SERV):
    d = claims[(claims.service == s) & claims.level.isin(["Strong"])]
    base(ax, f"{s.replace('_', ' ')}: facilities with Strong evidence ({len(d):,})", alpha=0.35)
    ax.scatter(d.best_lon, d.best_lat, s=9, c="#0B5D3B", alpha=0.8, linewidths=0)
done(fig, "04_service_maps")

lv = claims.groupby(["service", "level"]).size().unstack(fill_value=0)
lv = lv[[c for c in ["Strong", "Moderate", "Inferred", "Weak", "Contradicted"] if c in lv]].loc[lambda x: x.sum(axis=1).sort_values().index]
fig, ax = plt.subplots(figsize=(11, 7))
lv.plot.barh(stacked=True, ax=ax, color=["#0B5D3B", "#5FAE87", "#FFC20E", "#9AA7A0", "#C8102E"][:lv.shape[1]], width=0.8)
ax.set_title("Service claims by evidence level"); ax.grid(axis="x", color="#EEE")
done(fig, "04b_claims_by_level")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. PM-JAY registry cross-check

# COMMAND ----------

fig, axes = plt.subplots(1, 2, figsize=(18, 9), gridspec_kw={"width_ratios": [1.2, 1]})
ax = axes[0]; base(ax, "Facilities verified against the PM-JAY empanelment list", alpha=0.35)
d0 = reg[reg.best_lat.notna() & (reg.registry_tier != "verified")]
ax.scatter(d0.best_lon, d0.best_lat, s=3, c="#B8BEC8", alpha=0.6, linewidths=0, label=f"not matched, or only possibly ({len(d0):,})")
for k, col in {"private": "#E8A33D", "government": "#1B6B8F"}.items():
    d = reg[reg.best_lat.notna() & (reg.registry_tier == "verified") & (reg.registry_ownership == k)]
    ax.scatter(d.best_lon, d.best_lat, s=18, c=col, alpha=0.9, linewidths=0, label=f"verified, {k} ({len(d):,})")
ax.legend(loc="lower left", markerscale=2)
ax = axes[1]
rs = reg.dropna(subset=["state"]).assign(v=lambda x: (x.registry_tier == "verified") * 100).groupby("state").agg(p=("v", "mean"), n=("v", "size"))
rs = rs[rs.n >= 30].sort_values("p").tail(15)
ax.barh(rs.index.str.title(), rs.p, color="#1B6B8F"); ax.set_title("Share of facilities with a verified match, by state (30+ facilities)"); ax.grid(axis="x", color="#EEE")
done(fig, "05_registry")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6. Data quality: distances, completeness, correlations

# COMMAND ----------

fig, axes = plt.subplots(1, 3, figsize=(21, 6.5))
d = fac.km_coords_to_pin.dropna()
axes[0].hist(np.clip(d, 0, 200), bins=60, color="#2E86AB"); axes[0].set_yscale("log"); axes[0].axvline(50, color="#E5222B", ls="--")
axes[0].set_title("Distance from stated coordinates to the stated PIN (km, capped at 200)"); axes[0].grid(color="#EEE")
fields = {"specialties": "has_specialties", "procedures": "has_procedure", "equipment": "has_equipment", "capabilities": "has_capability", "phone": "has_phone", "website": "has_website",
          "email": "has_email", "year established": "has_year", "doctors": "has_doctors", "bed capacity": "has_capacity", "description": "has_description"}
comp = pd.Series({k: fac[v].astype(float).mean() * 100 for k, v in fields.items()}).sort_values()
axes[1].barh(comp.index, comp.values, color="#8E5BC4"); axes[1].set_title("Completeness: % of facilities with a value"); axes[1].grid(axis="x", color="#EEE"); axes[1].set_xlim(0, 100)
axes[2].hist(fac.facility_trust.dropna(), bins=20, color="#2E8B57"); axes[2].set_title("Facility trust score (0 to 100)"); axes[2].grid(color="#EEE")
done(fig, "06_quality")

cols = ["facility_trust", "location_trust_score", "merge_suspect_score", "n_claims", "n_specialties", "n_procedure", "n_equipment", "n_capability", "doctors", "capacity"]
cm = fac[cols].astype(float).corr()
fig, ax = plt.subplots(figsize=(9, 7.5))
im = ax.imshow(cm.values, cmap="RdBu_r", vmin=-1, vmax=1)
ax.set_xticks(range(len(cols)), cols, rotation=60, ha="right"); ax.set_yticks(range(len(cols)), cols)
for i in range(len(cols)):
    for j in range(len(cols)):
        ax.text(j, i, f"{cm.values[i, j]:.2f}", ha="center", va="center", fontsize=8, color="black")
plt.colorbar(im, ax=ax, shrink=0.8, label="Pearson r"); ax.set_title("Correlations between numeric facility features")
done(fig, "07_correlations")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 7. District context: facilities against NFHS-5 institutional births
# MAGIC District averages: an association, not a cause, and never a property of a single facility.

# COMMAND ----------

dd = fac.dropna(subset=["district", "nfhs_inst_birth_pct"]).groupby(["state", "district"]).agg(n=("facility_id", "size"), births=("nfhs_inst_birth_pct", "mean"),
                                                                                              trusted=("facility_trust", lambda s: (s >= 60).sum())).query("n >= 3")
fig, ax = plt.subplots(figsize=(10, 7))
sc = ax.scatter(dd.n, dd.births, s=20 + dd.trusted * 3, c=dd.births, cmap="viridis", alpha=0.7, edgecolors="white", linewidths=0.4)
ax.set_xscale("log"); ax.set_xlabel("facilities in the district (log)"); ax.set_ylabel("institutional births, NFHS-5 (%)"); ax.grid(color="#EEE")
ax.set_title(f"{len(dd)} districts with 3+ facilities (bubble size = facilities with trust 60 or more)")
done(fig, "08_district_vs_nfhs")

print("saved:", saved)
dbutils.notebook.exit(",".join(saved))
