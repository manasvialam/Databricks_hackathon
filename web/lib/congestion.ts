/**
 * Typical travel time for Indian roads, by area and hour of day. There is no free live-traffic source, so this is a model of the
 * usual pattern, labelled as such in the UI ("typical, not live").
 *
 * 1. Free-flow time comes from OpenStreetMap routing (lib/routing.ts). Its car profile is too optimistic for Indian city roads
 *    (it gave 52 km/h for a 9.5 km Chennai trip), so it is scaled by `friction`: 1.20 in the big metros, 1.15 in cities, 1.10 in
 *    towns, 1.0 in the countryside. The metro value is solved from published rush-hour speeds: Bengaluru 16.6 km/h evening and
 *    morning 18 km/h, Delhi 21.5 km/h morning and 18.9 km/h evening (TomTom Traffic Index 2024 and 2025 coverage).
 * 2. Congestion level = average extra travel time compared with free flow over a whole year (TomTom Traffic Index 2025):
 *    Bengaluru 74.4%, Mumbai 63.2%, Delhi 60.2%, Chennai 58.6%, Hyderabad 55.5%. Everywhere else it is estimated from how built-up
 *    the area is (the number of facilities in our data within 5 km).
 * 3. The day profile spreads that average over the hours: night near free flow, sharp morning and evening peaks. Its mean is 1,
 *    so the all-day average matches the published figure.
 * Result: minutes = free-flow x friction x (1 + congestion x profile[hour]) + 1 (starting and parking).
 */
export interface Area { name: string | null; tier: "metro" | "city" | "town" | "rural"; base: number; friction: number; source: "tomtom2025" | "estimated" }

const METROS: { name: string; lat: number; lon: number; km: number; base: number }[] = [
  { name: "Bengaluru", lat: 12.9716, lon: 77.5946, km: 28, base: 0.744 },
  { name: "Mumbai", lat: 19.076, lon: 72.8777, km: 32, base: 0.632 },
  { name: "Delhi", lat: 28.6139, lon: 77.209, km: 38, base: 0.602 },
  { name: "Chennai", lat: 13.0827, lon: 80.2707, km: 26, base: 0.586 },
  { name: "Hyderabad", lat: 17.385, lon: 78.4867, km: 28, base: 0.555 },
];
const TIERS = { metro: { friction: 1.2, base: 0.5 }, city: { friction: 1.15, base: 0.3 }, town: { friction: 1.1, base: 0.15 }, rural: { friction: 1.0, base: 0.06 } } as const;

const km = (a: number, b: number, c: number, d: number) => {
  const r = Math.PI / 180, dl = (c - a) * r, dn = (d - b) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dn / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
};

/** `facilitiesNear`: how many facilities in our data lie within 5 km, a proxy for how built-up the place is. */
export function areaFor(lat: number, lon: number, facilitiesNear: number): Area {
  const m = METROS.find((x) => km(lat, lon, x.lat, x.lon) <= x.km);
  if (m) return { name: m.name, tier: "metro", base: m.base, friction: TIERS.metro.friction, source: "tomtom2025" };
  const tier = facilitiesNear >= 80 ? "metro" : facilitiesNear >= 30 ? "city" : facilitiesNear >= 8 ? "town" : "rural";
  // an unlisted built-up area is treated as a city: only the named metros carry the big-metro friction
  const t = tier === "metro" ? "city" : tier;
  return { name: null, tier: t, base: facilitiesNear >= 80 ? 0.45 : TIERS[t].base, friction: TIERS[t].friction, source: "estimated" };
}

const RAW = [0.15, 0.15, 0.15, 0.15, 0.15, 0.4, 0.7, 1.3, 2.0, 2.0, 2.0, 1.1, 1.1, 1.1, 1.1, 1.1, 1.5, 2.1, 2.1, 2.1, 2.1, 0.9, 0.4, 0.2];
const MEAN = RAW.reduce((a, b) => a + b, 0) / RAW.length;
export const DAY_PROFILE = RAW.map((x) => x / MEAN);

export const istHour = (d = new Date()) => (d.getUTCHours() + 5 + (d.getUTCMinutes() >= 30 ? 1 : 0)) % 24;

/** Multiplier on free-flow driving time at an hour of day (1 = free flow). */
export const timeFactor = (a: Area, hour: number) => 1 + a.base * DAY_PROFILE[((hour % 24) + 24) % 24];

export type TrafficLevel = "light" | "moderate" | "heavy" | "severe";
export const levelOf = (factor: number): TrafficLevel => (factor < 1.25 ? "light" : factor < 1.6 ? "moderate" : factor < 2.0 ? "heavy" : "severe");

/**
 * Short trips are slower per kilometre than the routing engine thinks: junctions, two-wheelers, autos, pedestrians and the walk from the
 * parking spot dominate. So door-to-door time is never faster than a ceiling on average speed that depends on the trip length
 * (22 km/h under 3 km, 26 km/h up to 8 km, 32 km/h up to 20 km in towns and cities; a little higher in the countryside) plus 1.5 minutes
 * to start and park. Our assumption, checked against the rule of thumb that 0.7 km takes about 3 minutes; not measured data.
 */
export function urbanFloor(km: number, a: Area): number {
  const rural = a.tier === "rural";
  const v = km < 3 ? (rural ? 28 : 22) : km < 8 ? (rural ? 32 : 26) : km < 20 ? (rural ? 38 : 32) : Infinity;
  return v === Infinity ? 0 : (60 * km) / v + 1.5;
}

/** Driving minutes for a free-flow time (minutes, from OpenStreetMap routing) and its road distance at an hour. At least 2. */
export const driveMinutes = (freeFlowMin: number, a: Area, hour: number, km = 0) =>
  Math.max(2, Math.round(Math.max(freeFlowMin * a.friction * timeFactor(a, hour) + 1, urbanFloor(km, a))));

export interface TrafficInfo { area: string | null; tier: Area["tier"]; source: Area["source"]; hour: number; factor: number; level: TrafficLevel; hourly: number[] }
export function trafficInfo(a: Area, date = new Date()): TrafficInfo {
  const hour = istHour(date);
  const factor = timeFactor(a, hour);
  return { area: a.name, tier: a.tier, source: a.source, hour, factor: Math.round(factor * 100) / 100, level: levelOf(factor), hourly: DAY_PROFILE.map((_, h) => Math.round(timeFactor(a, h) * 100) / 100) };
}
