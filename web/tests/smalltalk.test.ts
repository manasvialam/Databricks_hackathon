import { describe, expect, it } from "vitest";
import { isSmallTalk } from "@/lib/triage/smalltalk";
import { triage } from "@/lib/triage/triage";

describe("small talk is not a request for care", () => {
  it.each(["Hello.", "hi", "Hey there!", "good morning", "thank you", "thanks!", "ok", "namaste", "नमस्ते", "வணக்கம்", "హలో", "നന്ദി", "धन्यवाद"])("%s", (t) => expect(isSmallTalk(t)).toBe(true));
  it.each(["yes", "no", "nothing", "हाँ", "नहीं", "ஆம்", "இல்லை", "అవును", "അതെ", "I have a fever", "hello, my father needs dialysis", "hi I need a hospital", "dialysis", "chest pain", "मुझे बुखार है", "hospital near me", ""])("%s is not small talk", (t) => expect(isSmallTalk(t)).toBe(false));
  it("triage marks a greeting as chat, with no services and no model call", async () => {
    let called = false;
    const r = await triage("Hello.", { llm: async () => { called = true; return null; } });
    expect(r.chat).toBe(true);
    expect(r.services).toEqual([]);
    expect(called).toBe(false);
  });
  it("asking for a hospital or clinic is never chat, even if the model says so", async () => {
    const base = { symptoms: [], urgency: "routine" as const, possibleConditions: [], followUps: [], services: [], careRequest: false };
    for (const m of ["is there a clinic near me", "show me a hospital", "மருத்துவமனை எங்கே", "ఆసుపత్రి ఎక్కడ", "अस्पताल कहाँ है"]) expect((await triage(m, { llm: async () => base })).chat, m).toBe(false);
  });
  it("a symptom is never chat, and neither is an emergency", async () => {
    expect((await triage("I have a fever for 8 days")).chat).toBe(false);
    expect((await triage("chest pain")).chat).toBe(false);
  });
  it("the model can mark unrelated chat as chat, but not when a service is found", async () => {
    const base = { symptoms: [], urgency: "routine" as const, possibleConditions: [], followUps: [] };
    expect((await triage("what can you do", { llm: async () => ({ ...base, services: [], careRequest: false }) })).chat).toBe(true);
    expect((await triage("my father needs dialysis", { llm: async () => ({ ...base, services: ["dialysis"], careRequest: false }) })).chat).toBe(false);
  });
});
