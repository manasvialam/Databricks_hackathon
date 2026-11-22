import "server-only";
import { geocode } from "./geocoder";
import { inIndia } from "./geo";

/**
 * Address suggestions while typing. Two sources, merged: the app's own PIN and place data (instant, offline-safe: a 6-digit PIN or a
 * town name) and OpenStreetMap through Photon (street and landmark level, any address in India). The typed text is sent to Photon by
 * this server, never by the browser, so the person's address and device are not exposed to it; nothing is stored.
 */
export interface PlaceSuggestion { label: string; sub: string; lat: number; lon: number; kind: "pin" | "place" | "address" }

const PHOTON = "https://photon.komoot.io/api/";
const INDIA_BBOX = "68.1,6.5,97.5,37.2";
const cache = new Map<string, { at: number; v: PlaceSuggestion[] }>();
const TTL = 10 * 60_000;
export function _clearPlaceCache() { cache.clear(); }

interface PhotonFeature { geometry?: { coordinates?: [number, number] }; properties?: Record<string, string | undefined> }

const uniq = (a: (string | undefined)[]) => a.filter((x, i): x is string => !!x && a.indexOf(x) === i);

export function fromPhoton(features: PhotonFeature[]): PlaceSuggestion[] {
  const out: PlaceSuggestion[] = [];
  for (const f of features) {
    const p = f.properties ?? {}, c = f.geometry?.coordinates;
    if (!c || p.countrycode !== "IN" || !inIndia(c[1], c[0])) continue;
    const street = [p.housenumber, p.street].filter(Boolean).join(" ");
    const label = p.name ?? (street || p.district || p.city);
    if (!label) continue;
    const sub = uniq([street && street !== label ? street : undefined, p.district, p.city, p.county, p.state, p.postcode]).filter((x) => x !== label).join(", ");
    out.push({ label, sub, lat: c[1], lon: c[0], kind: "address" });
  }
  return out;
}

async function photon(q: string, near?: { lat: number; lon: number }): Promise<PlaceSuggestion[]> {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 3500);
  try {
    const url = `${PHOTON}?q=${encodeURIComponent(q)}&limit=7&lang=en&bbox=${INDIA_BBOX}${near ? `&lat=${near.lat}&lon=${near.lon}` : ""}`;
    const res = await fetch(url, { signal: c.signal, headers: { "User-Agent": "facility-finder/0.1 (hospital finder; address suggestions)" } });
    if (!res.ok) return [];
    return fromPhoton(((await res.json()) as { features?: PhotonFeature[] }).features ?? []);
  } catch { return []; } finally { clearTimeout(timer); }
}

/** What the app's own data knows: a PIN code, or a town name (several, when the name is shared by places in different states). */
export function localSuggestions(q: string): PlaceSuggestion[] {
  const g = geocode(q);
  if (g.status === "ok") {
    const sub = [g.district, g.state].filter(Boolean).join(", ");
    return [{ label: g.matched, sub, lat: g.lat, lon: g.lon, kind: /^\d{6}$/.test(q.replace(/\s/g, "")) ? "pin" : "place" }];
  }
  if (g.status === "ambiguous") return g.candidates.slice(0, 4).map((c) => ({ label: c.label, sub: `${c.district}, ${c.state}`, lat: c.lat, lon: c.lon, kind: "place" as const }));
  return [];
}

export async function suggestPlaces(q: string, near?: { lat: number; lon: number }): Promise<PlaceSuggestion[]> {
  const key = `${q.toLowerCase()}|${near ? near.lat.toFixed(1) + "," + near.lon.toFixed(1) : ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const local = localSuggestions(q);
  const remote = q.replace(/\s/g, "").length >= 3 ? await photon(q, near) : [];
  const seen = new Set<string>();
  const merged = [...local, ...remote].filter((s) => { const k = `${s.label}|${s.lat.toFixed(3)}|${s.lon.toFixed(3)}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
  cache.set(key, { at: Date.now(), v: merged });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return merged;
}
