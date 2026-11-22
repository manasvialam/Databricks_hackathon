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


def num(df):
    """Spark decimals arrive as Python Decimal objects: turn numeric object columns into floats."""
    for c in df.columns:
        if df[c].dtype == object:
            try:
                df[c] = pd.to_numeric(df[c])
            except (ValueError, TypeError):
                pass
    return df

def done(fig, name):
    fig.savefig(f"{OUT}/{name}.png", dpi=130, bbox_inches="tight", facecolor="white")
    saved.append(name)
    plt.show()

fac = num(spark.sql(f"SELECT * FROM {T}.v_eda_fac").toPandas())
offices = spark.sql("""SELECT try_cast(latitude AS DOUBLE) AS lat, try_cast(longitude AS DOUBLE) AS lon
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory
  WHERE try_cast(latitude AS DOUBLE) BETWEEN 6 AND 37.5 AND try_cast(longitude AS DOUBLE) BETWEEN 68 AND 97.5""").toPandas()
# a junk band in the directory (one latitude shared by hundreds of offices at many longitudes) is dropped
_la = offices.assign(la=offices.lat.round(3)).groupby("la").agg(n=("lon", "size"), k=("lon", lambda s: s.round(1).nunique()))
offices = offices[~offices.lat.round(3).isin(_la[(_la.n >= 100) & (_la.k >= 30)].index)].reset_index(drop=True)
reg = num(spark.sql(f"SELECT * FROM {T}.v_eda_registry").toPandas())
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

# COMMAND ----------

# MAGIC %md
# MAGIC ## 8. Care deserts: how far is the nearest facility with evidence for a service?
# MAGIC Dots are India Post offices (about one in eight, a proxy for where people live), coloured by straight-line km to the nearest facility in our data with Strong or Moderate
# MAGIC evidence for the service (capped at 150). Black dots are those facilities. A desert here can also be a gap in our data: see section 10.

# COMMAND ----------

okm = num(spark.sql(f"SELECT service, lat, lon, state, district, km FROM {T}.eda_office_service_km").toPandas())
sites = num(spark.sql(f"SELECT service, lat, lon FROM {T}.eda_service_sites").toPandas())
BUCKETS = [(10, "within 10 km", "#2E8B57"), (25, "10 to 25 km", "#9BC53D"), (50, "25 to 50 km", "#F2C14E"), (100, "50 to 100 km", "#F08A4B"), (1e9, "over 100 km", "#C8102E")]

def bucket_color(km):
    km = np.asarray(km); out = np.empty(len(km), dtype=object); lo = 0
    for hi, _, col in BUCKETS:
        out[(km > lo) & (km <= hi)] = col; lo = hi
    out[km <= 0] = BUCKETS[0][2]
    return out

fig, axes = plt.subplots(2, 2, figsize=(18, 19))
for ax, (svc, name) in zip(axes.ravel(), [("dialysis", "dialysis centre"), ("cath_lab", "cath lab"), ("nicu", "newborn ICU"), ("trauma_emergency", "emergency and trauma care")]):
    d = okm[okm.service == svc]; far = (d.km > 50).mean() * 100
    ax.scatter(d.lon, d.lat, s=4, c=bucket_color(d.km.values), alpha=0.85, linewidths=0, rasterized=True)
    st = sites[sites.service == svc]; ax.scatter(st.lon, st.lat, s=9, c="black", alpha=0.8, linewidths=0)
    ax.set_xlim(67.5, 98); ax.set_ylim(5.5, 38); ax.set_aspect("equal"); ax.grid(True, color="#EEE", linewidth=0.6)
    ax.set_title(f"Nearest {name}: {far:.0f}% of post offices are over 50 km away", fontsize=12)
handles = [plt.Line2D([], [], marker="o", ls="", color=c, label=l) for _, l, c in BUCKETS] + [plt.Line2D([], [], marker="o", ls="", color="black", label="facility with evidence")]
fig.legend(handles=handles, loc="lower center", ncol=6, frameon=False, fontsize=12)
done(fig, "09_care_deserts_maps")

# COMMAND ----------

pv = okm.assign(over=lambda x: (x.km > 50) * 100).groupby(["state", "service"]).agg(p=("over", "mean"), n=("over", "size")).reset_index()
top = okm.groupby("state").size().sort_values(ascending=False).head(20).index
hm = pv[pv.state.isin(top)].pivot(index="state", columns="service", values="p")[["dialysis", "cath_lab", "nicu", "trauma_emergency", "oncology", "mri"]].sort_values("cath_lab")
fig, axes = plt.subplots(1, 2, figsize=(19, 8), gridspec_kw={"width_ratios": [1.1, 1]})
ax = axes[0]; im = ax.imshow(hm.values, cmap="YlOrRd", vmin=0, vmax=100, aspect="auto")
ax.set_xticks(range(hm.shape[1]), hm.columns, rotation=30, ha="right"); ax.set_yticks(range(hm.shape[0]), hm.index.str.title())
for i in range(hm.shape[0]):
    for j in range(hm.shape[1]):
        ax.text(j, i, f"{hm.values[i, j]:.0f}", ha="center", va="center", fontsize=8, color="black")
plt.colorbar(im, ax=ax, shrink=0.8, label="% of post offices more than 50 km away"); ax.set_title("Percent of post offices more than 50 km from each service, by state")
ax = axes[1]
labels = [l for _, l, _ in BUCKETS]; sh = okm.assign(b=lambda x: pd.cut(x.km, [-1] + [b[0] for b in BUCKETS[:-1]] + [1e9], labels=labels)).groupby(["service", "b"], observed=False).size().unstack(fill_value=0)
sh = sh.div(sh.sum(axis=1), axis=0) * 100; sh = sh.loc[sh["within 10 km"].sort_values().index]
left = np.zeros(len(sh))
for (_, l, c) in BUCKETS:
    ax.barh(sh.index, sh[l], left=left, color=c, label=l); left += sh[l].values
ax.legend(ncol=5, loc="upper center", bbox_to_anchor=(0.5, -0.06), frameon=False); ax.set_title("Share of post offices by distance to the nearest facility, per service"); ax.set_xlim(0, 100)
done(fig, "10_care_deserts_states")

worst = okm[okm.service.isin(["dialysis", "cath_lab"])].groupby(["service", "state", "district"]).agg(km=("km", "mean"), n=("km", "size")).reset_index().query("n >= 15")
fig, axes = plt.subplots(1, 2, figsize=(18, 7))
for ax, svc in zip(axes, ["dialysis", "cath_lab"]):
    w = worst[worst.service == svc].sort_values("km").tail(15)
    ax.barh(w.district.str.title() + ", " + w.state.str.title(), w.km, color="#C8102E"); ax.set_xlim(0, 155); ax.grid(axis="x", color="#EEE")
    ax.set_title(f"Districts farthest from a {svc.replace('_', ' ')} (average km; 150 = none in our data)")
done(fig, "10b_worst_districts")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 9. Need versus supply by district
# MAGIC NFHS-5 district indicators against facilities in our data with Strong or Moderate evidence per 100 India Post offices (a rough population proxy).
# MAGIC District-level associations from survey averages: nothing here describes an individual's risk, and nothing shows cause.

# COMMAND ----------

dist = num(spark.sql(f"SELECT * FROM {T}.eda_district").toPandas())
dd = dist[dist.offices >= 20]

def trend(ax, x, y, xl, yl, title, size="offices"):
    m = x.notna() & y.notna()
    ax.scatter(x[m], y[m], s=10 + dd.loc[m, size] / 6, c="#2E86AB", alpha=0.45, edgecolors="white", linewidths=0.3)
    if m.sum() > 10:
        k = np.polyfit(x[m], y[m], 1); xs = np.linspace(x[m].min(), x[m].max(), 50); ax.plot(xs, np.polyval(k, xs), color="#C8102E", lw=2)
        ax.text(0.02, 0.95, f"r = {np.corrcoef(x[m], y[m])[0, 1]:.2f}  (n = {m.sum()} districts)", transform=ax.transAxes, va="top", fontsize=11, bbox=dict(fc="white", ec="#DDD"))
    ax.set_xlabel(xl); ax.set_ylabel(yl); ax.set_title(title, fontsize=11.5); ax.grid(color="#EEE")

fig, axes = plt.subplots(2, 2, figsize=(16, 13))
trend(axes[0, 0], dd.bp_women_pct, dd.cath_per_100_offices, "women with raised blood pressure (%)", "cath labs per 100 post offices", "Raised blood pressure in women against cath labs")
trend(axes[0, 1], dd.tobacco_men_pct, dd.onc_per_100_offices, "men using tobacco (%)", "cancer-care facilities per 100 post offices", "Tobacco use in men against cancer care")
trend(axes[1, 0], dd.anaemia_women_pct, dd.nicu_per_100_offices, "women with anaemia (%)", "NICUs per 100 post offices", "Anaemia in women against NICUs")
trend(axes[1, 1], dd.insurance_pct, dd.pmjay_per_100_offices, "households with health insurance (%)", "PM-JAY verified hospitals per 100 post offices", "Insurance coverage against PM-JAY verified hospitals")
fig.suptitle("District-level association, not individual risk (bubble size = post offices)", y=0.93, fontsize=13)
done(fig, "11_need_vs_supply_scatter")

# COMMAND ----------

mp = dist.dropna(subset=["lat", "bp_women_pct"])
fig, axes = plt.subplots(1, 2, figsize=(19, 9))
for ax, (col, sz, ttl, cmapn) in zip(axes, [("bp_women_pct", "cath_labs", "Raised blood pressure in women (colour) and cath labs (size), by district", "plasma"),
                                            ("anaemia_women_pct", "nicu", "Anaemia in women (colour) and NICUs (size), by district", "plasma")]):
    base(ax, ttl, alpha=0.25)
    d = mp.dropna(subset=[col]); sc = ax.scatter(d.lon, d.lat, s=12 + d[sz] * 30, c=d[col], cmap=cmapn, alpha=0.8, edgecolors="white", linewidths=0.4)
    plt.colorbar(sc, ax=ax, shrink=0.6, label=col.replace("_", " "))
done(fig, "12_need_vs_supply_maps")

needs = [("bp_women_pct", "raised blood pressure, women"), ("sugar_women_pct", "high blood sugar, women"), ("tobacco_men_pct", "tobacco use, men"), ("anaemia_women_pct", "anaemia, women"),
         ("inst_birth_pct", "institutional births"), ("csection_pct", "C-section share"), ("insurance_pct", "insurance coverage")]
supply = [("cath_labs", "cath labs"), ("dialysis", "dialysis"), ("oncology", "cancer care"), ("maternity", "maternity"), ("nicu", "NICU"), ("pmjay_verified", "PM-JAY verified")]
ds_ = dist[dist.offices >= 10]
cm = np.array([[ds_[n].corr(100 * ds_[s] / ds_.offices) for s, _ in supply] for n, _ in needs])
fig, ax = plt.subplots(figsize=(10, 7))
im = ax.imshow(cm, cmap="RdYlBu", vmin=-0.5, vmax=0.5)
ax.set_xticks(range(len(supply)), [l for _, l in supply], rotation=30, ha="right"); ax.set_yticks(range(len(needs)), [l for _, l in needs])
for i in range(len(needs)):
    for j in range(len(supply)):
        ax.text(j, i, f"{cm[i, j]:.2f}", ha="center", va="center", fontsize=10)
plt.colorbar(im, ax=ax, label="Pearson r (blue: supply rises with need)"); ax.set_title("How district need and supply move together")
done(fig, "13_need_supply_correlation")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 10. The PM-JAY list against our data: the coverage gap

# COMMAND ----------

hem = num(spark.sql(f"SELECT * FROM {T}.v_eda_hem").toPandas())
inb = hem[hem.lat.between(6, 37.5) & hem.lon.between(68, 97.5) & ~hem.inactive.astype(bool) & hem.ownership.isin(["government", "private"])]
fig, axes = plt.subplots(1, 2, figsize=(20, 9), gridspec_kw={"width_ratios": [1.15, 1]})
ax = axes[0]; base(ax, "Empanelled hospitals: in our data (blue) and not in it (purple government, orange private)", alpha=0.25)
for k, col, lbl in [("g", "#8E5BC4", "government, not in our data"), ("p", "#E8A33D", "private, not in our data")]:
    d = inb[(inb.match_tier != "verified") & (inb.ownership == ("government" if k == "g" else "private"))]
    ax.scatter(d.lon, d.lat, s=3, c=col, alpha=0.45, linewidths=0, label=f"{lbl} ({len(d):,})")
d = inb[inb.match_tier == "verified"]; ax.scatter(d.lon, d.lat, s=14, c="#1B6B8F", alpha=0.95, linewidths=0, label=f"in our data, verified ({len(d):,})")
ax.legend(loc="lower left", markerscale=3)
ax = axes[1]
g = hem.dropna(subset=["state"]).groupby("state").agg(total=("hem_facility_id", "size"), ours=("match_tier", lambda s: (s == "verified").sum())).sort_values("total").tail(15)
yy = np.arange(len(g)); ax.barh(yy + 0.2, g.total, 0.4, color="#9AA7B8", label="PM-JAY list"); ax.barh(yy - 0.2, g.ours, 0.4, color="#1B6B8F", label="in our data (verified)")
ax.set_yticks(yy, g.index.str.title()); ax.legend(); ax.set_title("Empanelled hospitals against those we hold, top 15 states"); ax.grid(axis="x", color="#EEE")
done(fig, "14_registry_gap")

fig, axes = plt.subplots(1, 2, figsize=(18, 6.5))
r = hem.dropna(subset=["state"]).groupby("state").agg(n=("hem_facility_id", "size"), p=("match_tier", lambda s: (s == "verified").mean() * 100)).query("n >= 400").sort_values("p")
axes[0].barh(r.index.str.title(), r.p, color="#1B6B8F"); axes[0].set_title("Share of each state's empanelled hospitals that are in our data (%)"); axes[0].grid(axis="x", color="#EEE")
own = pd.DataFrame({"PM-JAY list": hem.ownership.value_counts(), "in our data (verified)": hem[hem.match_tier == "verified"].ownership.value_counts()}).fillna(0)
own = own.loc[[o for o in ["government", "private"] if o in own.index]]; own = own / own.sum() * 100
own.T.plot.barh(stacked=True, ax=axes[1], color={"government": "#1B6B8F", "private": "#E8A33D"}); axes[1].set_title("Government against private (%)"); axes[1].set_xlim(0, 100)
done(fig, "14b_registry_gap_states")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 11. The data-trust story

# COMMAND ----------

tr = num(spark.sql(f"SELECT * FROM {T}.v_eda_trust").toPandas())
tr["age"] = pd.cut(tr.page_age_years.where(tr.page_age_years >= 0), [-0.1, 0.99, 1.99, 2.99, 99], labels=["under 1 year", "1 to 2", "2 to 3", "3 or more"])
fig, axes = plt.subplots(2, 3, figsize=(21, 12))
a = tr.groupby("age", observed=True).facility_trust.mean(); axes[0, 0].bar(a.index.astype(str), a.values, color="#2E86AB"); axes[0, 0].set_title("Trust by age of the facility's web page (years)"); axes[0, 0].set_ylim(40, 80)
a = tr.assign(d=tr.n_independent_domains.clip(upper=6)).groupby("d").facility_trust.mean(); axes[0, 1].bar(a.index.astype(int).astype(str), a.values, color="#3FA34D"); axes[0, 1].set_title("Trust by number of independent sources (6 = six or more)"); axes[0, 1].set_ylim(40, 80)
a = tr.assign(d=tr.social_presence.clip(upper=5)).groupby("d").facility_trust.mean(); axes[0, 2].bar(a.index.astype(int).astype(str), a.values, color="#E8A33D"); axes[0, 2].set_title("Trust by number of social platforms (5 = five or more)"); axes[0, 2].set_ylim(40, 80)
d = tr[tr.beds.between(1, 1500) & tr.doctors.between(1, 1000)]
axes[1, 0].scatter(d.beds[~d.ratio_flag.astype(bool)], d.doctors[~d.ratio_flag.astype(bool)], s=8, c="#2E86AB", alpha=0.5, label="plausible")
axes[1, 0].scatter(d.beds[d.ratio_flag.astype(bool)], d.doctors[d.ratio_flag.astype(bool)], s=14, c="#E5222B", alpha=0.8, label="flagged as implausible"); axes[1, 0].legend()
axes[1, 0].set_xlabel("beds"); axes[1, 0].set_ylabel("doctors"); axes[1, 0].set_title("Doctors against beds"); axes[1, 0].grid(color="#EEE")
cl = spark.sql(f"""SELECT f.facility_trust, avg(c.claim_strength) AS s, f.merge_suspect FROM {T}.facility_claims c JOIN {T}.v_eda_trust f ON f.facility_id = c.facility_id
  WHERE c.claim_strength IS NOT NULL AND f.facility_trust IS NOT NULL GROUP BY f.facility_id, f.facility_trust, f.merge_suspect""").toPandas()
cl = num(cl)
for flag, col, lbl in [(False, "#2E86AB", "clean record"), (True, "#E5222B", "may mix facilities")]:
    d = cl[cl.merge_suspect.astype(bool) == flag]; axes[1, 1].scatter(d.facility_trust, d.s, s=8, c=col, alpha=0.4, label=lbl)
axes[1, 1].legend(); axes[1, 1].set_xlabel("facility trust"); axes[1, 1].set_ylabel("average claim strength"); axes[1, 1].set_title("Claim strength against trust"); axes[1, 1].grid(color="#EEE")
sm = spark.sql(f"SELECT level, facility_merge_suspect AS m, count(*) AS n FROM {T}.facility_claims GROUP BY 1, 2").toPandas()
sm = sm.pivot(index="level", columns="m", values="n").fillna(0); sm = sm.div(sm.sum(axis=1), axis=0) * 100
axes[1, 2].barh(sm.index, sm[False], color="#2E86AB", label="clean record"); axes[1, 2].barh(sm.index, sm[True], left=sm[False], color="#E5222B", label="record may mix facilities")
axes[1, 2].legend(loc="lower center"); axes[1, 2].set_title("Share of each evidence level on records that may mix facilities (%)")
done(fig, "15_trust_story")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 12. More of the story: age, breadth and open hours

# COMMAND ----------

fig, axes = plt.subplots(1, 3, figsize=(22, 6.5))
t = tr[tr.year_established.between(1900, 2026)].assign(dec=lambda x: (x.year_established // 10 * 10).astype(int), t3=lambda x: x.facility_type.where(x.facility_type.isin(TYPE_COLORS), "other"))
p_ = t.groupby(["dec", "t3"]).size().unstack(fill_value=0); p_.plot.bar(stacked=True, ax=axes[0], color=[TYPE_COLORS[c] for c in p_.columns], width=0.85)
axes[0].set_title("When facilities were established, by decade and type"); axes[0].set_xlabel("")
h = tr[tr.facility_type == "hospital"].dropna(subset=["state"]).groupby("state").agg(s=("n_specialties", "mean"), n=("facility_id", "size")).query("n >= 30").sort_values("s").tail(15)
axes[1].barh(h.index.str.title(), h.s, color="#8E5BC4"); axes[1].set_title("Specialties listed per hospital, top 15 states (30+ hospitals)"); axes[1].grid(axis="x", color="#EEE")
cs = tr[tr.city.notna()].groupby("city").facility_id.transform("size"); hh = tr[tr.facility_type == "hospital"].assign(cs=cs)
hh["size"] = pd.cut(hh.cs, [0, 1, 4, 19, 99, 1e9], labels=["1", "2 to 4", "5 to 19", "20 to 99", "100+"])
c24 = hh.groupby("size", observed=True).is_24x7.mean() * 100; axes[2].bar(c24.index.astype(str), c24.values, color="#D1495B"); axes[2].set_title("Hospitals open 24 hours (%), by number of facilities in the city"); axes[2].set_ylim(0, 100)
done(fig, "16_age_breadth_hours")

# COMMAND ----------

print("saved:", saved)
dbutils.notebook.exit(",".join(saved))
