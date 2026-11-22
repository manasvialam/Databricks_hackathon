/**
 * Probabilistic ranker.
 *
 * For each candidate we estimate, under uncertainty:
 *   P(service)      from named evidence signals added in log-odds space (every term is kept so it can be explained)
 *   P(location ok)  from Person 2's location trust label
 *   travel time     traffic-aware ETA with noise that grows with congestion
 * then draw N Monte-Carlo scenarios (service present or not, location right or wrong, travel time, preference weights)
 * and count how often each candidate is the best. Output: P(best), expected rank and 80% intervals.
 *
 * The weights below are hand-set priors, not fitted. Until manual verifications exist the app labels
 * results "evidence-weighted estimate", never "calibrated". All weights are in one place on purpose.
 */
import type {
  Claim, ClaimLevel, Confidence, Contribution, Facility, Picks, Preferences, RankedFacility, TrafficEta, Urgency,
} from "./types";
import { TAU_MINUTES, normalise, effectivePreferences } from "./preferences";
import type { CardStatus } from "./preferences";
import { msg, svcLabel, t, trustDetail, type Msg, type MsgKey, type Vars } from "./i18n";

const LEVEL_TERM: Record<ClaimLevel, MsgKey> = {
  Strong: "whyStrong", Moderate: "whyModerate", Inferred: "whyInferred", Weak: "whyWeak", Contradicted: "whyContradicted",
};

// ---------- weights (hand-set priors) -------------------------------------------------------------------------------
export const W = {
  prior: { Strong: 0.72, Moderate: 0.5, Inferred: 0.4, Weak: 0.2, Contradicted: 0.03, none: 0.05 } as Record<ClaimLevel | "none", number>,
  perExtraField: 0.25, extraFieldCap: 0.75,
  specificity: 0.4,
  prerequisitesMissing: -0.8,
  perContradiction: -1.0, contradictionCap: -2.0,
  perNamedCitation: 0.15, citationCap: 0.3,
  trustScale: 1.0,                 // (facility_trust - 70) / 100 * trustScale
  perMergeSuspect: -0.25,
  registryIdentity: 0.5,           // verified registry match: independent evidence the facility is real
  registryService: 0.8,            // the registry lists a specialty package that maps to this service
  registryCap: 1.2,                // total registry contribution can never exceed this (cannot rescue Weak evidence)
  nabh: 0.15, wikidata: 0.15, recognitionModerate: 0.1, recognitionHigh: 0.2,
  copulaRho: 0.4,                  // services at one facility are not independent
  dirichletKappa: 30,              // how tightly preference weights stay near the chosen ones
  minViable: 0.35,                 // below this P(service) a facility is not offered as a recommendation
  solid: 0.5,                      // at or above this, with no contradiction and prerequisites met, the evidence is 'solid'
  modelFit: 0.6,                   // language-model fit, (fit - 0.5) * 2 * this: at most +-0.6 log-odds, and positive only where evidence already exists
  clearWinner: 0.35,               // P(best) under this = "several similar options"
};

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

const LOCATION_OK: Record<string, number> = {
  verified: 0.97, verified_osm: 0.98, probable: 0.85, approximate_pin: 0.75, approximate_district: 0.5, unverified: 0.45, unknown: 0.2,
};
// How far (km) the true position may be from the one we hold when the location is wrong.
const LOCATION_SIGMA_KM: Record<string, number> = {
  verified: 0.2, verified_osm: 0.2, probable: 1.5, approximate_pin: 3, approximate_district: 15, unverified: 25, unknown: 40,
};
const SIZE_COMFORT: Record<string, number> = { small: 0.2, medium: 0.5, large: 0.8, xlarge: 1 };

const siteOf = (u: string): string => { try { return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, ""); } catch { return ""; } };
/** Up to three distinct sites, in the order given. */
const sites = (us: { u: string }[]): string[] => Array.from(new Set(us.map((x) => siteOf(x.u)).filter(Boolean))).slice(0, 3);

// ---------- evidence ------------------------------------------------------------------------------------------------
export function claimFor(f: Facility, service: string): Claim | null {
  return f.cl.find((c) => c.s === service) ?? null;
}

/** P(service) and the list of named terms that produced it (largest first). */
export function serviceLogOdds(f: Facility, service: string): { p: number; terms: Contribution[] } {
  const c = claimFor(f, service);
  const level: ClaimLevel | "none" = c ? c.l : "none";
  // every term carries a message key so the interface can explain it in the person's language (lib/i18n)
  const baseKey: MsgKey = c ? LEVEL_TERM[level as ClaimLevel] : "whyNone";
  const svcEn = svcLabel(service, "en");
  const terms: Contribution[] = [{
    label: t("en", baseKey, { svc: svcEn }), delta: logit(W.prior[level]), k: baseKey, v: { svc: service },
    ...(c && sites(c.u).length ? { detail: t("en", "whyBaseDetail", { list: sites(c.u).join(", ") }), dk: "whyBaseDetail" as MsgKey, dv: { list: sites(c.u).join(", ") } } : {}),
  }];
  let total = terms[0].delta;
  // `v` holds the plain values (the service id stays an id so the interface can name it in the person's language)
  const add = (k: MsgKey, delta: number, detail?: { text: string; dk?: MsgKey; dv?: Vars }, v?: Vars) => {
    if (!delta) return;
    const en = v ? { ...v, ...(v.svc ? { svc: svcEn } : {}) } : undefined;
    terms.push({ label: t("en", k, en), delta, k, ...(v ? { v } : {}), ...(detail ? { detail: detail.text, dk: detail.dk, dv: detail.dv } : {}) });
    total += delta;
  };
  const keyed = (dk: MsgKey, dv: Vars) => ({ text: t("en", dk, dv), dk, dv });

  if (c) {
    add("whyFields", Math.min(W.extraFieldCap, W.perExtraField * Math.max(0, c.nf - 1)), keyed("whyFieldsDetail", { n: c.nf, list: c.f.join(", ") }), { svc: service, n: c.nf });
    if (c.sp) add("whySpecific", W.specificity);
    if (!c.pm) add("whyPrereq", W.prerequisitesMissing);
    if (c.ct.length) add("whyContra", Math.max(W.contradictionCap, W.perContradiction * c.ct.length), { text: c.ct[0] });   // data text, English only
    const named = c.u.filter((u) => u.n).length;
    if (named) add("whyNamed", Math.min(W.citationCap, W.perNamedCitation * named), undefined, { list: sites(c.u.filter((u) => u.n)).join(", ") });
  }
  if (f.ft != null) {
    // say what the score rests on, using only facts we hold about this facility
    const parts = [f.lt === "verified" ? "trustLocOk" : f.lt === "verified_osm" ? "trustLocOsm" : f.lt === "probable" ? "trustLocProbable" : "", f.ph.length ? "trustPhone" : "", f.ws ? "trustSite" : ""].filter(Boolean);
    const dv: Vars = { n: f.ft, parts: parts.join(","), site: f.ws ? siteOf(f.ws) : "" };
    add("whyTrust", ((f.ft - 70) / 100) * W.trustScale, { text: trustDetail(dv, "en"), dk: "whyTrustDetail", dv });
  }
  if (f.ms) add("whyMerge", W.perMergeSuspect * f.ms, keyed("whyMergeDetail", { n: f.ms }));

  // registry evidence, capped as a group
  let reg = 0;
  const regTerms: { k: MsgKey; delta: number }[] = [];
  if (f.rg && f.rg.t === "verified" && !f.rg.sus) {
    reg += W.registryIdentity;
    regTerms.push({ k: "whyRegistry", delta: W.registryIdentity });
    if (f.rg.svc.includes(service)) {
      reg += W.registryService;
      regTerms.push({ k: "whyRegistrySvc", delta: W.registryService });
    }
    if (f.rg.nabh) { reg += W.nabh; regTerms.push({ k: "whyNabh", delta: W.nabh }); }
  }
  const scale = reg > W.registryCap ? W.registryCap / reg : 1;
  for (const r of regTerms) add(r.k, r.delta * scale);

  if (f.wd) add("whyWikidata", W.wikidata);
  if (f.rt === "moderate") add("whyRecogModerate", W.recognitionModerate, keyed("whyRecogDetail", {}));
  if (f.rt === "high") add("whyRecogHigh", W.recognitionHigh, keyed("whyRecogDetail", {}));

  terms.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { p: sigmoid(total), terms };
}

// ---------- random numbers ------------------------------------------------------------------------------------------
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r: () => number) {
  const u = Math.max(r(), 1e-12), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function gammaSample(shape: number, r: () => number): number {
  if (shape < 1) return gammaSample(shape + 1, r) * Math.pow(r(), 1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = gauss(r), v = Math.pow(1 + c * x, 3);
    if (v > 0 && Math.log(r()) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}
// Acklam's inverse normal CDF
function invNorm(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  p = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - lo) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r2 = q * q;
  return ((((((a[0] * r2 + a[1]) * r2 + a[2]) * r2 + a[3]) * r2 + a[4]) * r2 + a[5]) * q) / (((((b[0] * r2 + b[1]) * r2 + b[2]) * r2 + b[3]) * r2 + b[4]) * r2 + 1);
}
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; };

// ---------- utilities -----------------------------------------------------------------------------------------------
export function costUtility(f: Facility, card: CardStatus): number {
  const gov = f.rg?.own === "government" || f.op === "public" || f.op === "government";
  let u = gov ? 0.8 : 0.35;
  const listed = !!f.rg && f.rg.t === "verified" && !f.rg.sus;
  if (listed) u += card === "yes" ? 0.6 : card === "unknown" ? 0.2 : 0;   // PM-JAY cashless cover only helps people who hold a card
  return Math.min(1, u);
}
export function comfortUtility(f: Facility): number {
  return 0.25 * (f.op === "private" ? 1 : 0) + 0.25 * (f.sz ? SIZE_COMFORT[f.sz] : 0.4) + 0.25 * Math.min((f.ne ?? 0) / 40, 1) + 0.25 * Math.min((f.nsp ?? 0) / 20, 1);
}
const governmentUtility = (f: Facility) => (f.rg?.own === "government" || f.op === "public" || f.op === "government" ? 1 : 0);

// ---------- ranking -------------------------------------------------------------------------------------------------
export interface RankInput {
  candidates: Facility[];
  services: { id: string; weight?: number }[];       // the first one is the primary need
  urgency: Urgency;
  preferences: Preferences;
  card: CardStatus;
  eta: Record<string, TrafficEta>;                   // by facility id
  distanceKm: Record<string, number>;
  fit?: Record<string, { fit: number; why: string }>;   // optional language-model fit by facility id (lib/rerank.ts)
  draws?: number;
  seed?: number;
}

export interface RankResult {
  ranked: RankedFacility[];
  picks: Picks;
  confidence: Confidence;
  notes: Msg[];
}

export function rank(input: RankInput): RankResult {
  const { candidates, services, urgency, card } = input;
  const N = input.draws ?? 2000;
  const r = rng(input.seed ?? 12345);
  const basePrefs = effectivePreferences(input.preferences, urgency);
  const tau = TAU_MINUTES[urgency];
  const primary = services[0]?.id ?? "trauma_emergency";
  const svcW = services.map((s) => s.weight ?? 1);
  const svcSum = svcW.reduce((a, b) => a + b, 0) || 1;
  const rho = W.copulaRho;

  const pre = candidates.map((f) => {
    const per = services.map((s) => serviceLogOdds(f, s.id));
    const mf = input.fit?.[f.id];
    if (mf && per[0]) {
      const c0 = claimFor(f, services[0].id);
      const evidenced = !!c0 && c0.l !== "Weak" && c0.l !== "Contradicted" && c0.ct.length === 0;
      let delta = (mf.fit - 0.5) * 2 * W.modelFit;
      if (delta > 0 && !evidenced) delta = 0;                       // the model can never rescue weak or contradicted evidence
      if (delta) {
        const k: MsgKey = delta > 0 ? "whyModelFitGood" : "whyModelFitWeak";
        per[0] = { p: sigmoid(logit(per[0].p) + delta), terms: [...per[0].terms, { label: t("en", k), delta, k, detail: mf.why }] };
      }
    }
    const lt = f.lt ?? "unknown";
    return {
      f, per, z: per.map((x) => invNorm(x.p)),
      pLoc: LOCATION_OK[lt] ?? 0.2, sigma: LOCATION_SIGMA_KM[lt] ?? 40,
      eta: input.eta[f.id], km: input.distanceKm[f.id] ?? 0,
      uTrust: ((f.ft ?? 60) / 100), uCost: costUtility(f, card), uComfort: comfortUtility(f), uGov: governmentUtility(f),
    };
  });

  // When care is needed soon, being much slower than the fastest hospital that can do it is not made up for by being bigger, nicer or
  // cheaper: once a hospital has solid evidence for the service, time decides, and trust, comfort and cost only break ties between
  // hospitals about equally far. (Found when "pregnancy" ranked a hospital 52 minutes away above a solid one 20 minutes away.)
  const guard = urgency === "emergency" ? { grace: 5, scale: 12 } : urgency === "urgent" ? { grace: 10, scale: 25 } : null;
  const solidEtas = pre.filter((c) => c.per[0] && c.per[0].p >= W.solid).map((c) => c.eta?.minutes ?? (c.km * 1.4) / 0.6);
  const etaFastestSolid = solidEtas.length ? Math.min(...solidEtas) : Infinity;

  const wins = new Array(pre.length).fill(0);
  const rankSum = new Array(pre.length).fill(0);
  const utils: number[][] = pre.map(() => []);
  const etas: number[][] = pre.map(() => []);
  const alpha = [basePrefs.speed, basePrefs.trust, basePrefs.cost, basePrefs.comfort, basePrefs.government].map((w) => Math.max(w * W.dirichletKappa, 0.05));

  for (let n = 0; n < N; n++) {
    const g = alpha.map((a) => gammaSample(a, r));
    const gs = g.reduce((a, b) => a + b, 0);
    const w: Preferences = { speed: g[0] / gs, trust: g[1] / gs, cost: g[2] / gs, comfort: g[3] / gs, government: g[4] / gs };
    let bestU = -1, bestI = -1;
    const draw: number[] = [];
    for (let i = 0; i < pre.length; i++) {
      const c = pre[i];
      const shared = gauss(r);
      let cover = 0, primaryOk = true;
      for (let k = 0; k < services.length; k++) {
        const zk = Math.sqrt(rho) * shared + Math.sqrt(1 - rho) * gauss(r);
        const ok = zk < c.z[k];
        if (k === 0) primaryOk = ok;
        cover += (ok ? 1 : 0) * svcW[k];
      }
      cover /= svcSum;
      const locOk = r() < c.pLoc;
      const extraKm = locOk ? 0 : Math.abs(gauss(r)) * c.sigma;
      const congestion = c.eta?.congestion ?? 1;
      const sd = Math.min(0.6, 0.12 + 0.25 * (congestion - 1));
      const eta = (c.eta?.minutes ?? (c.km * 1.4) / 0.6) * Math.exp(sd * gauss(r)) + extraKm * 1.4;      // 0.6 km/min is about 36 km/h
      const uTime = Math.exp(-eta / tau);
      const uTrust = c.uTrust * (locOk ? 1 : 0.5);
      let u = cover * (w.speed * uTime + w.trust * uTrust + w.cost * c.uCost + w.comfort * c.uComfort + w.government * c.uGov);
      if (!primaryOk) u *= 0.1;
      if (guard && etaFastestSolid < Infinity) u *= Math.exp(-Math.max(0, eta - etaFastestSolid - guard.grace) / guard.scale);
      if (urgency === "emergency" && !c.f.h24) u *= 0.6;
      draw.push(u);
      utils[i].push(u);
      etas[i].push(eta);
      if (u > bestU) { bestU = u; bestI = i; }
    }
    wins[bestI]++;
    const order = draw.map((u, i) => [u, i] as const).sort((a, b) => b[0] - a[0]);
    order.forEach(([, i], pos) => { rankSum[i] += pos + 1; });
  }

  const ranked: RankedFacility[] = pre.map((c, i) => {
    const pService: Record<string, number> = {}, contributions: Record<string, Contribution[]> = {}, claims: Record<string, Claim | null> = {};
    services.forEach((s, k) => { pService[s.id] = c.per[k].p; contributions[s.id] = c.per[k].terms; claims[s.id] = claimFor(c.f, s.id); });
    return {
      facility: c.f, pBest: wins[i] / N, rankMean: rankSum[i] / N,
      utility: utils[i].reduce((a, b) => a + b, 0) / N, utilityLow: quantile(utils[i], 0.1), utilityHigh: quantile(utils[i], 0.9),
      etaMinutes: quantile(etas[i], 0.5), etaLow: quantile(etas[i], 0.1), etaHigh: quantile(etas[i], 0.9),
      distanceKm: c.km, live: !!c.eta?.live, congestion: c.eta?.congestion ?? 1,
      pService, primaryPService: pService[primary] ?? 0, contributions, claims,
      solid: (pService[primary] ?? 0) >= W.solid && !(claims[primary]?.ct.length) && (claims[primary]?.pm ?? true),
    };
  });
  ranked.sort((a, b) => b.pBest - a.pBest || b.utility - a.utility);

  const viable = ranked.filter((x) => x.primaryPService >= W.minViable);
  const solid = viable.filter((x) => x.solid);
  const notes: Msg[] = [];
  let confidence: Confidence = "clear";
  if (!viable.length) { confidence = "none_reliable"; notes.push(msg("noteNoneReliable")); }
  else {
    if (!solid.length) notes.push(msg("noteOnlyWeak"));
    if ((solid[0] ?? viable[0]).pBest < W.clearWinner) { confidence = "several_similar"; notes.push(msg("noteSeveral")); }
  }

  // picks come from options with solid evidence; weaker ones are only used when nothing solid exists
  const pool = solid.length ? solid : viable;
  const pickBy = (score: (x: RankedFacility) => number) => (pool.length ? [...pool].sort((a, b) => score(b) - score(a))[0] : null);
  const picks: Picks = {
    best: pool[0] ?? null,
    fastest: pickBy((x) => -x.etaMinutes),
    mostTrusted: pickBy((x) => x.primaryPService * ((x.facility.ft ?? 60) / 100)),
    bestValue: pickBy((x) => costUtility(x.facility, card) * x.primaryPService),
    mostComfortable: pickBy((x) => comfortUtility(x.facility) * x.primaryPService),
  };
  return { ranked, picks, confidence, notes };
}

export { normalise };
