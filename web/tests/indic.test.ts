import { describe, expect, it } from "vitest";
import { asciiDigits, indicPlaceCandidates, NATIVE_PLACE_TARGETS, phon, toLatin } from "@/lib/indic";
import { geocode } from "@/lib/geocoder";

describe("Indian scripts to Latin", () => {
  it("transliterates all four scripts, with Hindi schwa deletion", () => {
    expect(toLatin("पटना")).toBe("patnaa");
    expect(toLatin("कानपुर")).toBe("kaanpur");
    expect(toLatin("சென்னை")).toBe("chennai");
    expect(toLatin("విజయవాడ")).toBe("vijayavaada");
    expect(toLatin("കോഴിക്കോട്")).toBe("kozhikkot");
  });
  it("the phonetic key ignores aspiration, voicing, vowel length and doubled letters", () => {
    expect(phon("madurai")).toBe(phon(toLatin("மதுரை")));
    expect(phon("guntur")).toBe(phon(toLatin("గుంటూరు")));
    expect(phon("thiruvananthapuram")).toBe(phon(toLatin("തിരുവനന്തപുരം")));
  });
  it("reads PIN codes typed in Indian digits", () => {
    expect(asciiDigits("८००००१")).toBe("800001");
    expect(asciiDigits("௬௦௦௦௦௧")).toBe("600001");
  });
});

// A place typed into the place box in each script. DRAFT list: native speakers should add the spellings people use.
const TYPED: [string, string][] = [
  ["पटना", "BIHAR"], ["लखनऊ", "UTTAR PRADESH"], ["दिल्ली", "DELHI"], ["मुंबई", "MAHARASHTRA"], ["जयपुर", "RAJASTHAN"],
  ["कानपुर", "UTTAR PRADESH"], ["भोपाल", "MADHYA PRADESH"], ["गया", "BIHAR"], ["पटना, बिहार", "BIHAR"],
  ["சென்னை", "TAMIL NADU"], ["மதுரை", "TAMIL NADU"], ["கோயம்புத்தூர்", "TAMIL NADU"], ["சேலம்", "TAMIL NADU"], ["தஞ்சாவூர்", "TAMIL NADU"],
  ["హైదరాబాద్", "TELANGANA"], ["విజయవాడ", "ANDHRA PRADESH"], ["గుంటూరు", "ANDHRA PRADESH"], ["వరంగల్", "TELANGANA"], ["తిరుపతి", "ANDHRA PRADESH"],
  ["കൊച്ചി", "KERALA"], ["തിരുവനന്തപുരം", "KERALA"], ["കോഴിക്കോട്", "KERALA"], ["തൃശ്ശൂർ", "KERALA"], ["കണ്ണൂർ", "KERALA"],
];

describe("geocoding places written in Indian scripts", () => {
  it.each(TYPED)("%s -> %s", (q, state) => {
    const g = geocode(q);
    expect(g.status).toBe("ok");
    if (g.status === "ok") expect(g.state).toBe(state);
  });
  it("every curated native name points at a place the geocoder knows", () => {
    for (const en of NATIVE_PLACE_TARGETS) expect(geocode(en).status, en).not.toBe("not_found");
  });
  it("reads a PIN code typed in Devanagari digits", () => {
    const g = geocode("८००००१");
    expect(g.status === "ok" && g.state).toBe("BIHAR");
  });
});

describe("place phrases inside a sentence", () => {
  const cases: [string, string, string][] = [
    ["hi", "मुझे पटना में डायलिसिस चाहिए", "BIHAR"],
    ["hi", "लखनऊ के पास सी सेक्शन", "UTTAR PRADESH"],
    ["ta", "சென்னையில் டயாலிசிஸ் வேண்டும்", "TAMIL NADU"],
    ["ta", "மதுரை அருகில் எம்ஆர்ஐ ஸ்கேன்", "TAMIL NADU"],
    ["ta", "சேலத்தில் இரத்த வங்கி", "TAMIL NADU"],
    ["te", "హైదరాబాద్‌లో ఎంఆర్ఐ కావాలి", "TELANGANA"],
    ["te", "విజయవాడ దగ్గర డయాలసిస్", "ANDHRA PRADESH"],
    ["ml", "കൊച്ചിയിൽ ഡയാലിസിസ് വേണം", "KERALA"],
    ["ml", "എറണാകുളത്ത് സിടി സ്കാൻ", "KERALA"],
  ];
  it.each(cases)("[%s] %s", (_l, text, state) => {
    const hit = indicPlaceCandidates(text).map((c) => geocode(c, null, { strict: true })).find((g) => g.status === "ok");
    expect(hit?.status).toBe("ok");
    if (hit?.status === "ok") expect(hit.state).toBe(state);
  });
  it("does not turn ordinary words into towns", () => {
    // "गया" is also the town Gaya; "కావాలి" (need) is also the town Kavali
    for (const text of ["मेरा बेटा गिर गया", "నాకు డయాలసిస్ కావాలి", "எனக்கு டயாலிசிஸ் வேண்டும்", "എനിക്ക് വീട്ടിൽ ഇരിക്കണം"]) {
      const hit = indicPlaceCandidates(text).map((c) => geocode(c, null, { strict: true })).find((g) => g.status === "ok");
      expect(hit, text).toBeUndefined();
    }
  });
});
