import { describe, expect, it } from "vitest";
import { isNatural, rankVoices } from "@/lib/client/voices";

const v = (name: string, lang: string, localService = true) => ({ name, lang, localService });

describe("voice ranking", () => {
  it("prefers neural and online voices over the old local ones", () => {
    const all = [v("Microsoft Heera - Hindi (India)", "hi-IN"), v("Microsoft Swara Online (Natural) - Hindi (India)", "hi-IN", false), v("Google हिन्दी", "hi-IN", false), v("Microsoft David - English (United States)", "en-US")];
    const r = rankVoices(all, "hi-IN").map((x) => x.name);
    expect(r[0]).toContain("Natural");
    expect(r[r.length - 1]).toContain("Heera");
    expect(r).not.toContain("Microsoft David - English (United States)");
  });
  it("prefers the exact region and iOS premium voices", () => {
    const r = rankVoices([v("Lekha", "hi-IN"), v("Lekha (Premium)", "hi-IN"), v("Something", "ta-IN")], "hi-IN").map((x) => x.name);
    expect(r).toEqual(["Lekha (Premium)", "Lekha"]);
  });
  it("tells natural voices from basic ones and handles older Android tags", () => {
    expect(isNatural(v("Microsoft Pallavi Online (Natural) - Tamil (India)", "ta-IN", false))).toBe(true);
    expect(isNatural(v("Microsoft Valluvar - Tamil (India)", "ta-IN"))).toBe(false);
    expect(rankVoices([v("ta-in-x-tae-local", "ta_IN")], "ta-IN")).toHaveLength(1);
  });
});
