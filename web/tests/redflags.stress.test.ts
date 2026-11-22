import { describe, expect, it } from "vitest";
import { checkRedFlags } from "@/lib/triage/redflags";

describe("emergencies found by the stress test that were missed", () => {
  it.each(["help help my father not breathing please", "he is choking and turning blue", "bleding wont stop", "brething problem baby blue lips", "my baby is not breathing properly", "he is unconcious", "she won't wake up",
           "the child stopped breathing", "his lips are blue", "no pulse", "how to overdose", "I don't want to live anymore"])("%s", (t) => expect(checkRedFlags(t), t).not.toBeNull());
});

describe("things that sound like emergencies but are not", () => {
  it.each(["I do not have chest pain, I only need a dialysis centre", "my uncle had a heart attack ten years ago and now needs a regular checkup", "what are the signs of a stroke?", "How to prevent heart attack",
           "my heart attack insurance claim", "the movie had a car accident scene", "he used to have seizures as a child but not now, looking for a neurologist", "no bleeding, no fever, just need an MRI"])("%s", (t) => expect(checkRedFlags(t), t).toBeNull());
  it("still an emergency when a real symptom remains", () => {
    expect(checkRedFlags("no fever but severe chest pain")).not.toBeNull();
    expect(checkRedFlags("he had chest pain years ago and now he cannot breathe")).not.toBeNull();
    expect(checkRedFlags("my father had a stroke ten years ago, now his face is drooping and speech is slurred")).not.toBeNull();
    expect(checkRedFlags("not breathing, no pulse")).not.toBeNull();
  });
});
