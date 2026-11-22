import { describe, expect, it } from "vitest";
import { rank, serviceLogOdds, W } from "@/lib/ranking";
import { PERSONA_BY_ID } from "@/lib/preferences";
import type { Claim, ClaimLevel, Facility, Registry, TrafficEta } from "@/lib/types";

const claim = (level: ClaimLevel, extra: Partial<Claim> = {}): Claim => ({
  s: "dialysis", l: level, st: 0.8, nf: 2, f: ["procedure", "equipment"], sp: false, pm: true, ct: [], cr: [], sn: [{ x: "Dialysis unit", f: "equipment" }], u: [], ...extra,
});
const registry = (extra: Partial<Registry> = {}): Registry => ({
  t: "verified", m: "name+place", hfr: "IN0000", own: "private", nabh: false, tb: false, sus: false, badge: true, svc: [], sp: [], dt: null, ns: 1, km: 0.1, ...extra,
});
let n = 0;
const fac = (o: Partial<Facility> = {}): Facility => ({
  id: `f${++n}`, nm: `Hospital ${n}`, ty: "hospital", op: "private", sz: "medium", ci: "Patna", st: "BIHAR", di: "PATNA", dk: "patna",
  la: 25.6, lo: 85.1, lp: "coordinates", lt: "verified", ls: 0.9, ft: 80, ms: 0, h24: true, ph: [], ws: null, rt: null, wd: false, gv: false,
  pri: true, ne: 10, nsp: 8, cl: [claim("Strong")], rs: [], rg: null, ...o,
});
const eta = (m: number, congestion = 1, live = true): TrafficEta => ({ minutes: m, freeFlowMinutes: m / congestion, live, congestion });
const run = (cands: Facility[], over: Partial<Parameters<typeof rank>[0]> = {}) =>
  rank({
    candidates: cands, services: [{ id: "dialysis" }], urgency: "routine", preferences: PERSONA_BY_ID.everyone.weights, card: "unknown",
    eta: Object.fromEntries(cands.map((c) => [c.id, eta(20)])), distanceKm: Object.fromEntries(cands.map((c) => [c.id, 8])), draws: 1500, seed: 7, ...over,
  });

describe("evidence model", () => {
  it("orders evidence levels: Strong > Moderate > Inferred > Weak > Contradicted > none", () => {
    const p = (l: ClaimLevel | null) => serviceLogOdds(fac({ cl: l ? [claim(l)] : [] }), "dialysis").p;
    expect(p("Strong")).toBeGreaterThan(p("Moderate"));
    expect(p("Moderate")).toBeGreaterThan(p("Inferred"));
    expect(p("Inferred")).toBeGreaterThan(p("Weak"));
    expect(p("Weak")).toBeGreaterThan(p("Contradicted"));
    expect(p(null)).toBeLessThan(p("Weak"));
  });

  it("records every term so the result can be explained", () => {
    const { terms } = serviceLogOdds(fac({ rg: registry({ svc: ["dialysis"] }) }), "dialysis");
    expect(terms.some((t) => /registry/i.test(t.label))).toBe(true);
    expect(terms.length).toBeGreaterThan(2);
  });

  it("caps the registry boost so it cannot rescue Weak evidence above Strong evidence", () => {
    const strongNoRegistry = serviceLogOdds(fac({ cl: [claim("Strong")] }), "dialysis").p;
    const weakFullRegistry = serviceLogOdds(fac({ cl: [claim("Weak", { nf: 1 })], rg: registry({ svc: ["dialysis"], nabh: true }) }), "dialysis").p;
    expect(weakFullRegistry).toBeLessThan(strongNoRegistry);
  });

  it("never lets a suspended registry entry add evidence", () => {
    const base = serviceLogOdds(fac({ rg: null }), "dialysis").p;
    const sus = serviceLogOdds(fac({ rg: registry({ sus: true, svc: ["dialysis"] }) }), "dialysis").p;
    expect(sus).toBeCloseTo(base, 6);
  });

  it("penalises records that may mix several facilities", () => {
    expect(serviceLogOdds(fac({ ms: 4 }), "dialysis").p).toBeLessThan(serviceLogOdds(fac({ ms: 0 }), "dialysis").p);
  });
});

describe("ranker", () => {
  it("is deterministic for a fixed seed and its win probabilities sum to 1", () => {
    const cands = [fac(), fac({ ft: 60 }), fac({ lt: "unverified" })];
    const a = run(cands), b = run(cands);
    expect(a.ranked.map((x) => x.pBest)).toEqual(b.ranked.map((x) => x.pBest));
    expect(a.ranked.reduce((s, x) => s + x.pBest, 0)).toBeCloseTo(1, 6);
  });

  it("prefers a farther clear hospital over a near jammed one at equal evidence", () => {
    const near = fac({ nm: "Near but jammed" }), far = fac({ nm: "Far but clear" });
    const res = run([near, far], { eta: { [near.id]: eta(75, 3), [far.id]: eta(38, 1) }, distanceKm: { [near.id]: 4, [far.id]: 22 } });
    expect(res.ranked[0].facility.nm).toBe("Far but clear");
    expect(res.picks.fastest?.facility.nm).toBe("Far but clear");
  });

  it("widens the time interval when traffic is heavy", () => {
    const a = fac(), b = fac();
    const res = run([a, b], { eta: { [a.id]: eta(30, 1), [b.id]: eta(30, 2.5) } });
    const ra = res.ranked.find((x) => x.facility.id === a.id)!, rb = res.ranked.find((x) => x.facility.id === b.id)!;
    expect(rb.etaHigh - rb.etaLow).toBeGreaterThan(ra.etaHigh - ra.etaLow);
  });

  it("ranks a verified location above an unverified one at equal evidence", () => {
    const good = fac({ lt: "verified" }), bad = fac({ lt: "unverified", ls: 0.25 });
    const res = run([good, bad]);
    expect(res.ranked[0].facility.id).toBe(good.id);
  });

  it("does not offer facilities without reliable evidence and says so", () => {
    const res = run([fac({ cl: [] }), fac({ cl: [claim("Weak")] })]);
    expect(res.confidence).toBe("none_reliable");
    expect(res.picks.best).toBeNull();
  });

  it("reports 'several similar options' when candidates are equally good", () => {
    const res = run([fac(), fac(), fac(), fac()]);
    expect(res.confidence).toBe("several_similar");
  });

  it("an Ayushman card moves a PM-JAY-listed private hospital up; no card barely does", () => {
    const listed = fac({ nm: "Listed private", rg: registry() }), plain = fac({ nm: "Plain private" });
    const cost = { speed: 0.1, trust: 0.1, cost: 0.7, comfort: 0, government: 0.1 };
    const yes = run([listed, plain], { card: "yes", preferences: cost }).ranked.find((x) => x.facility.id === listed.id)!.pBest;
    const no = run([listed, plain], { card: "no", preferences: cost }).ranked.find((x) => x.facility.id === listed.id)!.pBest;
    expect(yes).toBeGreaterThan(no);
  });

  it("in an emergency a facility that is not open 24x7 loses to one that is", () => {
    const open = fac({ h24: true }), closed = fac({ h24: false });
    const res = run([open, closed], { urgency: "emergency" });
    expect(res.ranked[0].facility.id).toBe(open.id);
  });

  it("does not let the cost preference override missing evidence", () => {
    const cheapNoEvidence = fac({ nm: "Cheap, no evidence", cl: [], op: "public", rg: registry({ own: "government" }) });
    const strong = fac({ nm: "Strong evidence" });
    const res = run([cheapNoEvidence, strong], { preferences: { speed: 0, trust: 0, cost: 1, comfort: 0, government: 0 }, card: "yes" });
    expect(res.ranked[0].facility.nm).toBe("Strong evidence");
  });

  it("exposes the minimum viable probability as a single constant", () => {
    expect(W.minViable).toBeGreaterThan(0);
  });
});

describe("solid vs weaker evidence", () => {
  it("does not treat contradicted or prerequisite-missing evidence as solid, and keeps it out of the picks", () => {
    const shaky = fac({ nm: "Shaky", cl: [claim("Moderate", { ct: ["no beds listed"], pm: false })], rg: registry({ svc: ["dialysis"] }) });
    const sound = fac({ nm: "Sound", cl: [claim("Strong")] });
    const res = run([shaky, sound]);
    const byName = Object.fromEntries(res.ranked.map((x) => [x.facility.nm, x]));
    expect(byName.Sound.solid).toBe(true);
    expect(byName.Shaky.solid).toBe(false);
    expect(res.picks.best?.facility.nm).toBe("Sound");
    expect(res.picks.bestValue?.facility.nm).toBe("Sound");
  });

  it("falls back to weaker options when nothing is solid, and says so", () => {
    const res = run([fac({ cl: [claim("Moderate", { pm: false })] })]);
    expect(res.ranked[0].solid).toBe(false);
    expect(res.notes.map((n) => n.text).join(" ")).toMatch(/weaker evidence/i);
    expect(res.picks.best).not.toBeNull();
  });
});
