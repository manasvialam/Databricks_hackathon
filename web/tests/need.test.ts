import { describe, expect, it } from "vitest";
import { cleanNeed } from "@/lib/need";

describe("cleanNeed", () => {
  it("makes a short phrase that reads after 'a doctor about'", () => {
    expect(cleanNeed("I'm having trouble sleeping.")).toBe("trouble sleeping");
    expect(cleanNeed("Nightly fever and insomnia")).toBe("nightly fever and insomnia");
  });
  it("drops a request for a hospital: it is not a problem", () => {
    for (const s of ["finding a nearby hospital", "Looking for a hospital", "nearby hospital", "a doctor", "search for a clinic near me"]) expect(cleanNeed(s), s).toBeNull();
  });
  it("is null for nothing", () => { expect(cleanNeed(null)).toBeNull(); expect(cleanNeed("  ")).toBeNull(); });
});
