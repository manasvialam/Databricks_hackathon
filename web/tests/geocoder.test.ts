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

  it("resolves full addresses through the PIN code, whatever the street or school is called", () => {
    const cases: [string, string, number, number][] = [
      ["thamarai international school, thanjavur, india 613002", "TAMIL NADU", 10.78, 79.12],
      ["madambakkam main road, rajakilpakam, chennai 600073", "TAMIL NADU", 12.92, 80.15],
      ["kallipadam po, shoranur 2, palakkad, kerala 679122", "KERALA", 10.77, 76.38],
      ["Plot 4, Some Street 600 073", "TAMIL NADU", 12.92, 80.15],
    ];
    for (const [q, state, lat, lon] of cases) {
      const g = geocode(q);
      expect(g.status, q).toBe("ok");
      if (g.status !== "ok") continue;
      expect(g.state).toBe(state);
      expect(Math.abs(g.lat - lat)).toBeLessThan(0.1);
      expect(Math.abs(g.lon - lon)).toBeLessThan(0.1);
      expect(g.matched).toMatch(/\d{6}/);
    }
  });
  it("an unknown PIN in an address falls back to the place name instead of failing", () => {
    const g = geocode("some road, chennai 999999");
    expect(g.status === "ok" || g.status === "ambiguous").toBe(true);
  });
});
