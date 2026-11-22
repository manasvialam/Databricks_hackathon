import { describe, expect, it } from "vitest";
import { geocode, normState, reverse } from "@/lib/geocoder";

describe("geocoder (port of Person_2/geocoder.py)", () => {
  it("resolves old city names through the alias table", () => {
    for (const q of ["Bangalore", "Gurgaon", "Trivandrum", "Poona", "Benaras"]) {
      const r = geocode(q);
      expect(r.status, q).toBe("ok");
    }
    const b = geocode("Bangalore");
    expect(b.status === "ok" && b.state).toBe("KARNATAKA");
    const g = geocode("Gurgaon");
    expect(g.status === "ok" && g.state).toBe("HARYANA");
  });

  it("accepts a PIN with a space or hyphen", () => {
    for (const q of ["800001", "800 001", "800-001"]) {
      const r = geocode(q);
      expect(r.status === "ok" && r.level).toBe("pin");
      expect(r.status === "ok" && r.state).toBe("BIHAR");
    }
  });

  it("asks for the state when a name exists in several states", () => {
    expect(geocode("Aurangabad").status).toBe("ambiguous");
    const r = geocode("Aurangabad", "Bihar");
    expect(r.status === "ok" && r.state).toBe("BIHAR");
    const r2 = geocode("Aurangabad, Maharashtra");
    expect(r2.status === "ok" && r2.state).toBe("MAHARASHTRA");
  });

  it("handles coordinates, including swapped ones, and rejects points outside India", () => {
    const a = geocode("25.59, 85.13");
    expect(a.status === "ok" && a.lat).toBeCloseTo(25.59, 2);
    const b = geocode("85.13,25.59");
    expect(b.status === "ok" && b.lat).toBeCloseTo(25.59, 2);
    expect(geocode("51.5, -0.12").status).toBe("not_found");
  });

  it("tolerates a typo, reports unknown places and unknown PINs", () => {
    expect(geocode("Mumbaii").status).toBe("ok");
    expect(geocode("Xyzzyville").status).toBe("not_found");
    expect(geocode("999999").status).toBe("not_found");
  });

  it("answers a bare state name with the state centre and says so", () => {
    const r = geocode("Uttar Pradesh");
    expect(r.status === "ok" && r.level).toBe("state");
  });

  it("normalises state spellings and reverse-geocodes a coordinate", () => {
    expect(normState("Tamilnadu")).toBe("TAMIL NADU");
    expect(normState("Orissa")).toBe("ODISHA");
    const rv = reverse(25.6, 85.14);
    expect(rv?.state).toBe("BIHAR");
  });
});
