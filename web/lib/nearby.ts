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

/**
 * The default list when someone gives a place (or a need we could not map to one service): hospitals themselves,
 * nearest first, each tagged with the services we have solid evidence for. Facilities with no confirmed service
 * are kept but sorted after, because "nothing confirmed" is not the same as "does not offer it".
 */
export function nearbyHospitals(lat: number, lon: number, limit = 12): { hospitals: NearbyHospital[]; radiusKm: number } {
  const types = new Set(["hospital", "nursing_home", null]);
  let radius = 10, near: { item: Facility; km: number }[] = [];
  for (const r of [10, 25, 50, 100]) {
    radius = r;
    near = snapshot().index.within(lat, lon, r).filter(({ item }) => types.has(item.ty));
    if (near.length >= limit) break;
  }
  const rows = near.map(({ item: f, km }) => ({ f, km, services: solidServices(f) }));
  rows.sort((a, b) => (a.km + (a.services.length ? 0 : 12)) - (b.km + (b.services.length ? 0 : 12)));
  const hospitals = rows.slice(0, limit).map(({ f, km, services }): NearbyHospital => ({
    id: f.id, name: f.nm, type: f.ty, ownership: f.op, city: f.ci, district: f.di, state: f.st, lat: f.la, lon: f.lo,
    km: Math.round(km * 10) / 10, open24h: f.h24, phone: f.ph[0] ?? null, services,
    registry: f.rg && !f.rg.sus ? (f.rg.badge ? "verified" : f.rg.t === "possible" ? "possible" : null) : null,
    nabh: !!f.rg?.nabh, empanelledOn: f.rg?.dt ?? null, warnings: warningsFor(f, "routine"),
  }));
  return { hospitals, radiusKm: radius };
}
