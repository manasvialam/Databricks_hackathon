import type { ServiceId } from "./types";

export interface ServiceInfo {
  id: ServiceId;
  en: string;
  plain: string;              // one-line plain-language explanation for the UI (other languages: lib/i18n/<lang>.ts)
  urgentByNature: boolean;    // shown first in "what is available near you"
  keywords: string[];         // used by the rule-based fallback to map a typed need to this service
}

// Keywords: English and romanised words match as whole words; Hindi, Tamil, Telugu and Malayalam entries are word
// stems matched anywhere, because those languages attach endings to words (டயாலிசிஸுக்கு, "for dialysis").
// DRAFT: the non-English keywords need review by native speakers; add the words people actually use.
export const SERVICES: ServiceInfo[] = [
  { id: "trauma_emergency", en: "Emergency and trauma care", plain: "24-hour emergency room and treatment for serious injuries", urgentByNature: true,
    keywords: ["emergency", "accident", "injury", "trauma", "fracture", "bleeding", "wound", "burn injury", "road accident",
      "आपातकाल", "दुर्घटना", "चोट", "हादसा", "इमरजेंसी", "फ्रैक्चर",
      "அவசர", "விபத்து", "காயம்", "எலும்பு முறி",
      "అత్యవసర", "ఎమర్జెన్సీ", "ప్రమాద", "గాయ", "ఎముక విరి", "ఫ్రాక్చర్",
      "അടിയന്തര", "അത്യാഹിത", "എമർജൻസി", "അപകട", "പരിക്ക", "ഒടിവ്", "ഫ്രാക്ചർ"] },
  { id: "icu", en: "Intensive care (ICU)", plain: "A ward for people who are critically ill", urgentByNature: true,
    keywords: ["icu", "intensive care", "critical", "unconscious", "आईसीयू", "गंभीर",
      "ஐசியு", "ஐ.சி.யு", "தீவிர சிகிச்சை", "ఐసీయూ", "ఐసియు", "ఐ.సి.యు", "ఇంటెన్సివ్ కేర్", "ഐസിയു", "ഐ.സി.യു", "തീവ്രപരിചരണ"] },
  { id: "ventilator", en: "Ventilator (breathing support)", plain: "Machine support for people who cannot breathe on their own", urgentByNature: true,
    keywords: ["ventilator", "breathing support", "cannot breathe", "oxygen support", "वेंटिलेटर", "वेंटीलेटर",
      "வென்டிலேட்டர்", "வெண்டிலேட்டர்", "వెంటిలేటర్", "വെന്റിലേറ്റർ"] },
  { id: "c_section", en: "Caesarean delivery (C-section)", plain: "Surgical delivery of a baby, including emergencies", urgentByNature: true,
    keywords: ["c-section", "c section", "caesarean", "cesarean", "operation delivery", "सी सेक्शन", "ऑपरेशन से डिलीवरी", "सिजेरियन", "सीजेरियन",
      "சிசேரியன்", "சி செக்ஷன்", "சி-செக்ஷன்", "அறுவை சிகிச்சை பிரசவ",
      "సిజేరియన్", "సి సెక్షన్", "సి-సెక్షన్", "ఆపరేషన్ ద్వారా ప్రసవ", "ఆపరేషన్ డెలివరీ",
      "സിസേറിയൻ", "സി സെക്ഷൻ", "സി-സെക്ഷൻ", "ഓപ്പറേഷൻ വഴി പ്രസവ"] },
  { id: "obstetrics", en: "Pregnancy and childbirth care", plain: "Antenatal care, normal delivery and maternity wards", urgentByNature: true,
    keywords: ["pregnant", "pregnancy", "delivery", "labour", "labor", "maternity", "antenatal", "गर्भवती", "प्रसव", "डिलीवरी", "प्रेग्नेंसी", "गर्भावस्था",
      "கர்ப்ப", "பிரசவ", "டெலிவரி", "மகப்பேறு", "గర్భ", "ప్రసవ", "డెలివరీ", "కాన్పు", "ഗർഭ", "പ്രസവ", "ഡെലിവറി"] },
  { id: "nicu", en: "Newborn intensive care (NICU)", plain: "Intensive care for sick or premature newborn babies", urgentByNature: true,
    keywords: ["nicu", "newborn", "premature baby", "preterm", "नवजात", "समय से पहले जन्मा",
      "பச்சிளம்", "குறைமாத", "என்ஐசியு", "నవజాత", "నెలలు నిండని", "ఎన్ఐసీయూ", "നവജാത", "മാസം തികയാ", "എൻഐസിയു"] },
  { id: "cath_lab", en: "Heart tests and angioplasty (cath lab)", plain: "Unblocking and testing the heart's arteries", urgentByNature: true,
    keywords: ["cath lab", "angiography", "angioplasty", "heart attack", "stent", "chest pain", "एंजियोग्राफी", "एंजियोप्लास्टी", "स्टेंट", "हार्ट अटैक", "दिल का दौरा", "सीने में दर्द",
      "ஆஞ்சியோ", "ஸ்டென்ட்", "యాంజియో", "స్టెంట్", "ആൻജിയോ", "സ്റ്റെന്റ്"] },
  { id: "cardiac_surgery", en: "Heart surgery", plain: "Operations on the heart, such as bypass or valve surgery", urgentByNature: false,
    keywords: ["cardiac surgery", "heart surgery", "bypass", "cabg", "valve", "हृदय सर्जरी", "बायपास", "दिल का ऑपरेशन", "हार्ट सर्जरी",
      "இதய அறுவை", "இருதய அறுவை", "பைபாஸ்", "ஹார்ட் சர்ஜரி", "గుండె ఆపరేషన్", "గుండె శస్త్రచికిత్స", "బైపాస్", "హార్ట్ సర్జరీ",
      "ഹൃദയ ശസ്ത്രക്രിയ", "ബൈപാസ്", "ഹാർട്ട് സർജറി"] },
  { id: "dialysis", en: "Dialysis (kidney)", plain: "Machine treatment that cleans the blood when kidneys fail", urgentByNature: false,
    keywords: ["dialysis", "kidney failure", "kidney washing", "renal", "haemodialysis", "hemodialysis", "डायलिसिस", "गुर्दे", "गुर्दा", "किडनी",
      "டயாலிசிஸ", "சிறுநீரக", "கிட்னி", "డయాలసిస్", "డయాలిసిస్", "కిడ్నీ", "మూత్రపిండ", "ഡയാലിസിസ്", "വൃക്ക", "കിഡ്നി"] },
  { id: "burn_care", en: "Burn care", plain: "Specialist treatment for serious burns", urgentByNature: true,
    keywords: ["burn", "burns", "scald", "fire injury", "जलना", "जल गया", "आग", "தீக்காய", "தீப்புண்", "కాలిన", "కాలిపో", "പൊള്ള"] },
  { id: "blood_bank", en: "Blood bank", plain: "Blood available for transfusion", urgentByNature: true,
    keywords: ["blood bank", "blood transfusion", "need blood", "ब्लड बैंक", "खून चाहिए",
      "இரத்த வங்கி", "ரத்த வங்கி", "இரத்தம் தேவை", "ரத்தம் தேவை", "இரத்தம் வேண்டும்", "ரத்தம் வேண்டும்",
      "బ్లడ్ బ్యాంక్", "రక్త నిధి", "రక్తం కావాలి", "రక్తం అవసరం", "ബ്ലഡ് ബാങ്ക്", "രക്തബാങ്ക്", "രക്ത ബാങ്ക്", "രക്തം വേണം", "രക്തം ആവശ്യ"] },
  { id: "oncology", en: "Cancer care", plain: "Diagnosis and treatment of cancer", urgentByNature: false,
    keywords: ["cancer", "tumour", "tumor", "chemotherapy", "chemo", "oncology", "कैंसर", "कीमो",
      "புற்றுநோய்", "புற்று நோய்", "கேன்சர்", "கீமோ", "క్యాన్సర్", "కేన్సర్", "కీమో", "కణితి", "കാൻസർ", "ക്യാൻസർ", "അർബുദ", "കീമോ"] },
  { id: "linear_accelerator", en: "Radiation therapy", plain: "Radiation machines used to treat cancer", urgentByNature: false,
    keywords: ["radiation", "radiotherapy", "linear accelerator", "linac", "रेडियोथेरेपी", "रेडिएशन",
      "கதிர்வீச்சு", "ரேடியேஷன்", "ரேடியோதெரபி", "రేడియేషన్", "రేడియోథెరపీ", "റേഡിയേഷൻ", "റേഡിയോതെറാപ്പി", "റേഡിയോ തെറാപ്പി"] },
  { id: "mri", en: "MRI scan", plain: "Detailed scan of the brain, spine and joints", urgentByNature: false,
    keywords: ["mri", "mri scan", "एमआरआई", "எம்ஆர்ஐ", "எம்.ஆர்.ஐ", "ఎంఆర్ఐ", "ఎమ్ఆర్ఐ", "ఎం.ఆర్.ఐ", "എംആർഐ", "എം.ആർ.ഐ"] },
  { id: "ct_scan", en: "CT scan", plain: "Fast scan used for injuries, strokes and infections", urgentByNature: false,
    keywords: ["ct scan", "ct", "cat scan", "सीटी स्कैन", "சிடி ஸ்கேன்", "சி.டி ஸ்கேன்", "சி.டி. ஸ்கேன்", "సీటీ స్కాన్", "సిటి స్కాన్", "సీటీస్కాన్",
      "സിടി സ്കാൻ", "സി.ടി സ്കാൻ", "സി.ടി. സ്കാൻ"] },
];

export const SERVICE_BY_ID: Record<string, ServiceInfo> = Object.fromEntries(SERVICES.map((s) => [s.id, s]));
export const SERVICE_IDS = SERVICES.map((s) => s.id);
export const isServiceId = (x: string): x is ServiceId => x in SERVICE_BY_ID;

const LATIN = /^[\x20-\x7e]+$/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MATCHERS = SERVICES.map((s) => ({
  id: s.id,
  // whole words for English ("ct" must not match "doctor", "icu" must not match "particular"); stems for Indian scripts
  latin: s.keywords.filter((k) => LATIN.test(k)).map((k) => new RegExp(`(?<![a-z])${escape(k.toLowerCase())}(?![a-z])`)),
  indic: s.keywords.filter((k) => !LATIN.test(k)).map((k) => k.normalize("NFC")),
}));

/** Services named directly in a message ("I need an MRI", "டயாலிசிஸ் வேண்டும்"). `text` should be NFC, without zero-width joiners. */
export function servicesNamedIn(text: string): ServiceId[] {
  const lower = text.toLowerCase();
  return MATCHERS.filter((m) => m.latin.some((r) => r.test(lower)) || m.indic.some((k) => text.includes(k))).map((m) => m.id);
}
