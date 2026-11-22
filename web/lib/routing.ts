import "server-only";

/**
 * Road distance and driving time from OpenStreetMap data through an OSRM server. No API key. The public demo server
 * (router.project-osrm.org) is for light use, so results are cached and callers keep a straight-line fallback; for real
 * traffic set OSRM_URL to your own instance, or use TRAFFIC_PROVIDER=google|mapbox (lib/traffic.ts) for live traffic.
 * Set OSRM_URL=off to disable. OSRM times are free-flow: they do not include live congestion.
 */
export interface LatLon { lat: number; lon: number }
export interface RoadLeg { km: number; minutes: number }   // minutes are OSRM free-flow time, fractional; lib/congestion.ts turns them into realistic Indian driving time
export interface RouteStep { text: string; km: number }
export interface RoadRoute extends RoadLeg { geometry: [number, number][]; steps: RouteStep[] }   // geometry is [lon, lat]

const base = () => (process.env.OSRM_URL ?? "https://router.project-osrm.org").replace(/\/+$/, "");
export const routingEnabled = () => process.env.OSRM_URL !== "off" && !process.env.VITEST;

async function getJson(url: string, ms: number): Promise<unknown | null> {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { "User-Agent": "facility-finder-hackathon" }, cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

const coord = (p: LatLon) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`;
const cache = new Map<string, { at: number; v: unknown }>();
const TTL = 10 * 60_000;
const remember = <T,>(k: string, v: T): T => { cache.set(k, { at: Date.now(), v }); if (cache.size > 500) cache.delete(cache.keys().next().value as string); return v; };
const recall = <T,>(k: string): T | undefined => { const h = cache.get(k); return h && Date.now() - h.at < TTL ? (h.v as T) : undefined; };
export function _clearRoutingCache() { cache.clear(); }

/** One request for the road distance and time from `origin` to every destination (at most 24). null entries: no road found. */
export async function osrmTable(origin: LatLon, dests: (LatLon & { id: string })[], ms = 4500): Promise<(RoadLeg | null)[] | null> {
  if (!routingEnabled() || !dests.length || dests.length > 24) return null;
  const key = `t|${origin.lat.toFixed(3)},${origin.lon.toFixed(3)}|${dests.map((d) => d.id).join(",")}`;
  const hit = recall<(RoadLeg | null)[]>(key);
  if (hit) return hit;
  const url = `${base()}/table/v1/driving/${[origin, ...dests].map(coord).join(";")}?sources=0&annotations=duration,distance`;
  const j = (await getJson(url, ms)) as { code?: string; durations?: (number | null)[][]; distances?: (number | null)[][] } | null;
  if (!j || j.code !== "Ok" || !j.durations?.[0] || !j.distances?.[0]) return null;
  const out = dests.map((_, i) => {
    const s = j.durations![0][i + 1], m = j.distances![0][i + 1];
    return typeof s === "number" && typeof m === "number" ? { km: Math.round(m / 100) / 10, minutes: Math.max(0.3, Math.round(s / 6) / 10) } : null;
  });
  return remember(key, out);
}

const DIR: Record<string, string> = { left: "left", right: "right", "slight left": "slightly left", "slight right": "slightly right", "sharp left": "sharp left", "sharp right": "sharp right", straight: "straight", uturn: "back" };

interface OsrmStep { distance: number; name?: string; maneuver?: { type?: string; modifier?: string } }
export function stepText(s: OsrmStep): string {
  const type = s.maneuver?.type ?? "", mod = s.maneuver?.modifier ? DIR[s.maneuver.modifier] ?? s.maneuver.modifier : "";
  const on = s.name ? ` onto ${s.name}` : "";
  switch (type) {
    case "depart": return `Head ${mod || "out"}${s.name ? ` on ${s.name}` : ""}`;
    case "arrive": return "Arrive at the hospital";
    case "turn": case "end of road": return `Turn ${mod}${on}`.trim();
    case "fork": return `Keep ${mod}${on}`.trim();
    case "roundabout": case "rotary": return `Take the roundabout${on}`;
    case "merge": case "on ramp": case "off ramp": return `Continue ${mod || "ahead"}${on}`.trim();
    default: return `Continue${s.name ? ` on ${s.name}` : ""}`;
  }
}

/** The driving route between two points with its line for a map and a short list of turns. null when unreachable. */
export async function osrmRoute(a: LatLon, b: LatLon, ms = 7000): Promise<RoadRoute | null> {
  if (!routingEnabled()) return null;
  const key = `r|${coord(a)}|${coord(b)}`;
  const hit = recall<RoadRoute>(key);
  if (hit) return hit;
  const j = (await getJson(`${base()}/route/v1/driving/${coord(a)};${coord(b)}?overview=full&geometries=geojson&steps=true`, ms)) as {
    code?: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: { steps: OsrmStep[] }[] }[];
  } | null;
  const r = j?.code === "Ok" ? j.routes?.[0] : undefined;
  if (!r) return null;
  const steps = r.legs.flatMap((l) => l.steps).filter((s, i, all) => s.distance > 30 || i === all.length - 1).slice(0, 12)
    .map((s) => ({ text: stepText(s), km: Math.round(s.distance / 100) / 10 }));
  return remember<RoadRoute>(key, { km: Math.round(r.distance / 100) / 10, minutes: Math.max(0.3, Math.round(r.duration / 6) / 10), geometry: r.geometry.coordinates, steps });
}
