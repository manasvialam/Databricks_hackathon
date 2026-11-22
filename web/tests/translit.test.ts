import { describe, expect, it } from "vitest";
import { validateTranslit } from "@/lib/translit";

describe("transliteration guard", () => {
  it("accepts a name written in the language's script with the same numbers", () => {
    expect(validateTranslit("hi", ["Nectar Hospital", "Thanjavur 613002"], ["नेक्टर हॉस्पिटल", "तंजावुर 613002"])).toEqual(["नेक्टर हॉस्पिटल", "तंजावुर 613002"]);
  });
  it("discards Latin text, a changed number, and a wrong-length answer", () => {
    expect(validateTranslit("ta", ["Nectar Hospital"], ["Nectar Hospital"])).toEqual([null]);
    expect(validateTranslit("te", ["Road 12"], ["రోడ్ 13"])).toEqual([null]);
    expect(validateTranslit("ml", ["A", "B"], ["എ"])).toEqual([null, null]);
  });
  it("does not accept another script", () => {
    expect(validateTranslit("ta", ["City Care Hospital"], ["सिटी केयर हॉस्पिटल"])).toEqual([null]);
  });
});
