import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetTrafficForTests, getEtas, googleEtas, heuristicEta, mapboxEtas, peakFactor } from "@/lib/traffic";

const dests = [
  { id: "a", lat: 25.7, lon: 85.2, straightKm: 5 },
  { id: "b", lat: 26.0, lon: 85.5, straightKm: 40 },
];
const origin = { lat: 25.6, lon: 85.1 };

beforeEach(() => { _resetTrafficForTests(); vi.restoreAllMocks(); delete process.env.TRAFFIC_PROVIDER; delete process.env.TRAFFIC_API_KEY; });

describe("heuristic", () => {
  it("grows with distance and is worse at the evening peak than at night", () => {
    expect(heuristicEta(40).minutes).toBeGreaterThan(heuristicEta(5).minutes);
    const peak = new Date("2026-11-21T12:00:00Z"); // 17:30 IST
    const night = new Date("2026-11-21T20:00:00Z"); // 01:30 IST
    expect(peakFactor(peak)).toBeGreaterThan(peakFactor(night));
    expect(heuristicEta(10, peak).minutes).toBeGreaterThan(heuristicEta(10, night).minutes);
    expect(heuristicEta(10).live).toBe(false);
  });
});

describe("getEtas", () => {
  it("falls back to estimates and says so when no provider is configured", async () => {
    const r = await getEtas(origin, dests);
    expect(r.live).toBe(false);
    expect(r.provider).toBeNull();
    expect(r.note).toMatch(/no live traffic/i);
    expect(Object.keys(r.etas)).toEqual(["a", "b"]);
  });

  it("uses live results, caches them, and does not call again within five minutes", async () => {
    const fetchLive = vi.fn(async () => ({ a: { minutes: 30, freeFlowMinutes: 12, live: true, congestion: 2.5 }, b: { minutes: 50, freeFlowMinutes: 45, live: true, congestion: 1.1 } }));
    process.env.TRAFFIC_PROVIDER = "google"; process.env.TRAFFIC_API_KEY = "test";
    const now = new Date("2026-11-21T06:00:00Z");
    const r1 = await getEtas(origin, dests, { fetchLive, now });
    expect(r1.live).toBe(true);
    expect(r1.etas.a.congestion).toBe(2.5);
    await getEtas(origin, dests, { fetchLive, now: new Date(now.getTime() + 60_000) });
    expect(fetchLive).toHaveBeenCalledTimes(1);
  });

  it("falls back when the provider fails, and when the daily quota is used up", async () => {
    process.env.TRAFFIC_PROVIDER = "google"; process.env.TRAFFIC_API_KEY = "test";
    const boom = vi.fn(async () => { throw new Error("503"); });
    const r = await getEtas(origin, dests, { fetchLive: boom });
    expect(r.live).toBe(false);
    expect(r.note).toMatch(/unavailable/i);
    _resetTrafficForTests();
    process.env.TRAFFIC_DAILY_LIMIT = "0";
    const ok = vi.fn(async () => ({}));
    const q = await getEtas(origin, dests, { fetchLive: ok });
    expect(ok).not.toHaveBeenCalled();
    expect(q.note).toMatch(/allowance/i);
    delete process.env.TRAFFIC_DAILY_LIMIT;
  });
});

describe("provider adapters (response shapes as documented; not yet run against a real key)", () => {
  it("parses a Google Routes matrix response into minutes and a congestion ratio", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      { originIndex: 0, destinationIndex: 0, condition: "ROUTE_EXISTS", duration: "1800s", staticDuration: "1200s" },
      { originIndex: 0, destinationIndex: 1, condition: "ROUTE_NOT_FOUND" },
    ]), { status: 200 })));
    const r = await googleEtas(origin, dests, "k");
    expect(r.a.minutes).toBe(30);
    expect(r.a.congestion).toBeCloseTo(1.5, 5);
    expect(r.b).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("parses a Mapbox matrix response from the traffic and the plain profile", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify({ durations: [url.includes("driving-traffic") ? [1800, 3600] : [900, 3000]] }), { status: 200 })));
    const r = await mapboxEtas(origin, dests, "t");
    expect(r.a.minutes).toBe(30);
    expect(r.a.congestion).toBeCloseTo(2, 5);
    expect(r.b.congestion).toBeCloseTo(1.2, 5);
    vi.unstubAllGlobals();
  });
});
