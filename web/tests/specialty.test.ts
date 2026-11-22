import { describe, expect, it } from "vitest";
import { isSpecialtyId, matchSpecialties, SPECIALTIES, specLabel } from "@/lib/specialty";
import { GET as nearbyGet } from "@/app/api/nearby/route";
import { snapshot } from "@/lib/snapshot";
import { stepText } from "@/lib/routing";
import { LANGS } from "@/lib/i18n";
import { triage } from "@/lib/triage/triage";

describe("specialty matching", () => {
  it("maps needs to different specialties instead of one default", () => {
    expect(matchSpecialties("leg pain")[0]).toBe("bones");
    expect(matchSpecialties("my knee hurts when I climb stairs")[0]).toBe("bones");
    expect(matchSpecialties("fever since yesterday")[0]).toBe("general");
    expect(matchSpecialties("skin rash and itching")[0]).toBe("skin");
    expect(matchSpecialties("tooth pain")[0]).toBe("dental");
    expect(matchSpecialties("child has cough")).toEqual(expect.arrayContaining(["child", "chest"]));
    expect(matchSpecialties("leg pain")).toEqual(["bones"]);                    // generic words do not dilute a specific match
    expect(matchSpecialties("asdf qwer")).toEqual([]);
  });
  it("understands Hindi, Tamil, Telugu and Malayalam words", () => {
    expect(matchSpecialties("मेरे घुटने में दर्द है")[0]).toBe("bones");
    expect(matchSpecialties("தலைவலி")[0]).toBe("brain");
    expect(matchSpecialties("కడుపు నొప్పి")[0]).toBe("stomach");
    expect(matchSpecialties("പല്ലുവേദന")[0]).toBe("dental");
  });
  it("every category has a label in every language", () => {
    for (const l of LANGS) for (const s of SPECIALTIES) expect(specLabel(s.id, l.id).length, `${l.id} ${s.id}`).toBeGreaterThan(1);
  });
  it("the data carries categories, all of them known", () => {
    const f = snapshot().facilities;
    expect(f.filter((x) => x.sc?.length).length).toBeGreaterThan(f.length * 0.9);
    for (const x of f.slice(0, 2000)) for (const c of x.sc ?? []) expect(isSpecialtyId(c), c).toBe(true);
  });
});

describe("search responds to the need", () => {
  const get = async (sp: string) => (await (await nearbyGet(new Request(`http://t/api/nearby?lat=13.0827&lon=80.2707${sp ? `&sp=${sp}` : ""}`))).json()) as { hospitals: { id: string; name: string; matched: string[]; specialties: string[]; km: number }[]; wanted: string[] };
  it("knee pain, skin rash and dental return different first hospitals, each listing that specialty", async () => {
    const [bones, skin, dental] = await Promise.all([get("bones"), get("skin"), get("dental")]);
    for (const [r, id] of [[bones, "bones"], [skin, "skin"], [dental, "dental"]] as const) {
      expect(r.wanted).toEqual([id]);
      expect(r.hospitals[0].matched).toEqual([id]);
      expect(r.hospitals[0].specialties[0]).toBe(id);
    }
    expect(new Set([bones.hospitals[0].id, skin.hospitals[0].id, dental.hospitals[0].id]).size).toBeGreaterThan(1);
    expect(new Set([bones, skin, dental].map((r) => r.hospitals.map((h) => h.id).join())).size).toBe(3);   // three different lists
  });
  it("ignores unknown specialty ids", async () => {
    expect((await get("nonsense,bones")).wanted).toEqual(["bones"]);
  });
});

describe("triage returns specialties for needs that map to no service", () => {
  it("leg pain points to bones, fever to general medicine", async () => {
    expect((await triage("leg pain for two days")).specialties[0]).toBe("bones");
    expect((await triage("fever")).specialties[0]).toBe("general");
  });
});

describe("route steps", () => {
  it("reads turns in plain words", () => {
    expect(stepText({ distance: 100, name: "Anna Salai", maneuver: { type: "turn", modifier: "left" } })).toBe("Turn left onto Anna Salai");
    expect(stepText({ distance: 0, maneuver: { type: "arrive" } })).toBe("Arrive at the hospital");
  });
});
