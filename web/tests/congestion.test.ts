import { describe, expect, it } from "vitest";
import { areaFor, DAY_PROFILE, driveMinutes, istHour, levelOf, timeFactor, trafficInfo } from "@/lib/congestion";

const speed = (km: number, min: number) => (km / min) * 60;

describe("Indian travel-time model", () => {
  it("the day profile averages 1, so the all-day average matches the published congestion level", () => {
    expect(DAY_PROFILE.reduce((a, b) => a + b, 0) / 24).toBeCloseTo(1, 6);
    expect(DAY_PROFILE[18]).toBeGreaterThan(DAY_PROFILE[13]);
    expect(DAY_PROFILE[13]).toBeGreaterThan(DAY_PROFILE[2]);
  });
  it("finds the named metros and uses TomTom 2025 congestion levels", () => {
    expect(areaFor(13.0827, 80.2707, 0)).toMatchObject({ name: "Chennai", base: 0.586, source: "tomtom2025" });
    expect(areaFor(12.97, 77.59, 0)).toMatchObject({ name: "Bengaluru", base: 0.744 });
    expect(areaFor(28.61, 77.2, 0)).toMatchObject({ name: "Delhi", base: 0.602 });
    expect(areaFor(10.78, 79.13, 3).tier).toBe("rural");                // outside every metro, few facilities nearby
    expect(areaFor(10.78, 79.13, 50).tier).toBe("city");
  });
  it("a very short trip takes a few minutes, not one and not ten", () => {
    const chennai = areaFor(13.08, 80.27, 0);
    expect(driveMinutes(0.7, chennai, 18)).toBeGreaterThanOrEqual(3);    // 0.7 km at the evening peak
    expect(driveMinutes(0.7, chennai, 18)).toBeLessThanOrEqual(5);
    expect(driveMinutes(0.7, chennai, 2)).toBeLessThanOrEqual(3);
  });
  it("a short trip is never faster than a real urban average speed (2.2 km is not 4 minutes)", () => {
    const town = areaFor(10.78, 79.14, 40);                                   // Thanjavur-like: a built-up place outside the big metros
    const free22 = 2.9;                                                       // what the routing engine reports for about 2.2 km
    for (const h of [3, 8, 13, 18]) {
      const m = driveMinutes(free22, town, h, 2.2);
      expect(m, `hour ${h}`).toBeGreaterThanOrEqual(7);
      expect((2.2 / m) * 60, `hour ${h}`).toBeLessThanOrEqual(23);            // km/h door to door
    }
    expect(driveMinutes(0.9, town, 13, 0.9)).toBeGreaterThanOrEqual(3);
    expect(driveMinutes(40, town, 13, 60)).toBeGreaterThan(40);               // long highway trips are not floored
  });
  it("reproduces the published rush-hour speeds it was calibrated on", () => {
    // OpenStreetMap routing gives about 12 minutes of free-flow time for a 10 km city trip
    const blr = driveMinutes(12, areaFor(12.97, 77.59, 0), 18), del = driveMinutes(12, areaFor(28.61, 77.2, 0), 18);
    expect(speed(10, blr)).toBeGreaterThan(14); expect(speed(10, blr)).toBeLessThan(21);      // Bengaluru about 16.6 km/h
    expect(speed(10, del)).toBeGreaterThan(17); expect(speed(10, del)).toBeLessThan(24);      // Delhi 18.9 evening, 21.5 morning
  });
  it("is slower at the evening peak than at night, and the countryside is barely congested", () => {
    const c = areaFor(13.08, 80.27, 0), rural = areaFor(10.9, 79.9, 2);
    expect(driveMinutes(11, c, 18)).toBeGreaterThan(driveMinutes(11, c, 2) * 1.5);
    expect(timeFactor(rural, 18)).toBeLessThan(1.3);
  });
  it("labels traffic levels and reports the whole day for the chart", () => {
    expect(levelOf(1.1)).toBe("light"); expect(levelOf(1.4)).toBe("moderate"); expect(levelOf(1.8)).toBe("heavy"); expect(levelOf(2.4)).toBe("severe");
    const t = trafficInfo(areaFor(13.08, 80.27, 0), new Date("2026-11-22T12:30:00Z"));   // 18:00 IST
    expect(t.hour).toBe(18); expect(t.hourly).toHaveLength(24); expect(t.level).toBe("severe");
  });
  it("reads the hour in India time", () => { expect(istHour(new Date("2026-11-22T00:00:00Z"))).toBe(5); });
});
