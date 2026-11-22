import { describe, expect, it } from "vitest";
import { emergencyText, LANGS, missingKeys, msg, say, svcLabel, svcPlain, t, termText, type Lang, type MsgKey } from "@/lib/i18n";
import { en } from "@/lib/i18n/en";
import { SERVICES } from "@/lib/services";
import { RED_FLAGS } from "@/lib/triage/redflags";
import { recommend } from "@/lib/recommend";
import { geocode } from "@/lib/geocoder";
import { heuristicEta } from "@/lib/traffic";

const OTHER: Lang[] = LANGS.map((l) => l.id).filter((l) => l !== "en");
const KEYS = Object.keys(en) as MsgKey[];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("screen text in every language", () => {
  it.each(OTHER)("%s has every interface string (no silent English fallback)", (lang) => {
    expect(missingKeys(lang)).toEqual([]);
  });
  it.each(OTHER)("%s keeps every {placeholder}, list separator and is never empty", (lang) => {
    for (const k of KEYS) {
      const s = t(lang, k);
      expect(s.trim(), `${lang}.${k}`).not.toBe("");
      expect(placeholders(s), `${lang}.${k}`).toEqual(placeholders(en[k]));
    }
    expect(t(lang, "carryItems").split("|")).toHaveLength(en.carryItems.split("|").length);
  });
  it.each(OTHER)("%s names and explains every service", (lang) => {
    for (const s of SERVICES) {
      expect(svcLabel(s.id, lang), `${lang}.${s.id}`).not.toBe(s.en);
      expect(svcPlain(s.id, lang), `${lang}.${s.id}`).not.toBe(s.plain);
    }
  });
  it.each(OTHER)("%s has the emergency instructions for every red-flag category", (lang) => {
    for (const c of RED_FLAGS) {
      const e = emergencyText(c.id, lang);
      expect(e, `${lang}.${c.id}`).not.toBeNull();
      expect(e!.label && e!.now, `${lang}.${c.id}`).toBeTruthy();
      expect(!!e!.wait, `${lang}.${c.id} first-aid line`).toBe(!!c.whileWaiting);
      // the numbers in the instruction must survive translation exactly (108, 112, 20 minutes)
      expect((e!.now.match(/\d+/g) ?? []).sort(), `${lang}.${c.id}`).toEqual((c.now.match(/\d+/g) ?? []).sort());
      if (c.whileWaiting) expect((e!.wait!.match(/\d+/g) ?? []).sort(), `${lang}.${c.id}`).toEqual((c.whileWaiting.match(/\d+/g) ?? []).sort());
    }
  });
  it("English keeps its exact text and the emergency card uses the gate's own wording", () => {
    expect(t("en", "noteWidened", { from: 25, to: 50 })).toBe("Nothing suitable within 25 km, so the search was widened to 50 km.");
    expect(emergencyText("cardiac", "en")).toBeNull();
  });
});

const noTraffic = async (_o: unknown, d: { id: string; straightKm: number }[]) => ({
  etas: Object.fromEntries(d.map((x) => [x.id, heuristicEta(x.straightKm, new Date("2026-11-21T06:00:00Z"))])), live: false, provider: null,
  note: "Estimated travel time, no live traffic.", noteKey: "trafficNoteEst" as const,
});

describe("what the server sends can be shown in every language", () => {
  it("cautions, notes, district facts and every 'How we decided' line carry a message key", async () => {
    const g = geocode("Patna");
    if (g.status !== "ok") throw new Error("Patna must geocode");
    const r = await recommend({ services: ["obstetrics", "c_section"], urgency: "emergency", lat: g.lat, lon: g.lon }, { traffic: noTraffic as never });
    const msgs = [...r.notes, ...r.coverage.context, r.traffic.note, ...r.results.flatMap((x) => x.warnings)];
    const terms = r.results.flatMap((x) => [x.why.baseline, ...x.why.positive, ...x.why.negative]);
    expect(terms.length).toBeGreaterThan(0);
    for (const m of msgs) expect(KEYS, m.text).toContain(m.k);
    for (const c of terms) expect(c.k, c.label).toBeTruthy();
    for (const lang of OTHER) {
      for (const m of msgs) expect(say(m, lang)).not.toBe(m.text);
      for (const c of terms) expect(termText(c, lang).label).not.toBe(c.label);
    }
  });
  it("English shows the original text; other languages show the translation with values filled in", () => {
    const m = msg("noteWidened", { from: 25, to: 100 });
    expect(say(m, "en")).toBe(m.text);
    expect(say(m, "hi")).toContain("25");
    expect(say(m, "hi")).toContain("100");
    expect(say(m, "hi")).not.toBe(m.text);
  });
  it("translates the record fields named in 'How we decided'", () => {
    const c = { label: "Intensive care appears in 2 parts of their listing", delta: 0.5, k: "whyFields" as MsgKey, v: { svc: "icu", n: 2 }, detail: "procedure, equipment", dk: "whyFieldsDetail" as MsgKey, dv: { n: 2, list: "procedure, equipment" } };
    expect(termText(c, "en").detail).toBe("procedure, equipment");
    expect(termText(c, "ta").detail).toBe(`${t("ta", "fieldProcedure")}, ${t("ta", "fieldEquipment")}`);
    // the service is named in the person's language, the count is kept
    expect(termText(c, "ta").label).toContain("2");
    expect(termText(c, "ta").label).not.toContain("{");
  });
});
