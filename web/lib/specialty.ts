import type { Lang } from "./i18n";

/**
 * Plain-language specialty categories. Each facility carries `sc` (see scripts/add_specialties.py), most-listed first.
 * A typed need that maps to no specific service we hold evidence for (leg pain, fever, rash) is matched to these by keyword,
 * so different needs return different hospitals. DRAFT: keywords and the four non-English label sets need native-speaker review.
 */
export interface Specialty { id: string; en: string; kw: string[] }

// Latin keywords match whole words; Indic keywords are stems matched anywhere (those languages add endings to words).
export const SPECIALTIES: Specialty[] = [
  { id: "bones", en: "Bones and joints", kw: ["bone", "bones", "joint", "joints", "knee", "leg pain", "leg", "back pain", "backache", "spine", "shoulder", "hip", "neck pain", "sprain", "arthritis", "fracture", "ankle", "elbow", "wrist", "muscle", "cramp", "orthopedic", "orthopaedic",
    "घुटना", "जोड़", "पैर", "टांग", "कमर", "हड्डी", "कंधा", "गर्दन", "மூட்டு", "கால் வலி", "முழங்கால்", "முதுகு", "எலும்பு", "தோள்", "மூட்டுவலி", "మోకాలు", "కీళ్ళ", "కాలు నొప్పి", "నడుము", "ఎముక", "భుజ", "മുട്ട്", "സന്ധി", "കാലുവേദന", "നടുവേദന", "എല്ല്", "തോൾ"] },
  { id: "heart", en: "Heart", kw: ["heart", "chest pain", "palpitation", "palpitations", "blood pressure", "bp", "cardiac", "cholesterol", "angina",
    "दिल", "हृदय", "सीने में दर्द", "धड़कन", "रक्तचाप", "இதய", "நெஞ்சு வலி", "படபடப்பு", "இரத்த அழுத்தம்", "గుండె", "ఛాతీ నొప్పి", "రక్తపోటు", "ഹൃദയ", "നെഞ്ചുവേദന", "രക്തസമ്മർദ"] },
  { id: "brain", en: "Brain and nerves", kw: ["headache", "migraine", "seizure", "seizures", "fits", "epilepsy", "stroke", "numbness", "dizziness", "dizzy", "paralysis", "tremor", "memory", "neurology", "nerve", "nerves", "faint", "fainting",
    "सिर दर्द", "सिरदर्द", "चक्कर", "दौरा", "लकवा", "तलवेदना", "தலைவலி", "தலை வலி", "வலிப்பு", "மயக்கம்", "பக்கவாதம்", "తలనొప్పి", "తల నొప్పి", "మూర్ఛ", "తల తిరుగుడు", "పక్షవాతం", "തലവേദന", "അപസ്മാര", "തലചുറ്റൽ", "പക്ഷാഘാത"] },
  { id: "chest", en: "Chest and lungs", kw: ["cough", "breathless", "breathlessness", "shortness of breath", "asthma", "wheezing", "lungs", "lung", "tb", "tuberculosis", "pneumonia", "phlegm",
    "खांसी", "खाँसी", "सांस", "दमा", "फेफड़", "இருமல்", "மூச்சுத் திணறல்", "ஆஸ்துமா", "நுரையீரல்", "దగ్గు", "ఊపిరి", "ఆస్తమా", "ఊపిరితిత్తులు", "ചുമ", "ശ്വാസംമുട്ട", "ആസ്ത്മ", "ശ്വാസകോശ"] },
  { id: "stomach", en: "Stomach and liver", kw: ["stomach", "stomach pain", "abdominal", "abdomen", "belly", "acidity", "gas", "vomiting", "vomit", "nausea", "diarrhoea", "diarrhea", "loose motion", "loose motions", "jaundice", "liver", "constipation", "indigestion", "piles", "ulcer",
    "पेट", "उल्टी", "दस्त", "पीलिया", "कब्ज", "एसिडिटी", "வயிறு", "வாந்தி", "வயிற்றுப்போக்கு", "மஞ்சள் காமாலை", "கல்லீரல்", "కడుపు", "వాంతి", "విరేచన", "కామెర్లు", "కాలేయ", "വയർ", "ഛർദ്ദി", "വയറിളക്കം", "മഞ്ഞപ്പിത്തം", "കരൾ"] },
  { id: "skin", en: "Skin", kw: ["skin", "rash", "itching", "itch", "acne", "pimples", "allergy", "hair fall", "hair loss", "eczema", "fungal", "dandruff", "dermatology",
    "त्वचा", "खुजली", "दाने", "फुंसी", "கட்டி", "தோல்", "அரிப்பு", "முகப்பரு", "சருமம்", "చర్మం", "దురద", "మొటిమలు", "ചർമ്മം", "ചൊറിച്ചിൽ", "മുഖക്കുരു"] },
  { id: "eye", en: "Eyes", kw: ["eye", "eyes", "vision", "cataract", "red eye", "blurred", "glasses", "spectacles", "eyesight",
    "आंख", "आँख", "नजर", "मोतियाबिंद", "கண்", "பார்வை", "கண் புரை", "కన్ను", "కళ్ళు", "చూపు", "కంటి", "കണ്ണ്", "കാഴ്ച", "തിമിരം"] },
  { id: "ent", en: "Ear, nose and throat", kw: ["ear", "ears", "throat", "nose", "sinus", "tonsil", "tonsils", "hearing", "earache", "sore throat", "nosebleed", "cold",
    "कान", "गला", "नाक", "साइनस", "காது", "தொண்டை", "மூக்கு", "చెవి", "గొంతు", "ముక్కు", "ചെവി", "തൊണ്ട", "മൂക്ക്"] },
  { id: "dental", en: "Teeth", kw: ["tooth", "teeth", "gum", "gums", "dental", "dentist", "cavity", "toothache", "braces",
    "दांत", "दाँत", "मसूड", "பல்", "பல் வலி", "ஈறு", "పన్ను", "పళ్ళు", "చిగుళ్ళ", "പല്ല്", "പല്ലുവേദന", "മോണ"] },
  { id: "women", en: "Women's health", kw: ["period", "periods", "menstrual", "menstruation", "pcos", "pcod", "gynae", "gynaecologist", "gynecologist", "white discharge", "breast", "fertility", "infertility", "menopause", "pregnant", "pregnancy",
    "मासिक", "पीरियड", "माहवारी", "स्त्री रोग", "மாதவிடாய்", "கருத்தரிப்பு", "மகளிர்", "నెలసరి", "రుతుక్రమ", "మహిళ", "ആർത്തവ", "വന്ധ്യത", "സ്ത്രീ"] },
  { id: "child", en: "Children", kw: ["child", "children", "baby", "babies", "infant", "kid", "kids", "toddler", "newborn", "vaccination", "vaccine", "pediatric", "paediatric",
    "बच्चा", "बच्चे", "शिशु", "टीका", "குழந்தை", "தடுப்பூசி", "పిల్లల", "బిడ్డ", "టీకా", "കുട്ടി", "കുഞ്ഞ്", "വാക്സിൻ"] },
  { id: "urology", en: "Urine and kidney", kw: ["urine", "urinary", "kidney", "kidney stone", "stone", "prostate", "burning urination", "bladder", "urology", "dialysis",
    "पेशाब", "मूत्र", "गुर्दा", "किडनी", "पथरी", "சிறுநீர்", "சிறுநீரகம்", "கல்", "మూత్ర", "కిడ్నీ", "రాయి", "മൂത്ര", "വൃക്ക", "കല്ല്"] },
  { id: "diabetes", en: "Diabetes and hormones", kw: ["diabetes", "sugar", "thyroid", "hormone", "hormones", "insulin", "weight gain", "obesity",
    "मधुमेह", "शुगर", "थायराइड", "நீரிழிவு", "சர்க்கரை", "தைராய்டு", "మధుమేహం", "షుగర్", "థైరాయిడ్", "പ്രമേഹം", "ഷുഗർ", "തൈറോയ്ഡ്"] },
  { id: "mental", en: "Mental health", kw: ["depression", "anxiety", "stress", "panic", "sleep", "insomnia", "mental", "psychiatrist", "addiction", "mood",
    "अवसाद", "तनाव", "चिंता", "नींद", "மன அழுத்தம்", "பதட்டம்", "தூக்கம்", "ఒత్తిడి", "ఆందోళన", "నిద్ర", "വിഷാദം", "ഉത്കണ്ഠ", "ഉറക്കം"] },
  { id: "cancer", en: "Cancer", kw: ["cancer", "tumour", "tumor", "lump", "chemotherapy", "chemo", "biopsy",
    "कैंसर", "गांठ", "ट्यूमर", "புற்றுநோய்", "கட்டி", "క్యాన్సర్", "గడ్డ", "కణితి", "കാൻസർ", "മുഴ", "അർബുദ"] },
  { id: "emergency", en: "Emergency and critical care", kw: ["accident", "injury", "injured", "bleeding", "burn", "burns", "snake bite", "unconscious", "emergency", "poison", "poisoning", "head injury", "wound",
    "दुर्घटना", "चोट", "खून", "जलना", "साँप", "बेहोश", "விபத்து", "காயம்", "இரத்தப்போக்கு", "பாம்பு", "மயங்கி", "ప్రమాద", "గాయం", "రక్తస్రావం", "పాము", "అపస్మారక", "അപകട", "പരിക്ക്", "രക്തസ്രാവം", "പാമ്പ്"] },
  { id: "tests", en: "Scans and tests", kw: ["scan", "xray", "x-ray", "mri", "ct", "ultrasound", "blood test", "lab", "laboratory", "report", "checkup", "check-up", "health check",
    "जांच", "स्कैन", "एक्स-रे", "परीक्षण", "பரிசோதனை", "ஸ்கேன்", "பரிசோதன", "పరీక్ష", "స్కాన్", "പരിശോധന", "സ്കാൻ"] },
  { id: "surgery", en: "Surgery", kw: ["surgery", "operation", "hernia", "appendix", "appendicitis", "gallstone", "gallbladder", "plastic surgery",
    "ऑपरेशन", "सर्जरी", "अपेंडिक्स", "அறுவை", "ஆபரேஷன்", "శస్త్రచికిత్స", "ఆపరేషన్", "ശസ്ത്രക്രിയ", "ഓപ്പറേഷൻ"] },
  { id: "general", en: "General medicine", kw: ["fever", "flu", "viral", "infection", "weakness", "tired", "tiredness", "fatigue", "body ache", "body pain", "pain", "dengue", "malaria", "typhoid", "chikungunya", "swelling", "unwell", "sick", "doctor", "physician",
    "बुखार", "ज्वर", "कमजोरी", "थकान", "बदन दर्द", "दर्द", "डेंगू", "मलेरिया", "காய்ச்சல்", "சோர்வு", "உடல் வலி", "வலி", "டெங்கு", "జ్వరం", "నీరసం", "ఒళ్ళు నొప్పి", "నొప్పి", "డెంగ్యూ", "പനി", "ക്ഷീണം", "ശരീരവേദന", "വേദന", "ഡെങ്കി"] },
];

const BY_ID = new Map(SPECIALTIES.map((s) => [s.id, s]));
export const isSpecialtyId = (x: unknown): x is string => typeof x === "string" && BY_ID.has(x);

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s'-]+/gu, " ").replace(/\s+/g, " ").trim();
const LATIN = /^[a-z0-9' -]+$/;

/** Specialty categories a typed need points to, best match first. More specific words outrank the generic "general"/"pain" ones. */
export function matchSpecialties(text: string): string[] {
  const t = ` ${norm(text)} `;
  if (t.trim().length < 2) return [];
  const score = new Map<string, number>();
  for (const s of SPECIALTIES) {
    for (const k of s.kw) {
      const kk = norm(k);
      if (!kk) continue;
      const hit = LATIN.test(kk) ? t.includes(` ${kk} `) || t.includes(` ${kk}s `) : t.includes(kk);
      if (hit) score.set(s.id, Math.max(score.get(s.id) ?? 0, kk.length + (kk.includes(" ") ? 6 : 0)));   // longer, multi-word phrases are more specific
    }
  }
  const generic = new Set(["general", "tests"]);
  const ranked = [...score.entries()].sort((a, b) => Number(generic.has(a[0])) - Number(generic.has(b[0])) || b[1] - a[1]).map(([id]) => id);
  const specific = ranked.filter((id) => !generic.has(id));
  return (specific.length ? specific : ranked).slice(0, 3);       // "pain" or "fever" alone means general medicine; with a body part, the body part wins
}

const LABELS: Record<Exclude<Lang, "en">, Record<string, string>> = {
  hi: { bones: "हड्डी और जोड़", heart: "हृदय", brain: "मस्तिष्क और नसें", chest: "छाती और फेफड़े", stomach: "पेट और लिवर", skin: "त्वचा", eye: "आँखें", ent: "कान, नाक, गला", dental: "दाँत", women: "महिला स्वास्थ्य", child: "बच्चे", urology: "मूत्र और गुर्दा", diabetes: "मधुमेह और हार्मोन", mental: "मानसिक स्वास्थ्य", cancer: "कैंसर", emergency: "आपातकाल और गहन देखभाल", tests: "स्कैन और जाँच", surgery: "सर्जरी", general: "सामान्य चिकित्सा" },
  ta: { bones: "எலும்பு மற்றும் மூட்டு", heart: "இதயம்", brain: "மூளை மற்றும் நரம்பு", chest: "மார்பு மற்றும் நுரையீரல்", stomach: "வயிறு மற்றும் கல்லீரல்", skin: "தோல்", eye: "கண்கள்", ent: "காது, மூக்கு, தொண்டை", dental: "பல்", women: "மகளிர் நலம்", child: "குழந்தைகள்", urology: "சிறுநீர் மற்றும் சிறுநீரகம்", diabetes: "நீரிழிவு மற்றும் ஹார்மோன்", mental: "மன நலம்", cancer: "புற்றுநோய்", emergency: "அவசர மற்றும் தீவிர சிகிச்சை", tests: "ஸ்கேன் மற்றும் பரிசோதனை", surgery: "அறுவை சிகிச்சை", general: "பொது மருத்துவம்" },
  te: { bones: "ఎముకలు మరియు కీళ్ళు", heart: "గుండె", brain: "మెదడు మరియు నరాలు", chest: "ఛాతీ మరియు ఊపిరితిత్తులు", stomach: "కడుపు మరియు కాలేయం", skin: "చర్మం", eye: "కళ్ళు", ent: "చెవి, ముక్కు, గొంతు", dental: "దంతాలు", women: "మహిళల ఆరోగ్యం", child: "పిల్లలు", urology: "మూత్రం మరియు కిడ్నీ", diabetes: "మధుమేహం మరియు హార్మోన్లు", mental: "మానసిక ఆరోగ్యం", cancer: "క్యాన్సర్", emergency: "అత్యవసర మరియు ఇంటెన్సివ్ కేర్", tests: "స్కాన్లు మరియు పరీక్షలు", surgery: "శస్త్రచికిత్స", general: "సాధారణ వైద్యం" },
  ml: { bones: "എല്ലും സന്ധികളും", heart: "ഹൃദയം", brain: "തലച്ചോറും ഞരമ്പുകളും", chest: "നെഞ്ചും ശ്വാസകോശവും", stomach: "വയറും കരളും", skin: "ചർമ്മം", eye: "കണ്ണുകൾ", ent: "ചെവി, മൂക്ക്, തൊണ്ട", dental: "പല്ല്", women: "സ്ത്രീ ആരോഗ്യം", child: "കുട്ടികൾ", urology: "മൂത്രവും വൃക്കയും", diabetes: "പ്രമേഹവും ഹോർമോണും", mental: "മാനസികാരോഗ്യം", cancer: "ക്യാൻസർ", emergency: "അടിയന്തര, തീവ്രപരിചരണം", tests: "സ്കാനും പരിശോധനയും", surgery: "ശസ്ത്രക്രിയ", general: "പൊതു വൈദ്യം" },
};
export const specLabel = (id: string, lang: Lang): string => (lang === "en" ? BY_ID.get(id)?.en : LABELS[lang]?.[id] ?? BY_ID.get(id)?.en) ?? id;
