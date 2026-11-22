import { rerankFit } from "./rerank";
import "server-only";
import type { Claim, Contribution, DistrictInfo, Facility, Preferences, RankedFacility, ServiceId, Urgency } from "./types";
import { SERVICE_BY_ID } from "./services";
import { PERSONA_BY_ID, type CardStatus, type PersonaId } from "./preferences";
import { W, rank, serviceLogOdds } from "./ranking";
import { snapshot } from "./snapshot";
import { getEtas, type EtaResult } from "./traffic";
import { haversineKm } from "./geo";
import { reverse, lkey } from "./geocoder";
import { dataMsg, msg, type Msg, type MsgKey } from "./i18n";

export interface RecommendRequest {
  services: ServiceId[];
  urgency: Urgency;
  lat: number;
  lon: number;
  locationLabel?: string | null;
  persona?: PersonaId;
  preferences?: Partial<Preferences>;
  card?: CardStatus;
  need?: string | null;          // what the person described, in their own words or the model's summary of it
  maxResults?: number;
}

export interface EvidenceDto { service: ServiceId; label: string; level: string; p: number; snippets: { text: string; field: string }[]; sources: { url: string; kind: string; namesFacility: boolean }[]; fields: string[]; contradictions: string[]; notes: string[] }
export interface RegistryDto { tier: "verified" | "possible"; ownership: string | null; nabh: boolean; traumaBurn: boolean; hfrId: string | null; empanelledOn: string | null; services: string[]; specialties: string[]; asOf: string | null }
export interface ResultDto {
  id: string; name: string; type: string | null; ownership: string | null; sizeBand: string | null; city: string | null; district: string | null; state: string | null;
  lat: number; lon: number; distanceKm: number; etaMinutes: number; etaLow: number; etaHigh: number; congestion: number; liveTraffic: boolean;
  pBest: number; pService: number; solid: boolean; open24h: boolean;
  trust: { facility: number | null; location: string | null; locationPrecision: string | null };
  evidence: EvidenceDto[]; why: { baseline: Contribution; positive: Contribution[]; negative: Contribution[] };
  registry: RegistryDto | null; warnings: Msg[]; phones: string[]; website: string | null;
  tags: string[];
}
export interface RecommendResponse {
  urgency: Urgency; services: { id: ServiceId; label: string }[];
  location: { lat: number; lon: number; label: string | null };
  confidence: "clear" | "several_similar" | "none_reliable"; notes: Msg[];
  radiusKm: number; widenedFrom: number | null; candidatesConsidered: number;
  results: ResultDto[]; picks: Record<"best" | "fastest" | "mostTrusted" | "bestValue" | "mostComfortable", string | null>;
  traffic: { live: boolean; provider: string | null; note: Msg };
  coverage: { message: string | null; context: Msg[]; district: string | null; state: string | null };
  label: string; asOf: string | null; rankedBy: "evidence" | "evidence+model";
}

const RADII = [25, 50, 100, 200];
const SHORTLIST = 15;
const POSITIVE_TAIL = /^(Location verified|A matching place exists)/;

export function warningsFor(f: Facility, urgency: Urgency): Msg[] {
  const w: Msg[] = [];
  if ((f.ms ?? 0) >= 2) w.push(msg("warnMerged"));
  if ((f.ms ?? 0) >= 2 && f.cl.some((c) => c.u.some((u) => u.n))) w.push(msg("warnBranch"));
  if (f.lt === "approximate_pin" || f.lt === "approximate_district" || f.lt === "unverified") w.push(msg("warnApproxLocation"));
  if (f.rg?.t === "possible") w.push(msg("warnRegistryPossible"));
  if (urgency === "emergency" && !f.h24) w.push(msg("warnNot24h"));
  for (const r of f.rs) if (r.k === "contact" && /may belong to another|may combine/i.test(r.t)) { w.push(msg("warnPhones")); break; }
  // the data's own sentence (English) is kept for English; other languages get the generic caution
  for (const r of f.rs) if (r.k === "loc" && !POSITIVE_TAIL.test(r.t) && /probably wrong|differs from/i.test(r.t)) { w.push(dataMsg("warnLocationConflict", r.t)); break; }
  const seen = new Set<string>();
  return w.filter((m) => !seen.has(m.text) && !!seen.add(m.text)).slice(0, 4);
}

function evidenceFor(f: Facility, r: RankedFacility, services: ServiceId[]): EvidenceDto[] {
  return services.map((s) => {
    const c: Claim | null = r.claims[s] ?? null;
    return {
      service: s, label: SERVICE_BY_ID[s].en, level: c?.l ?? "No evidence found", p: Math.round((r.pService[s] ?? 0) * 100) / 100,
      snippets: (c?.sn ?? []).slice(0, 2).map((x) => ({ text: x.x, field: x.f })),
      sources: (c?.u ?? []).slice(0, 2).map((u) => ({ url: u.u, kind: u.c, namesFacility: u.n })),
      fields: c?.f ?? [], contradictions: c?.ct ?? [], notes: c?.cr ?? [],
    };
  });
}

const BASELINE_KEYS = new Set<MsgKey>(["whyStrong", "whyModerate", "whyInferred", "whyWeak", "whyContradicted", "whyNone"]);
function whyFor(r: RankedFacility, primary: string): ResultDto["why"] {
  const terms = r.contributions[primary] ?? [];
  const baseline = terms.find((t) => t.k && BASELINE_KEYS.has(t.k)) ?? { label: "No evidence found", delta: 0, k: "whyNone" as MsgKey };
  const rest = terms.filter((t) => t !== baseline);
  return { baseline, positive: rest.filter((t) => t.delta > 0).slice(0, 3), negative: rest.filter((t) => t.delta < 0).slice(0, 3) };
}

function districtContext(services: ServiceId[], d: DistrictInfo | undefined): Msg[] {
  if (!d) return [];
  const n = d.nfhs, out: Msg[] = [];
  const has = (...s: ServiceId[]) => services.some((x) => s.includes(x));
  if (has("obstetrics", "c_section", "nicu") && n.inst_birth != null) out.push(msg("ctxBirths", { district: d.name, pct: Math.round(n.inst_birth) }));
  if (has("c_section") && n.csection != null) out.push(msg("ctxCsection", { pct: Math.round(n.csection) }));
  if (has("dialysis", "cath_lab", "cardiac_surgery") && n.high_bp_women != null) out.push(msg("ctxBp", { district: d.name, pct: Math.round(n.high_bp_women) }));
  if (has("oncology", "linear_accelerator") && n.tobacco_men != null) out.push(msg("ctxTobacco", { district: d.name, pct: Math.round(n.tobacco_men) }));
  if (n.insurance != null) out.push(msg("ctxInsurance", { pct: Math.round(n.insurance) }));
  return out.slice(0, 3);
}

export async function recommend(req: RecommendRequest, deps: { traffic?: typeof getEtas; fit?: typeof rerankFit } = {}): Promise<RecommendResponse> {
  const snap = snapshot();
  const primary = req.services[0];
  const persona = PERSONA_BY_ID[req.persona ?? "everyone"] ?? PERSONA_BY_ID.everyone;
  const prefs: Preferences = { ...persona.weights, ...(req.preferences ?? {}) };
  const card: CardStatus = req.card ?? "unknown";

  // widen the radius until there are enough credible options
  let radius = RADII[0], viable: { f: Facility; km: number; p: number }[] = [], considered = 0, widenedFrom: number | null = null;
  for (const r of RADII) {
    radius = r;
    const near = snap.index.within(req.lat, req.lon, r);
    considered = near.length;
    viable = near.map(({ item, km }) => ({ f: item, km, p: serviceLogOdds(item, primary).p })).filter((x) => x.p >= W.minViable * 0.8);
    if (viable.length >= 6) break;
    if (widenedFrom === null) widenedFrom = r;
  }
  if (widenedFrom === radius) widenedFrom = null;
  const tauKm = req.urgency === "emergency" ? 12 : req.urgency === "urgent" ? 25 : 50;
  const short = viable.sort((a, b) => b.p * Math.exp(-b.km / tauKm) - a.p * Math.exp(-a.km / tauKm)).slice(0, SHORTLIST);

  const origin = { lat: req.lat, lon: req.lon };
  const eta: EtaResult = await (deps.traffic ?? getEtas)(origin, short.map((x) => ({ id: x.f.id, lat: x.f.la, lon: x.f.lo, straightKm: x.km })));
  const km = Object.fromEntries(short.map((x) => [x.f.id, x.km]));
  const fits = req.need ? await (deps.fit ?? rerankFit)(req.need, short.map((x) => x.f)) : null;
  const result = rank({ fit: fits ?? undefined, candidates: short.map((x) => x.f), services: req.services.map((id, i) => ({ id, weight: i === 0 ? 2 : 1 })), urgency: req.urgency, preferences: prefs, card, eta: eta.etas, distanceKm: km });

  const max = req.maxResults ?? 5;
  const viableRanked = result.ranked.filter((x) => x.primaryPService >= W.minViable);
  const top = [...viableRanked.filter((x) => x.solid), ...viableRanked.filter((x) => !x.solid)].slice(0, max);   // solid evidence first, weaker options after
  const registryAsOf = snap.meta.registry_list_as_of;
  const results: ResultDto[] = top.map((r) => {
    const f = r.facility, rg = f.rg;
    const registry: RegistryDto | null = rg && !rg.sus && (rg.t === "verified" || rg.t === "possible")
      ? { tier: rg.t, ownership: rg.own, nabh: rg.nabh, traumaBurn: rg.tb, hfrId: rg.hfr, empanelledOn: rg.dt, services: rg.svc, specialties: rg.sp, asOf: registryAsOf } : null;
    const tags: string[] = [];
    if (result.picks.fastest?.facility.id === f.id) tags.push("fastest");
    if (result.picks.mostTrusted?.facility.id === f.id) tags.push("most_trusted");
    if (result.picks.bestValue?.facility.id === f.id) tags.push("best_value");
    if (result.picks.mostComfortable?.facility.id === f.id) tags.push("most_comfortable");
    const nearestKm = Math.min(...short.map((x) => x.km));
    if (r.distanceKm === nearestKm) tags.push("closest");
    return {
      id: f.id, name: f.nm, type: f.ty, ownership: rg?.own ?? (f.op === "public" || f.op === "government" ? "government" : f.op), sizeBand: f.sz, city: f.ci, district: f.di, state: f.st,
      lat: f.la, lon: f.lo, distanceKm: Math.round(r.distanceKm * 10) / 10, etaMinutes: Math.round(r.etaMinutes), etaLow: Math.round(r.etaLow), etaHigh: Math.round(r.etaHigh),
      congestion: Math.round(r.congestion * 100) / 100, liveTraffic: r.live, pBest: Math.round(r.pBest * 100) / 100, pService: Math.round(r.primaryPService * 100) / 100, solid: r.solid, open24h: f.h24,
      trust: { facility: f.ft, location: f.lt, locationPrecision: f.lp }, evidence: evidenceFor(f, r, req.services), why: whyFor(r, primary),
      registry: registry && (registry.tier === "possible" || rg?.badge) ? registry : null,
      warnings: warningsFor(f, req.urgency), phones: f.ph, website: f.ws, tags,
    };
  });

  const rv = reverse(req.lat, req.lon);
  const dKey = rv?.state ? `${rv.state}|${lkey(rv.district)}` : null;
  const district = dKey ? snap.districts[dKey] : undefined;
  const notes = [...result.notes];
  if (widenedFrom) notes.push(msg("noteWidened", { from: widenedFrom, to: radius }));
  if (results.some((x) => !x.solid) && results.some((x) => x.solid)) notes.push(msg("noteWeakListed"));
  if (results.length && results.every((x) => x.warnings.length)) notes.push(msg("noteAllCaution"));
  if (fits) notes.push(msg("noteModelUsed"));

  return {
    urgency: req.urgency, services: req.services.map((id) => ({ id, label: SERVICE_BY_ID[id].en })),
    location: { lat: req.lat, lon: req.lon, label: req.locationLabel ?? null },
    confidence: result.confidence, notes, radiusKm: radius, widenedFrom, candidatesConsidered: considered,
    rankedBy: fits ? "evidence+model" : "evidence", results, picks: {
      best: result.picks.best?.facility.id ?? null, fastest: result.picks.fastest?.facility.id ?? null, mostTrusted: result.picks.mostTrusted?.facility.id ?? null,
      bestValue: result.picks.bestValue?.facility.id ?? null, mostComfortable: result.picks.mostComfortable?.facility.id ?? null,
    },
    traffic: { live: eta.live, provider: eta.provider, note: eta.noteKey ? msg(eta.noteKey) : { k: "trafficNoteEst", text: eta.note } },
    coverage: { message: district?.msg ?? null, context: districtContext(req.services, district), district: district?.name ?? rv?.district ?? null, state: rv?.state ?? null },
    label: "Evidence-weighted estimate, not a guarantee. Always confirm by phone before you travel.", asOf: snap.meta.built,
  };
}

export { haversineKm };
