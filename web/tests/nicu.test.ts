import { describe, expect, it } from "vitest";
import { triage } from "@/lib/triage/triage";

const llm = (services: string[]) => async () => ({ symptoms: [], urgency: "urgent" as const, services, possibleConditions: [], followUps: [] });

describe("NICU is only for newborns", () => {
  it("is dropped for an older child", async () => {
    expect((await triage("my child has loose motions", { llm: llm(["nicu"]) })).services).not.toContain("nicu");
  });
  it("is kept for a newborn or premature baby, in any of the languages", async () => {
    for (const m of ["my newborn needs intensive care", "premature baby needs NICU", "baby is 3 days old and not feeding well", "नवजात को आईसीयू चाहिए", "பச்சிளம் குழந்தைக்கு தீவிர சிகிச்சை", "నవజాత శిశువుకు ఐసియు", "നവജാത ശിശുവിന് തീവ്രപരിചരണം"])
      expect((await triage(m, { llm: llm(["nicu"]) })).services, m).toContain("nicu");
  });
});
