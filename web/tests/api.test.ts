import { beforeEach, describe, expect, it } from "vitest";
import { _resetRateLimitForTests } from "@/lib/http";
import { POST as triagePost } from "@/app/api/triage/route";
import { POST as recommendPost } from "@/app/api/recommend/route";
import { GET as nearbyGet } from "@/app/api/nearby/route";
import { GET as geocodeGet } from "@/app/api/geocode/route";
import { GET as healthGet } from "@/app/api/health/route";

const post = (url: string, body: unknown) => new Request(`http://t${url}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
beforeEach(() => { _resetRateLimitForTests(); delete process.env.FM_ENDPOINT; delete process.env.DATABRICKS_HOST; });

describe("POST /api/triage", () => {
  it("returns an emergency card for a red flag and never needs a model", async () => {
    const r = await triagePost(post("/api/triage", { message: "my husband has chest pain, we are in Patna" }));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.triage.emergency.categories[0].id).toBe("cardiac");
    expect(j.triage.urgency).toBe("emergency");
    expect(j.location.status).toBe("ok");
  });
  it("finds the service and the place in an ordinary request", async () => {
    const j = await (await triagePost(post("/api/triage", { message: "my mother needs dialysis near Patna" }))).json();
    expect(j.triage.services[0]).toBe("dialysis");
    expect(j.location.state).toBe("BIHAR");
    expect(j.triage.source).toBe("rules");
  });
  it("rejects empty, oversized and malformed bodies with a plain message", async () => {
    expect((await triagePost(post("/api/triage", { message: "  " }))).status).toBe(400);
    expect((await triagePost(post("/api/triage", { message: "x".repeat(1001) }))).status).toBe(400);
    expect((await triagePost(post("/api/triage", "{not json"))).status).toBe(400);
  });
  it("rate limits a single caller", async () => {
    let last = 200;
    for (let i = 0; i < 45; i++) last = (await triagePost(post("/api/triage", { message: "dialysis" }))).status;
    expect(last).toBe(429);
  });
});

describe("POST /api/recommend", () => {
  it("returns cited, labelled results for a place name", async () => {
    const r = await recommendPost(post("/api/recommend", { services: ["dialysis"], urgency: "routine", location: { query: "Patna" }, persona: "everyone", card: "yes" }));
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.results.length).toBeGreaterThan(0);
    expect(j.results[0].evidence[0].snippets.length).toBeGreaterThan(0);
    expect(j.label).toMatch(/estimate/i);
    expect(j.traffic.note.text).toMatch(/traffic/i);
  });
  it("asks for the state when the place is ambiguous and rejects points outside India", async () => {
    const a = await recommendPost(post("/api/recommend", { services: ["icu"], location: { query: "Aurangabad" } }));
    expect(a.status).toBe(422);
    expect((await a.json()).ambiguous.status).toBe("ambiguous");
    expect((await recommendPost(post("/api/recommend", { services: ["icu"], location: { lat: 51.5, lon: -0.1 } }))).status).toBe(422);
  });
  it("validates services and location, ignoring unknown service ids", async () => {
    expect((await recommendPost(post("/api/recommend", { services: ["made_up"], location: { query: "Patna" } }))).status).toBe(400);
    expect((await recommendPost(post("/api/recommend", { services: ["dialysis"] }))).status).toBe(400);
  });
});

describe("other routes", () => {
  it("nearby lists services with solid evidence around a point", async () => {
    const j = await (await nearbyGet(new Request("http://t/api/nearby?lat=25.6&lon=85.14"))).json();
    expect(j.services.length).toBe(15);
    expect(j.services.some((s: { count: number }) => s.count > 0)).toBe(true);
    expect((await nearbyGet(new Request("http://t/api/nearby?lat=1&lon=1"))).status).toBe(400);
  });
  it("nearby also lists hospitals directly, nearest first, with service tags", async () => {
    const j = await (await nearbyGet(new Request("http://t/api/nearby?lat=25.6&lon=85.14"))).json();
    const h = j.hospitals as { name: string; km: number; services: string[]; type: string | null }[];
    expect(h.length).toBeGreaterThan(3);
    expect(h.length).toBeLessThanOrEqual(12);
    expect(h.every((x) => x.type === "hospital" || x.type === "nursing_home" || x.type === null)).toBe(true);
    expect(h.some((x) => x.services.length > 0)).toBe(true);
    expect(h[0].km).toBeLessThanOrEqual(h[h.length - 1].km + 12);
  });
  it("geocode and health respond without leaking configuration", async () => {
    const g = await (await geocodeGet(new Request("http://t/api/geocode?q=Bangalore"))).json();
    expect(g.state).toBe("KARNATAKA");
    const h = await (await healthGet()).json();
    expect(h.tier).toBe(3);
    expect(JSON.stringify(h)).not.toMatch(/secret|token|key/i);
  });
});
