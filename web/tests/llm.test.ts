import { describe, expect, it } from "vitest";
import { recommend } from "@/lib/recommend";
import { geocode } from "@/lib/geocoder";
import { heuristicEta } from "@/lib/traffic";
import { describeFacility, validateFits } from "@/lib/rerank";
import { validateTranslations } from "@/lib/translate";
import { triage } from "@/lib/triage/triage";
import { snapshot } from "@/lib/snapshot";

const noTraffic = async (_o: unknown, d: { id: string; straightKm: number }[]) => ({
  etas: Object.fromEntries(d.map((x) => [x.id, heuristicEta(x.straightKm, new Date("2026-11-21T06:00:00Z"))])), live: false, provider: null, note: "Estimated travel time, no live traffic.",
});
const base = () => { const g = geocode("Patna"); if (g.status !== "ok") throw new Error("geocode"); return { services: ["dialysis" as const], urgency: "routine" as const, lat: g.lat, lon: g.lon }; };

describe("language-model fit (rerank)", () => {
  it("accepts only ids it was given and clamps scores", () => {
    const v = validateFits([{ id: "a", fit: 1.7, why: "good" }, { id: "zzz", fit: 0.9, why: "invented hospital" }, { id: "b", fit: "high" }, null], new Set(["a", "b"]));
    expect(Object.keys(v ?? {})).toEqual(["a"]);
    expect(v!.a.fit).toBe(1);
    expect(validateFits("not json", new Set(["a"]))).toBeNull();
    expect(validateFits([], new Set(["a"]))).toBeNull();
  });

  it("describes a facility from its own records only", () => {
    const f = snapshot().facilities.find((x) => x.cl.some((c) => c.sn.length))!;
    const d = describeFacility(f);
    expect(d).toContain(f.nm);
    expect(d).toMatch(/Records say|No service evidence/);
  });

  it("a model score changes the order but never the evidence, and never adds hospitals", async () => {
    const plain = await recommend(base(), { traffic: noTraffic as never });
    expect(plain.rankedBy).toBe("evidence");
    const ids = plain.results.map((x) => x.id);
    // the model loves the last hospital and dislikes the first
    const fit = async (_need: string, fs: { id: string }[]) => Object.fromEntries(fs.map((f) => [f.id, { fit: f.id === ids[ids.length - 1] ? 1 : f.id === ids[0] ? 0 : 0.5, why: "reason" }]));
    const withModel = await recommend({ ...base(), need: "kidney failure, needs dialysis twice a week" }, { traffic: noTraffic as never, fit: fit as never });
    expect(withModel.rankedBy).toBe("evidence+model");
    expect(withModel.notes.some((n) => n.k === "noteModelUsed")).toBe(true);
    const a = withModel.results.find((x) => x.id === ids[0])!;
    const b = plain.results.find((x) => x.id === ids[0])!;
    expect(a.pService).toBeLessThan(b.pService);                                    // a bad fit lowers P(service)
    expect(a.why.negative.some((t) => t.k === "whyModelFitWeak")).toBe(true);
    for (const x of withModel.results) expect(ids.concat(plain.results.map((y) => y.id))).toContain(x.id);
  });

  it("a good fit cannot rescue weak or contradicted evidence", async () => {
    const plain = await recommend(base(), { traffic: noTraffic as never });
    const fitAll = async (_n: string, fs: { id: string }[]) => Object.fromEntries(fs.map((f) => [f.id, { fit: 1, why: "perfect" }]));
    const boosted = await recommend({ ...base(), need: "dialysis" }, { traffic: noTraffic as never, fit: fitAll as never });
    for (const x of boosted.results) {
      const p = plain.results.find((y) => y.id === x.id);
      if (p && !p.solid) expect(x.pService).toBeLessThanOrEqual(p.pService + 0.001);   // weak ones got no lift
      expect(x.evidence[0].level).not.toBe("Contradicted");
    }
  });

  it("falls back to the evidence-only ranking when the model returns nothing", async () => {
    const r = await recommend({ ...base(), need: "dialysis" }, { traffic: noTraffic as never, fit: (async () => null) as never });
    expect(r.rankedBy).toBe("evidence");
  });
});

describe("model translation guards", () => {
  it("discards a translation that changes a number, is empty, or the wrong length", () => {
    const src = ["Open 24 hours, 12 km away", "Call 108"];
    expect(validateTranslations(src, ["24 घंटे खुला, 12 किमी दूर", "108 पर कॉल करें"])).toEqual(["24 घंटे खुला, 12 किमी दूर", "108 पर कॉल करें"]);
    expect(validateTranslations(src, ["24 घंटे खुला, 21 किमी दूर", ""])).toEqual([null, null]);
    expect(validateTranslations(src, ["only one"])).toEqual([null, null]);
    expect(validateTranslations(src, "junk")).toEqual([null, null]);
  });
});

describe("the model decides the care needed when it answers", () => {
  it("'no service fits' stays unmapped instead of falling back to keyword rules", async () => {
    const llm = async () => ({ symptoms: ["headache"], urgency: "routine" as const, services: [], possibleConditions: [], followUps: [], summary: "Headache for two days" });
    const r = await triage("headache hospitals", { llm });
    expect(r.services).toEqual([]);
    expect(r.understood).toBe(false);
    expect(r.need).toBe("Headache for two days");
  });
  it("the emergency gate still wins over a calm model", async () => {
    const llm = async () => ({ symptoms: [], urgency: "routine" as const, services: [], possibleConditions: [], followUps: [] });
    const r = await triage("my father has chest pain and is sweating", { llm });
    expect(r.emergency).not.toBeNull();
    expect(r.urgency).toBe("emergency");
  });
});
