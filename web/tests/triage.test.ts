import { describe, expect, it } from "vitest";
import { triage, validateExtraction, type LlmExtractor } from "@/lib/triage/triage";
import { matchNeeds, placeCandidates } from "@/lib/triage/mapping";

describe("rule-based needs", () => {
  it("maps typed needs to services, never to a diagnosis", () => {
    expect(matchNeeds("my father needs dialysis near Patna")?.services[0]).toBe("dialysis");
    expect(matchNeeds("we need an MRI scan")?.services).toContain("mri");
    expect(matchNeeds("my wife is pregnant, due date next week")?.services[0]).toBe("obstetrics");
    expect(matchNeeds("planning a C-section")?.services[0]).toBe("c_section");
    expect(matchNeeds("biopsy says cancer")?.services[0]).toBe("oncology");
    expect(matchNeeds("hello there")).toBeNull();
  });
  it("extracts place phrases in English, Hindi and PIN form", () => {
    expect(placeCandidates("dialysis near Patna please")).toContain("Patna");
    expect(placeCandidates("emergency in Lucknow, urgently")).toContain("Lucknow");
    expect(placeCandidates("my PIN is 800 001")).toContain("800 001");
  });
});

describe("triage orchestration", () => {
  it("an emergency is decided by the gate even when the model is wrong or silent", async () => {
    const calm: LlmExtractor = async () => ({ symptoms: [], urgency: "routine", services: ["mri"], possibleConditions: [], followUps: [] });
    const r = await triage("he has chest pain and is sweating", { llm: calm });
    expect(r.emergency).not.toBeNull();
    expect(r.urgency).toBe("emergency");
    expect(r.services[0]).toBe("cath_lab");
  });

  it("the model can raise urgency but never lower it", async () => {
    const worried: LlmExtractor = async () => ({ symptoms: ["very drowsy"], urgency: "urgent", services: ["icu"], possibleConditions: [], followUps: [] });
    const up = await triage("I need an MRI scan", { llm: worried });
    expect(up.urgency).toBe("urgent");
    const calm: LlmExtractor = async () => ({ symptoms: [], urgency: "routine", services: [], possibleConditions: [], followUps: [] });
    const down = await triage("my mother needs dialysis", { llm: calm });
    expect(down.urgency).toBe("urgent");
  });

  it("re-checks the gate on what the model returned", async () => {
    const sneaky: LlmExtractor = async () => ({ symptoms: ["patient is unconscious"], urgency: "routine", services: ["mri"], possibleConditions: [], followUps: [], summary: "unconscious after a fall" });
    const r = await triage("please help my grandfather", { llm: sneaky });
    expect(r.emergency).not.toBeNull();
    expect(r.urgency).toBe("emergency");
  });

  it("a red flag mentioned earlier in the conversation still counts", async () => {
    const r = await triage("what should we do next", { history: ["she is pregnant and bleeding heavily"] });
    expect(r.emergency).not.toBeNull();
  });

  it("falls back to the rules when the model throws or returns junk", async () => {
    const boom: LlmExtractor = async () => { throw new Error("endpoint down"); };
    const a = await triage("dialysis near Patna", { llm: boom });
    expect(a.source).toBe("rules");
    expect(a.services[0]).toBe("dialysis");
    const junk: LlmExtractor = async () => ({ nonsense: true } as never);
    expect((await triage("dialysis near Patna", { llm: junk })).source).toBe("rules");
  });

  it("limits follow-up questions to two and conditions to three, and drops unknown services", () => {
    const v = validateExtraction({ symptoms: ["a"], urgency: "routine", services: ["dialysis", "made_up"], followUps: ["1", "2", "3"], possibleConditions: [1, 2, 3, 4].map((i) => ({ name: `c${i}`, why: "w" })) })!;
    expect(v.followUps).toHaveLength(2);
    expect(v.possibleConditions).toHaveLength(3);
    expect(v.services).toEqual(["dialysis"]);
    expect(validateExtraction({ urgency: "maybe" })).toBeNull();
  });
});
