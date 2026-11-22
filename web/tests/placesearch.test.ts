import { describe, expect, it } from "vitest";
import { fromPhoton, localSuggestions } from "@/lib/placesearch";

const f = (props: Record<string, string>, lon = 80.15, lat = 12.9) => ({ geometry: { coordinates: [lon, lat] as [number, number] }, properties: props });

describe("address suggestions", () => {
  it("turns OpenStreetMap results into a label and a line of place context", () => {
    const [s] = fromPhoton([f({ name: "Padmavthy Nagar Extension Main Road", district: "Madambakkam", state: "Tamil Nadu", postcode: "600073", countrycode: "IN" })]);
    expect(s.label).toBe("Padmavthy Nagar Extension Main Road");
    expect(s.sub).toBe("Madambakkam, Tamil Nadu, 600073");
    expect(s.lat).toBeCloseTo(12.9);
  });
  it("uses the street and house number when there is no name", () => {
    const [s] = fromPhoton([f({ street: "Anna Salai", housenumber: "12", city: "Chennai", state: "Tamil Nadu", countrycode: "IN" })]);
    expect(s.label).toBe("12 Anna Salai");
    expect(s.sub).toContain("Chennai");
  });
  it("drops places outside India and results without coordinates", () => {
    expect(fromPhoton([f({ name: "London", countrycode: "GB" }, -0.12, 51.5), f({ name: "Colombo", countrycode: "LK" }, 79.8, 6.9), { properties: { name: "x", countrycode: "IN" } }])).toEqual([]);
  });
  it("finds a PIN code from the app's own data without any network", () => {
    const [s] = localSuggestions("600073");
    expect(s.kind).toBe("pin");
    expect(s.lat).toBeGreaterThan(12);
  });
  it("gives nothing for text the app does not know", () => {
    expect(localSuggestions("qqzzxx nowhere")).toEqual([]);
  });
});
