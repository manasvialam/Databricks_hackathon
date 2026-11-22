import { describe, expect, it } from "vitest";
import { checkRedFlags } from "@/lib/triage/redflags";

// Draft coverage for Tamil, Telugu and Malayalam. Each phrase must escalate to the stated category.
// These sentences were written for testing and still need review by native speakers and a clinician.
const CASES: [string, string, string][] = [
  ["ta", "நெஞ்சு வலி அதிகமாக இருக்கிறது", "cardiac"],
  ["ta", "அப்பாவுக்கு மாரடைப்பு வந்துவிட்டது", "cardiac"],
  ["ta", "மூச்சு விட முடியவில்லை", "breathing"],
  ["ta", "முகம் கோணலாக இருக்கிறது", "stroke"],
  ["ta", "வலிப்பு வந்தது", "seizure"],
  ["ta", "இரத்தம் நிற்கவில்லை", "bleeding"],
  ["ta", "கர்ப்பிணிக்கு இரத்தப்போக்கு உள்ளது", "pregnancy"],
  ["ta", "பிரசவ வலி தொடங்கியது", "pregnancy"],
  ["ta", "சுயநினைவு இல்லை", "unconscious"],
  ["ta", "விஷம் குடித்துவிட்டார்", "poisoning"],
  ["ta", "பாம்பு கடித்தது", "snakebite"],
  ["ta", "தீக்காயம் ஏற்பட்டது", "burn"],
  ["ta", "சாலையில் விபத்து நடந்தது", "injury"],
  ["ta", "தற்கொலை செய்ய வேண்டும் என்று தோன்றுகிறது", "self_harm"],
  ["te", "ఛాతీ నొప్పిగా ఉంది", "cardiac"],
  ["te", "నాన్నకు గుండెపోటు వచ్చింది", "cardiac"],
  ["te", "ఊపిరి ఆడటం లేదు", "breathing"],
  ["te", "ముఖం వంకరగా ఉంది", "stroke"],
  ["te", "ఫిట్స్ వచ్చాయి", "seizure"],
  ["te", "రక్తం ఆగడం లేదు", "bleeding"],
  ["te", "గర్భిణికి రక్తస్రావం అవుతోంది", "pregnancy"],
  ["te", "ప్రసవ నొప్పి మొదలైంది", "pregnancy"],
  ["te", "స్పృహ లేదు", "unconscious"],
  ["te", "పురుగుల మందు తాగాడు", "poisoning"],
  ["te", "పాము కాటు వేసింది", "snakebite"],
  ["te", "రోడ్డు ప్రమాదం జరిగింది", "injury"],
  ["te", "ఆత్మహత్య చేసుకోవాలని ఉంది", "self_harm"],
  ["ml", "നെഞ്ചുവേദന ഉണ്ട്", "cardiac"],
  ["ml", "അച്ഛന് ഹൃദയാഘാതം വന്നു", "cardiac"],
  ["ml", "ശ്വാസം മുട്ടൽ ഉണ്ട്", "breathing"],
  ["ml", "പക്ഷാഘാതം ആണെന്ന് തോന്നുന്നു", "stroke"],
  ["ml", "അപസ്മാരം വന്നു", "seizure"],
  ["ml", "രക്തം നിൽക്കുന്നില്ല", "bleeding"],
  ["ml", "ഗർഭിണിക്ക് രക്തസ്രാവം ഉണ്ട്", "pregnancy"],
  ["ml", "പ്രസവ വേദന തുടങ്ങി", "pregnancy"],
  ["ml", "ബോധം പോയി", "unconscious"],
  ["ml", "വിഷം കഴിച്ചു", "poisoning"],
  ["ml", "പാമ്പ് കടിച്ചു", "snakebite"],
  ["ml", "പൊള്ളൽ ഏറ്റു", "burn"],
  ["ml", "വഴിയിൽ അപകടം ഉണ്ടായി", "injury"],
  ["ml", "ആത്മഹത്യ ചെയ്യണം എന്ന് തോന്നുന്നു", "self_harm"],
];

describe("emergency gate: Tamil, Telugu, Malayalam (draft)", () => {
  it.each(CASES)("[%s] escalates: %s", (_lang, text, category) => {
    const r = checkRedFlags(text);
    expect(r, text).not.toBeNull();
    expect(r!.categories.map((c) => c.id), text).toContain(category);
  });

  it("ignores zero-width joiners that Indic keyboards insert", () => {
    const withZwj = "நெஞ்சு" + String.fromCharCode(0x200c) + " வலி";
    expect(checkRedFlags(withZwj)?.categories[0].id).toBe("cardiac");
  });

  it("does not fire on a routine request in these languages", () => {
    for (const t of ["டயாலிசிஸ் எங்கு கிடைக்கும்", "డయాలసిస్ ఎక్కడ దొరుకుతుంది", "ഡയാലിസിസ് എവിടെ കിട്ടും"]) expect(checkRedFlags(t), t).toBeNull();
  });
});
