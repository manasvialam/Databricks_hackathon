import "server-only";
import type { Facility, ServiceId } from "./types";
import type { Msg } from "./i18n";
import { warningsFor } from "./recommend";
import { SERVICES } from "./services";
import { serviceLogOdds, W } from "./ranking";
import { snapshot } from "./snapshot";

export interface NearbyService { id: ServiceId; label: string; plain: string; urgent: boolean; count: number; nearestKm: number | null }

/**
 * "What is available near you": for each service, how many facilities within the radius have solid evidence for it.
 * Shown before the person has said anything, as entry points. Counts are of facilities in our data, not of all facilities.
 */
export function nearbyServices(lat: number, lon: number, radiusKm = 25): { services: NearbyService[]; facilitiesInRadius: number } {
  const near = snapshot().index.within(lat, lon, radiusKm);
  const out: NearbyService[] = SERVICES.map((s) => {
    const hits = near.filter(({ item }) => {
      const c = item.cl.find((x) => x.s === s.id);
      return !!c && c.l !== "Weak" && c.l !== "Contradicted" && c.ct.length === 0 && serviceLogOdds(item, s.id).p >= W.solid;
    });
    return { id: s.id, label: s.en, plain: s.plain, urgent: s.urgentByNature, count: hits.length, nearestKm: hits.length ? Math.round(hits[0].km * 10) / 10 : null };
  });
  out.sort((a, b) => Number(b.count > 0) - Number(a.count > 0) || Number(b.urgent) - Number(a.urgent) || b.count - a.count);
  return { services: out, facilitiesInRadius: near.length };
}

export interface NearbyHospital {
  id: string; name: string; type: string | null; ownership: string | null; city: string | null; district: string | null; state: string | null;
  lat: number; lon: number; km: number; open24h: boolean; phone: string | null;
  services: ServiceId[];                                  // services with solid evidence, strongest first
  specialties: string[];                                  // plain-language specialty categories, the ones matching the need first
  matched: string[];                                      // which of the specialties the person's need points to
  roadKm?: number; minutes?: number; freeMinutes?: number;                      // road distance and driving time from OpenStreetMap routing, when available
  registry: "verified" | "possible" | null;
  nabh: boolean;
  empanelledOn: string | null;
  fit?: number; fitWhy?: Msg;                             // set by the language model for needs that map to no service (client side)
  warnings: Msg[];                                        // same cautions the recommendation card shows (merged records, approximate map position, ...)
}

export const solidServices = (f: Facility): ServiceId[] =>
  SERVICES.filter((s) => {
    const c = f.cl.find((x) => x.s === s.id);
    return !!c && c.l !== "Weak" && c.l !== "Contradicted" && c.ct.length === 0 && serviceLogOdds(f, s.id).p >= W.solid;
  }).sort((a, b) => Number(b.urgentByNature) - Number(a.urgentByNature)).map((s) => s.id);

/** Specialty categories for a facility: its listed ones, plus emergency care when it has solid evidence for emergency, ICU or ventilator. */
function specialtiesOf(f: Facility, services: ServiceId[]): string[] {
  const out = [...(f.sc ?? [])];
  if (!out.includes("emergency") && services.some((s) => s === "trauma_emergency" || s === "icu" || s === "ventilator")) out.push("emergency");
  return out;
}

/**
 * The default list when someone gives a place, or a need we could not map to one service: hospitals themselves, nearest first.
 * With `want` (specialty categories the need points to, see lib/specialty.ts) the hospitals that list the first one come first,
 * then those listing any of them, then the rest, each group nearest first, so "knee pain" and "skin rash" return different hospitals.
 * "General medicine" is listed by almost every record, so it never counts as a match on its own.
 */
export function nearbyHospitals(lat: number, lon: number, limit = 12, want: string[] = []): { hospitals: NearbyHospital[]; radiusKm: number; matchedCount: number } {
  const types = new Set(["hospital", "nursing_home", null]);
  const weak = new Set(["general"]);
  const useful = want.filter((w) => !weak.has(w) || want.length === 1);
  let radius = 10, near: { item: Facility; km: number }[] = [], matchedCount = 0;
  for (const r of [10, 25, 50, 100]) {
    radius = r;
    near = snapshot().index.within(lat, lon, r).filter(({ item }) => types.has(item.ty));
    matchedCount = useful.length ? near.filter(({ item }) => useful.some((w) => item.sc?.includes(w))).length : near.length;
    if (matchedCount >= limit || (!useful.length && near.length >= limit)) break;
  }
  const rows = near.map(({ item: f, km }) => {
    const services = solidServices(f), sc = specialtiesOf(f, services);
    const idx = useful.length ? useful.map((w) => sc.indexOf(w)) : [];
    const group = !useful.length ? 0 : idx[0] >= 0 ? 0 : idx.some((i) => i >= 0) ? 1 : 2;
    const best = idx.filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
    return { f, km, services, sc, group, key: km + (useful.length ? best * 1.5 : services.length ? 0 : 12) };
  });
  rows.sort((a, b) => a.group - b.group || a.key - b.key);
  const hospitals = rows.slice(0, limit).map(({ f, km, services, sc }): NearbyHospital => {
    const matched = useful.filter((w) => sc.includes(w));
    const rest = sc.filter((x) => !matched.includes(x) && x !== "general");
    const specialties = [...matched, ...rest, ...(!matched.length && !rest.length && sc.includes("general") ? ["general"] : [])].slice(0, 8);
    return {
      id: f.id, name: f.nm, type: f.ty, ownership: f.op, city: f.ci, district: f.di, state: f.st, lat: f.la, lon: f.lo,
      km: Math.round(km * 10) / 10, open24h: f.h24, phone: f.ph[0] ?? null, services, specialties, matched,
      registry: f.rg && !f.rg.sus ? (f.rg.badge ? "verified" : f.rg.t === "possible" ? "possible" : null) : null,
      nabh: !!f.rg?.nabh, empanelledOn: f.rg?.dt ?? null, warnings: warningsFor(f, "routine"),
    };
  });
  return { hospitals, radiusKm: radius, matchedCount };
}
