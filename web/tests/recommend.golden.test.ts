import { describe, expect, it } from "vitest";
import { recommend } from "@/lib/recommend";
import { geocode } from "@/lib/geocoder";
import { heuristicEta } from "@/lib/traffic";

// Golden queries against the real snapshot (run `python scripts/export_snapshot.py` first).
const noTraffic = async (_o: unknown, d: { id: string; straightKm: number }[]) => ({
  etas: Object.fromEntries(d.map((x) => [x.id, heuristicEta(x.straightKm, new Date("2026-11-21T06:00:00Z"))])), live: false, provider: null, note: "Estimated travel time, no live traffic.",
});

describe("golden queries on the real snapshot", () => {
  it("dialysis near Patna returns credible, cited, nearby options", async () => {
    const g = geocode("Patna");
    expect(g.status).toBe("ok");
    if (g.status !== "ok") return;
    const r = await recommend({ services: ["dialysis"], urgency: "routine", lat: g.lat, lon: g.lon }, { traffic: noTraffic as never });
    expect(r.results.length).toBeGreaterThanOrEqual(3);
    expect(r.confidence).not.toBe("none_reliable");
    for (const x of r.results) {
      expect(x.distanceKm).toBeLessThan(60);
      expect(x.evidence[0].snippets.length).toBeGreaterThan(0);               // every recommendation quotes the facility's own text
      expect(x.evidence[0].level).not.toBe("Contradicted");
      expect(x.pService).toBeGreaterThanOrEqual(0.35);
    }
    expect(r.results.reduce((s, x) => s + x.pBest, 0)).toBeLessThanOrEqual(1.01);
    expect(r.label).toMatch(/estimate/i);
  });

  it("a registry badge appears only for verified, non-suspended matches", async () => {
    const r = await recommend({ services: ["obstetrics"], urgency: "urgent", lat: 26.85, lon: 80.95 }, { traffic: noTraffic as never });
    for (const x of r.results) if (x.registry?.tier === "verified") expect(x.registry.asOf).toBeTruthy();
    expect(r.results.every((x) => x.registry === null || ["verified", "possible"].includes(x.registry.tier))).toBe(true);
  });

  it("says so honestly when nothing reliable exists nearby, instead of padding the list", async () => {
    // a point in the Andaman sea region far from any facility with burn-care evidence
    const r = await recommend({ services: ["linear_accelerator"], urgency: "routine", lat: 11.7, lon: 92.7 }, { traffic: noTraffic as never });
    if (r.results.length === 0) expect(r.confidence).toBe("none_reliable");
    else expect(r.radiusKm).toBeGreaterThan(25);
  });

  it("never says nothing is suitable nearby when good options are close", async () => {
    // Thanjavur has a handful of cath-lab hospitals within 3 km but fewer than six within 25 km
    const r = await recommend({ services: ["cath_lab"], urgency: "urgent", lat: 10.7789, lon: 79.1401 }, { traffic: noTraffic as never });
    const text = r.notes.map((n) => n.text).join(" ");
    const near = r.results.filter((x) => x.distanceKm <= 25);
    expect(near.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/nothing suitable/i);
    expect(r.results.every((x) => x.distanceKm <= 30)).toBe(true);           // with three good options close, nothing 59 or 173 km away pads the list
    expect(text).toMatch(/good options within 25 km/i);
  });

  it("widens the search and tells the user", async () => {
    const r = await recommend({ services: ["nicu"], urgency: "urgent", lat: 27.4, lon: 94.2 }, { traffic: noTraffic as never });
    if (r.widenedFrom) expect(r.notes.map((n) => n.text).join(" ")).toMatch(/widened/i);
  });
});
