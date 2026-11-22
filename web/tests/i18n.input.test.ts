import { beforeEach, describe, expect, it } from "vitest";
import { matchNeeds } from "@/lib/triage/mapping";
import { checkRedFlags } from "@/lib/triage/redflags";
import { _resetRateLimitForTests } from "@/lib/http";
import { POST as triagePost } from "@/app/api/triage/route";
import type { ServiceId } from "@/lib/types";

// What a person might type or say. DRAFT sentences: native speakers should replace them with real phrasings.
const NEEDS: [string, string, ServiceId][] = [
  ["hi", "मेरी माँ को डायलिसिस करवाना है", "dialysis"],
  ["hi", "पत्नी गर्भवती है, डिलीवरी के लिए अस्पताल चाहिए", "obstetrics"],
  ["hi", "एमआरआई स्कैन करवाना है", "mri"],
  ["hi", "पापा को कैंसर है, कीमो के लिए", "oncology"],
  ["ta", "என் அப்பாவுக்கு டயாலிசிஸ் வேண்டும்", "dialysis"],
  ["ta", "என் மனைவி கர்ப்பமாக இருக்கிறாள்", "obstetrics"],
  ["ta", "எம்ஆர்ஐ ஸ்கேன் எடுக்க வேண்டும்", "mri"],
  ["ta", "அம்மாவுக்கு புற்றுநோய் சிகிச்சை வேண்டும்", "oncology"],
  ["ta", "இரத்த வங்கி எங்கே உள்ளது", "blood_bank"],
  ["ta", "சிசேரியன் செய்ய வேண்டும்", "c_section"],
  ["te", "మా అమ్మకు డయాలసిస్ కావాలి", "dialysis"],
  ["te", "నా భార్య గర్భిణి, ప్రసవం కోసం ఆసుపత్రి కావాలి", "obstetrics"],
  ["te", "ఎంఆర్ఐ స్కాన్ చేయించాలి", "mri"],
  ["te", "నాన్నకు క్యాన్సర్ చికిత్స కావాలి", "oncology"],
  ["te", "రక్తం కావాలి", "blood_bank"],
  ["te", "సిజేరియన్ ఆపరేషన్ కావాలి", "c_section"],
  ["ml", "അമ്മയ്ക്ക് ഡയാലിസിസ് വേണം", "dialysis"],
  ["ml", "ഭാര്യ ഗർഭിണിയാണ്, പ്രസവത്തിന് ആശുപത്രി വേണം", "obstetrics"],
  ["ml", "എംആർഐ സ്കാൻ ചെയ്യണം", "mri"],
  ["ml", "അച്ഛന് കാൻസർ ചികിത്സ വേണം", "oncology"],
  ["ml", "രക്തം വേണം", "blood_bank"],
  ["ml", "സിസേറിയൻ വേണം", "c_section"],
];

describe("understanding a typed or spoken need in each language", () => {
  it.each(NEEDS)("[%s] %s -> %s", (_l, text, service) => {
    expect(matchNeeds(text)?.services).toContain(service);
  });
  it("ignores zero-width joiners that Indian keyboards insert", () => {
    expect(matchNeeds("ఎం‌ఆర్‌ఐ స్కాన్")?.services).toContain("mri");
  });
  it("matches English keywords as whole words only", () => {
    expect(matchNeeds("I need to see a doctor")?.services ?? []).not.toContain("ct_scan");      // "ct" in "doctor"
    expect(matchNeeds("a particular pain in the knee")?.services ?? []).not.toContain("icu");    // "icu" in "particular"
    expect(matchNeeds("I need a CT scan")?.services).toContain("ct_scan");
  });
  it("an emergency in any of the five languages still goes to the gate first", () => {
    for (const text of ["chest pain", "सीने में दर्द", "நெஞ்சு வலி", "ఛాతీ నొప్పి", "നെഞ്ചുവേദന"]) expect(checkRedFlags(text)?.categories[0].id, text).toBe("cardiac");
  });
});

const post = (body: unknown) => new Request("http://t/api/triage", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { _resetRateLimitForTests(); delete process.env.FM_ENDPOINT; delete process.env.DATABRICKS_HOST; });

describe("POST /api/triage in Indian languages", () => {
  const cases: [string, string, ServiceId, string][] = [
    ["hi", "पटना में डायलिसिस चाहिए", "dialysis", "BIHAR"],
    ["ta", "சென்னையில் டயாலிசிஸ் வேண்டும்", "dialysis", "TAMIL NADU"],
    ["te", "హైదరాబాద్‌లో ఎంఆర్ఐ స్కాన్ కావాలి", "mri", "TELANGANA"],
    ["ml", "കൊച്ചിയിൽ ഡയാലിസിസ് വേണം", "dialysis", "KERALA"],
  ];
  it.each(cases)("[%s] %s", async (lang, message, service, state) => {
    const j = await (await triagePost(post({ message, lang }))).json();
    expect(j.triage.services).toContain(service);
    expect(j.location?.state).toBe(state);
  });
  it("accepts an unknown language code without failing", async () => {
    const r = await triagePost(post({ message: "dialysis near Patna", lang: "fr" }));
    expect(r.status).toBe(200);
  });
});
