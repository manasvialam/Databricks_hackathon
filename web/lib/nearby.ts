import "server-only";
import type { ServiceId } from "./types";
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
