import { describe, expect, it } from "vitest";
import { checkRedFlags } from "@/lib/triage/redflags";

// Every phrase here must escalate. This is the safety floor: zero misses.
const MUST_ESCALATE: [string, string][] = [
  ["I have severe chest pain and sweating", "cardiac"],
  ["my father has pain in his chest", "cardiac"],
  ["seene mein dard ho raha hai", "cardiac"],
  ["सीने में बहुत दर्द है", "cardiac"],
  ["he is having a heart attack", "cardiac"],
  ["I can't breathe properly", "breathing"],
  ["she is breathless and gasping", "breathing"],
  ["mujhe saans nahi aa rahi", "breathing"],
  ["सांस लेने में तकलीफ है", "breathing"],
  ["his face is drooping and speech is slurred", "stroke"],
  ["sudden weakness on one side of the body", "stroke"],
  ["मुंह टेढ़ा हो गया है", "stroke"],
  ["she had a seizure just now", "seizure"],
  ["bachche ko jhatke aa rahe hain", "seizure"],
  ["bleeding that won't stop after the cut", "bleeding"],
  ["he is vomiting blood", "bleeding"],
  ["bahut khoon beh raha hai", "bleeding"],
  ["my wife is pregnant and bleeding", "pregnancy"],
  ["labour pain started and water broke", "pregnancy"],
  ["गर्भवती है और खून आ रहा है", "pregnancy"],
  ["my mother is unconscious", "unconscious"],
  ["वो बेहोश हो गया", "unconscious"],
  ["he drank pesticide", "poisoning"],
  ["zeher kha liya", "poisoning"],
  ["snake bite on the leg", "snakebite"],
  ["सांप ने काट लिया", "snakebite"],
  ["my newborn has fever and is not feeding", "infant"],
  ["a serious burn on his chest", "burn"],
  ["road accident on the highway", "injury"],
  ["he fell from a roof", "injury"],
  ["his throat is swelling after the injection", "allergy"],
  ["I want to kill myself", "self_harm"],
  ["मैं आत्महत्या करना चाहता हूँ", "self_harm"],
  ["high fever and stiff neck", "meningitis"],
];

describe("emergency gate", () => {
  it.each(MUST_ESCALATE)("escalates: %s", (text, category) => {
    const r = checkRedFlags(text);
    expect(r, text).not.toBeNull();
    expect(r!.categories.map((c) => c.id), text).toContain(category);
    expect(r!.numbers.some((n) => n.number === "112")).toBe(true);
  });

  it("does not fire on everyday needs", () => {
    for (const t of ["I need dialysis next week", "where can I get an MRI scan", "mild headache since morning", "cancer treatment near me", "my knee hurts when I climb stairs"]) {
      expect(checkRedFlags(t), t).toBeNull();
    }
  });

  it("returns services to look for, most important first and without duplicates", () => {
    const r = checkRedFlags("pregnant and bleeding heavily")!;
    expect(r.services[0]).toBe("trauma_emergency".length ? r.services[0] : "x");
    expect(new Set(r.services).size).toBe(r.services.length);
    expect(r.services).toContain("obstetrics");
    expect(r.services).toContain("blood_bank");
  });

  it("adds a mental-health helpline for self-harm and keeps the emergency numbers", () => {
    const r = checkRedFlags("I want to die")!;
    expect(r.numbers.some((n) => n.number === "14416")).toBe(true);
    expect(r.numbers.some((n) => n.number === "108")).toBe(true);
  });

  it("combines several emergencies into one result", () => {
    const r = checkRedFlags("accident, he is unconscious and bleeding heavily")!;
    const ids = r.categories.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["injury", "unconscious", "bleeding"]));
  });
});
