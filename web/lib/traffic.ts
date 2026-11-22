import "server-only";
import type { TrafficEta } from "./types";

/**
 * Travel time with live traffic, for a short list of candidates only.
 *
 * Provider is chosen by env (TRAFFIC_PROVIDER = google | mapbox | none, key in TRAFFIC_API_KEY). The Google and Mapbox
 * adapters follow each vendor's documented response shape but have NOT been run against a real key yet: the plan's
 * day-0 step is to test about 10 Indian routes (urban and rural) and pick one. Until then, and whenever a call fails,
 * times out or the daily quota is used up, a heuristic is used and the result is labelled "estimated, no live traffic".
 */
export interface LatLon { lat: number; lon: number }
export interface Dest extends LatLon { id: string }
export interface EtaResult { etas: Record<string, TrafficEta>; live: boolean; provider: string | null; note: string }

// ---------- heuristic -----------------------------------------------------------------------------------------------
export function peakFactor(date = new Date()): number {
  const ist = (date.getUTCHours() + 5 + (date.getUTCMinutes() + 30 >= 60 ? 1 : 0)) % 24;
  if ((ist >= 8 && ist < 11) || (ist >= 17 && ist < 20)) return 1.35;
  if (ist >= 11 && ist < 17) return 1.1;
  if (ist >= 22 || ist < 5) return 0.9;
  return 1.0;
}

export function heuristicEta(straightKm: number, date = new Date()): TrafficEta {
  const road = straightKm * 1.4;                                   // roads are longer than the straight line
  const speed = straightKm < 10 ? 30 : straightKm < 50 ? 40 : 50;  // km/h
  const free = (road / speed) * 60 + 3;                            // 3 minutes to start and park
  const f = peakFactor(date);
  return { minutes: free * f, freeFlowMinutes: free, live: false, congestion: f };
}

// ---------- adapters ------------------------------------------------------------------------------------------------
const secs = (s: string | undefined) => (s ? parseFloat(s.replace("s", "")) : NaN);

async function withTimeout(url: string, init: RequestInit, ms = 3500): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...init, signal: c.signal }); } finally { clearTimeout(t); }
}

export async function googleEtas(origin: LatLon, dests: Dest[], key: string): Promise<Record<string, TrafficEta>> {
  const wp = (p: LatLon) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lon } } } });
  const res = await withTimeout("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "originIndex,destinationIndex,duration,staticDuration,condition" },
    body: JSON.stringify({ origins: [wp(origin)], destinations: dests.map(wp), travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE" }),
  });
  if (!res.ok) throw new Error(`google routes ${res.status}`);
  const rows = (await res.json()) as { destinationIndex?: number; duration?: string; staticDuration?: string; condition?: string }[];
  const out: Record<string, TrafficEta> = {};
  for (const r of rows) {
    if (r.condition && r.condition !== "ROUTE_EXISTS") continue;
    const d = dests[r.destinationIndex ?? -1];
    const live = secs(r.duration) / 60, free = secs(r.staticDuration) / 60;
    if (d && Number.isFinite(live)) out[d.id] = { minutes: live, freeFlowMinutes: Number.isFinite(free) ? free : null, live: true, congestion: Number.isFinite(free) && free > 0 ? Math.max(1, live / free) : 1 };
  }
  return out;
}

export async function mapboxEtas(origin: LatLon, dests: Dest[], token: string): Promise<Record<string, TrafficEta>> {
  const out: Record<string, TrafficEta> = {};
  for (let i = 0; i < dests.length; i += 9) {                       // the traffic matrix allows 10 coordinates in total
    const chunk = dests.slice(i, i + 9);
    const coords = [origin, ...chunk].map((p) => `${p.lon},${p.lat}`).join(";");
    const q = `?sources=0&destinations=${chunk.map((_, k) => k + 1).join(";")}&annotations=duration&access_token=${token}`;
    const [live, free] = await Promise.all(["driving-traffic", "driving"].map(async (profile) => {
      const r = await withTimeout(`https://api.mapbox.com/directions-matrix/v1/mapbox/${profile}/${coords}${q}`, {});
      if (!r.ok) throw new Error(`mapbox ${profile} ${r.status}`);
      return ((await r.json()) as { durations: (number | null)[][] }).durations[0];
    }));
    chunk.forEach((d, k) => {
      const l = live[k], f = free[k];
      if (l != null) out[d.id] = { minutes: l / 60, freeFlowMinutes: f != null ? f / 60 : null, live: true, congestion: f ? Math.max(1, l / f) : 1 };
    });
  }
  return out;
}

// ---------- cache, quota, entry point -------------------------------------------------------------------------------
const cache = new Map<string, { at: number; eta: TrafficEta }>();
const TTL_MS = 5 * 60 * 1000;
let quota = { day: "", used: 0 };
const dailyLimit = () => Number(process.env.TRAFFIC_DAILY_LIMIT ?? 400);

function underQuota(): boolean {
  const day = new Date().toISOString().slice(0, 10);
  if (quota.day !== day) quota = { day, used: 0 };
  return quota.used < dailyLimit();
}

export function _resetTrafficForTests() { cache.clear(); quota = { day: "", used: 0 }; }

export async function getEtas(
  origin: LatLon, dests: (Dest & { straightKm: number })[],
  deps: { fetchLive?: (o: LatLon, d: Dest[]) => Promise<Record<string, TrafficEta>>; now?: Date } = {},
): Promise<EtaResult> {
  const now = deps.now ?? new Date();
  const provider = (process.env.TRAFFIC_PROVIDER ?? "none").toLowerCase();
  const key = process.env.TRAFFIC_API_KEY;
  const etas: Record<string, TrafficEta> = {};
  const bucket = Math.floor(now.getTime() / TTL_MS);
  const ck = (id: string) => `${origin.lat.toFixed(2)},${origin.lon.toFixed(2)}|${id}|${bucket}`;
  const need: typeof dests = [];
  for (const d of dests) {
    const hit = cache.get(ck(d.id));
    if (hit && now.getTime() - hit.at < TTL_MS) etas[d.id] = hit.eta; else need.push(d);
  }
  let note = "Estimated travel time, no live traffic.";
  let live = Object.values(etas).some((e) => e.live);
  const fetchLive = deps.fetchLive ?? (provider === "google" && key ? (o: LatLon, d: Dest[]) => googleEtas(o, d, key) : provider === "mapbox" && key ? (o: LatLon, d: Dest[]) => mapboxEtas(o, d, key) : null);

  if (need.length && fetchLive && underQuota()) {
    try {
      quota.used++;
      const got = await fetchLive(origin, need);
      for (const d of need) if (got[d.id]) { etas[d.id] = got[d.id]; cache.set(ck(d.id), { at: now.getTime(), eta: got[d.id] }); }
      live = true;
      note = "Travel time uses live traffic.";
    } catch {
      note = "Live traffic was unavailable, so travel times are estimated.";
    }
  } else if (need.length && fetchLive) {
    note = "The live-traffic allowance for today is used up, so travel times are estimated.";
  }
  for (const d of dests) if (!etas[d.id]) etas[d.id] = heuristicEta(d.straightKm, now);
  if (live && Object.values(etas).some((e) => !e.live)) note = "Live traffic for most options; a few are estimated.";
  return { etas, live, provider: live ? provider : null, note };
}
