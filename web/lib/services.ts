import type { ServiceId } from "./types";

export interface ServiceInfo {
  id: ServiceId;
  en: string;
  hi: string;                 // Hindi labels still need review by a native speaker
  plain: string;              // one-line plain-language explanation for the UI
  urgentByNature: boolean;    // shown first in "what is available near you"
  keywords: string[];         // used by the rule-based fallback to map a typed need to this service
}

export const SERVICES: ServiceInfo[] = [
  { id: "trauma_emergency", en: "Emergency and trauma care", hi: "आपातकालीन और चोट का इलाज", plain: "24-hour emergency room and treatment for serious injuries", urgentByNature: true,
    keywords: ["emergency", "accident", "injury", "trauma", "fracture", "bleeding", "wound", "burn injury", "road accident", "आपातकाल", "दुर्घटना", "चोट", "हादसा"] },
  { id: "icu", en: "Intensive care (ICU)", hi: "गहन चिकित्सा (आईसीयू)", plain: "A ward for people who are critically ill", urgentByNature: true,
    keywords: ["icu", "intensive care", "critical", "unconscious", "आईसीयू", "गंभीर"] },
  { id: "ventilator", en: "Ventilator (breathing support)", hi: "वेंटिलेटर (साँस की मशीन)", plain: "Machine support for people who cannot breathe on their own", urgentByNature: true,
    keywords: ["ventilator", "breathing support", "cannot breathe", "oxygen support", "वेंटिलेटर"] },
  { id: "c_section", en: "Caesarean delivery (C-section)", hi: "सी-सेक्शन (ऑपरेशन से प्रसव)", plain: "Surgical delivery of a baby, including emergencies", urgentByNature: true,
    keywords: ["c-section", "c section", "caesarean", "cesarean", "operation delivery", "सी सेक्शन", "ऑपरेशन से डिलीवरी"] },
  { id: "obstetrics", en: "Pregnancy and childbirth care", hi: "गर्भावस्था और प्रसव की देखभाल", plain: "Antenatal care, normal delivery and maternity wards", urgentByNature: true,
    keywords: ["pregnant", "pregnancy", "delivery", "labour", "labor", "maternity", "antenatal", "गर्भवती", "प्रसव", "डिलीवरी", "प्रेग्नेंसी"] },
  { id: "nicu", en: "Newborn intensive care (NICU)", hi: "नवजात गहन देखभाल (एनआईसीयू)", plain: "Intensive care for sick or premature newborn babies", urgentByNature: true,
    keywords: ["nicu", "newborn", "premature baby", "preterm", "नवजात", "समय से पहले जन्मा"] },
  { id: "cath_lab", en: "Heart tests and angioplasty (cath lab)", hi: "हृदय जाँच और एंजियोप्लास्टी (कैथ लैब)", plain: "Unblocking and testing the heart's arteries", urgentByNature: true,
    keywords: ["cath lab", "angiography", "angioplasty", "heart attack", "stent", "chest pain", "एंजियोग्राफी", "हार्ट अटैक", "दिल का दौरा", "सीने में दर्द"] },
  { id: "cardiac_surgery", en: "Heart surgery", hi: "हृदय की सर्जरी", plain: "Operations on the heart, such as bypass or valve surgery", urgentByNature: false,
    keywords: ["cardiac surgery", "heart surgery", "bypass", "cabg", "valve", "हृदय सर्जरी", "बायपास"] },
  { id: "dialysis", en: "Dialysis (kidney)", hi: "डायलिसिस (गुर्दे)", plain: "Machine treatment that cleans the blood when kidneys fail", urgentByNature: false,
    keywords: ["dialysis", "kidney failure", "kidney washing", "renal", "haemodialysis", "hemodialysis", "डायलिसिस", "गुर्दे", "किडनी"] },
  { id: "burn_care", en: "Burn care", hi: "जलने का इलाज", plain: "Specialist treatment for serious burns", urgentByNature: true,
    keywords: ["burn", "burns", "scald", "fire injury", "जलना", "जल गया", "आग"] },
  { id: "blood_bank", en: "Blood bank", hi: "ब्लड बैंक", plain: "Blood available for transfusion", urgentByNature: true,
    keywords: ["blood bank", "blood transfusion", "need blood", "ब्लड बैंक", "खून चाहिए"] },
  { id: "oncology", en: "Cancer care", hi: "कैंसर का इलाज", plain: "Diagnosis and treatment of cancer", urgentByNature: false,
    keywords: ["cancer", "tumour", "tumor", "chemotherapy", "chemo", "oncology", "कैंसर", "कीमो"] },
  { id: "linear_accelerator", en: "Radiation therapy", hi: "रेडियोथेरेपी (विकिरण)", plain: "Radiation machines used to treat cancer", urgentByNature: false,
    keywords: ["radiation", "radiotherapy", "linear accelerator", "linac", "रेडियोथेरेपी", "रेडिएशन"] },
  { id: "mri", en: "MRI scan", hi: "एमआरआई स्कैन", plain: "Detailed scan of the brain, spine and joints", urgentByNature: false,
    keywords: ["mri", "mri scan", "एमआरआई"] },
  { id: "ct_scan", en: "CT scan", hi: "सीटी स्कैन", plain: "Fast scan used for injuries, strokes and infections", urgentByNature: false,
    keywords: ["ct scan", "ct", "cat scan", "सीटी स्कैन"] },
];

export const SERVICE_BY_ID: Record<string, ServiceInfo> = Object.fromEntries(SERVICES.map((s) => [s.id, s]));
export const SERVICE_IDS = SERVICES.map((s) => s.id);
export const isServiceId = (x: string): x is ServiceId => x in SERVICE_BY_ID;
