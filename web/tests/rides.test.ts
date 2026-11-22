import { describe, expect, it } from "vitest";
import { coord, isMobileUA, olaLink, rapidoDropText, rapidoLink } from "@/lib/rides";

const o = { lat: 12.9716, lon: 77.5946 };
const d = { lat: 10.78701234, lon: 79.13849, name: "St. Mary's Hospital & Clinic, Thanjavur" };

describe("ride links", () => {
  it("rounds coordinates to five decimals", () => {
    expect(coord(10.78701234)).toBe("10.78701");
    expect(coord(77)).toBe("77");
  });
  it("mobile Ola link uses the universal link with pickup and drop", () => {
    const u = new URL(olaLink(o, d, { mobile: true }));
    expect(u.origin + u.pathname).toBe("https://olawebcdn.com/assets/ola-universal-link.html");
    expect(u.searchParams.get("lat")).toBe("12.9716");
    expect(u.searchParams.get("lng")).toBe("77.5946");
    expect(u.searchParams.get("drop_lat")).toBe("10.78701");
    expect(u.searchParams.get("drop_lng")).toBe("79.13849");
    expect(u.searchParams.get("landing_page")).toBe("bk");
    expect(u.searchParams.get("drop_address")).toBe(d.name);
  });
  it("desktop Ola link uses the web deep link with drop_name", () => {
    const u = new URL(olaLink(o, d, { mobile: false }));
    expect(u.origin).toBe("https://book.olacabs.com");
    expect(u.searchParams.get("dsw")).toBe("yes");
    expect(u.searchParams.get("drop_name")).toBe(d.name);
  });
  it("encodes the drop name so & and spaces cannot break the link", () => {
    const s = olaLink(o, d, { mobile: false });
    expect(s).toContain("St.%20Mary's%20Hospital%20%26%20Clinic");
    expect(s.split("&").length).toBe(6);
  });
  it("omits pickup when the origin is missing or invalid (Ola then uses the current location)", () => {
    for (const bad of [null, undefined, { lat: NaN, lon: 1 }, { lat: 91, lon: 0 }]) {
      const u = new URL(olaLink(bad, d, { mobile: true }));
      expect(u.searchParams.has("lat")).toBe(false);
      expect(u.searchParams.has("lng")).toBe(false);
      expect(u.searchParams.get("drop_lat")).toBe("10.78701");
    }
  });
  it("adds utm_source only when a token is supplied; never a default", () => {
    expect(olaLink(o, d, { mobile: true })).not.toContain("utm_source");
    expect(new URL(olaLink(o, d, { mobile: true, xapp: "tok 1" })).searchParams.get("utm_source")).toBe("tok 1");
  });
  it("Rapido has no parameters and the copied text is just the name", () => {
    expect(rapidoLink()).toBe("https://www.rapido.bike/");
    expect(rapidoDropText({ ...d, name: "  Apollo  " })).toBe("Apollo");
  });
  it("detects phones", () => {
    expect(isMobileUA("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe(true);
    expect(isMobileUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
  });
});
