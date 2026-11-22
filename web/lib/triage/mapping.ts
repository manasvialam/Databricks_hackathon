import type { ServiceId, Urgency } from "../types";
import { SERVICE_BY_ID, servicesNamedIn } from "../services";
import { asciiDigits, indicPlaceCandidates } from "../indic";
import { cleanText } from "./redflags.indic";

export interface Condition { name: string; why: string }
export interface NeedMatch { services: ServiceId[]; urgency: Urgency; conditions: Condition[]; label: string; confidence: "high" | "low" }

const re = (s: string) => new RegExp(s, "iu");

interface Rule { id: string; patterns: RegExp[]; services: ServiceId[]; urgency: Urgency; conditions: Condition[]; label: string; confidence?: "high" | "low" }

// Reviewed rule table: a symptom pattern maps to the care that is usually needed, never to a diagnosis.
// Conditions are phrased as "patterns that can be seen with"; a clinician must confirm. Needs clinical review before launch.
const RULES: Rule[] = [
  { id: "kidney", label: "Kidney care", services: ["dialysis"], urgency: "urgent",
    patterns: [re("kidney\\s*(failure|problem|disease|kharab|fail)"), re("dialysis"), re("not\\s+passing\\s+urine"), re("urine.{0,20}(very\\s+little|stopped)"), re("गुर्दे|गुर्दा|किडनी"), re("डायलिसिस"),
      re("சிறுநீரக|கிட்னி|டயாலிசிஸ"), re("కిడ్నీ|మూత్రపిండ|డయాలసిస్|డయాలిసిస్"), re("വൃക്ക|കിഡ്നി|ഡയാലിസിസ്")],
    conditions: [{ name: "Kidney problems", why: "Dialysis is used when the kidneys cannot clean the blood" }] },
  { id: "heart", label: "Heart care", services: ["cath_lab", "cardiac_surgery"], urgency: "urgent", confidence: "low",
    patterns: [re("palpitation"), re("irregular\\s+heart"), re("heart\\s+(problem|disease|surgery|blockage)"), re("blocked\\s+artery"), re("angioplasty|angiography|bypass"), re("दिल\\s*की\\s*(बीमारी|धड़कन)"), re("हृदय"),
      re("இதய\\s*(நோய்|பிரச்சனை|பிரச்சினை|அடைப்பு)|இருதய|படபடப்பு|ஆஞ்சியோ|பைபாஸ்"), re("గుండె\\s*(జబ్బు|సమస్య|దడ|బ్లాక్)|యాంజియో|బైపాస్"), re("ഹൃദ്രോഗ|ഹൃദയ\\s*(രോഗ|പ്രശ്ന|ബ്ലോക്ക്)|നെഞ്ചിടിപ്പ്|ആൻജിയോ|ബൈപാസ്")],
    conditions: [{ name: "A heart rhythm or blocked-artery problem", why: "These symptoms can be seen with heart conditions; tests such as angiography check this" }] },
  { id: "cancer", label: "Cancer care", services: ["oncology", "linear_accelerator"], urgency: "urgent",
    patterns: [re("cancer|tumou?r|biops|chemo"), re("lump\\s+(in|on)"), re("कैंसर|ट्यूमर|कीमो"), re("புற்று|கேன்சர்|கீமோ"), re("క్యాన్సర్|కేన్సర్|కీమో|కణితి"), re("കാൻസർ|ക്യാൻസർ|അർബുദ|കീമോ")],
    conditions: [{ name: "Something that needs specialist tests", why: "A growing lump or a known cancer needs an oncology team" }] },
  { id: "pregnancy", label: "Pregnancy care", services: ["obstetrics", "c_section"], urgency: "urgent",
    patterns: [re("pregnan"), re("antenatal"), re("due\\s+date"), re("expecting\\s+a\\s+baby"), re("delivery"), re("गर्भवती|प्रेग्नेंट|गर्भ"), re("डिलीवरी|प्रसव"),
      re("கர்ப்ப|பிரசவ|மகப்பேறு"), re("గర్భ|ప్రసవ|కాన్పు"), re("ഗർഭ|പ്രസവ")],
    conditions: [{ name: "Pregnancy or childbirth care", why: "Antenatal visits, delivery and, if needed, a caesarean" }] },
  { id: "c_section", label: "Caesarean delivery", services: ["c_section", "obstetrics", "blood_bank"], urgency: "urgent",
    patterns: [re("c[- ]?section|caesarean|cesarean"), re("operation\\s+(se\\s+)?delivery"), re("सी\\s*सेक्शन|सिजेरियन|सीजेरियन"), re("சிசேரியன்"), re("సిజేరియన్"), re("സിസേറിയൻ")],
    conditions: [{ name: "A caesarean delivery", why: "Surgery to deliver a baby" }] },
  { id: "newborn", label: "Newborn care", services: ["nicu"], urgency: "urgent",
    patterns: [re("premature\\s+baby|preterm|low\\s+birth\\s+weight"), re("newborn.{0,30}(jaundice|yellow|small|weak)"), re("नवजात"), re("பச்சிளம்|குறைமாத"), re("నవజాత|నెలలు\\s*నిండ"), re("നവജാത|മാസം\\s*തികയാ")],
    conditions: [{ name: "A newborn who needs close watching", why: "Premature or very small babies often need a newborn intensive care unit" }] },
  { id: "bone", label: "Bone and injury care", services: ["trauma_emergency", "ct_scan"], urgency: "urgent",
    patterns: [re("fractur|broken\\s+(bone|arm|leg)|broke\\s+my"), re("dislocat"), re("हड्डी\\s*(टूट|टूटी)|फ्रैक्चर"), re("எலும்பு\\s*முறி"), re("ఎముక\\s*విరి|ఫ్రాక్చర్"), re("എല്ല്\\s*ഒടി|ഒടിവ്|ഫ്രാക്ചർ")],
    conditions: [{ name: "A broken or dislocated bone", why: "These need an X-ray or scan and often a procedure" }] },
  { id: "burn", label: "Burn care", services: ["burn_care", "trauma_emergency"], urgency: "urgent",
    patterns: [re("\\bburn(s|ed|t)?\\b"), re("scald"), re("जल\\s*गया|जलने"), re("தீக்காய|தீப்புண்"), re("కాలిన\\s*గాయ|కాలిపో"), re("പൊള്ള")],
    conditions: [{ name: "A burn", why: "Burns can need specialist dressing and fluids" }] },
  { id: "blood", label: "Blood", services: ["blood_bank"], urgency: "urgent",
    patterns: [re("need\\s+blood"), re("blood\\s+(bank|transfusion|group)"), re("खून\\s*चाहिए|ब्लड\\s*बैंक"),
      re("(இரத்த|ரத்த)\\s*வங்கி|(இரத்தம்|ரத்தம்)\\s*(தேவை|வேண்டும்)"), re("రక్త\\s*నిధి|బ్లడ్\\s*బ్యాంక్|రక్తం\\s*(కావాలి|అవసరం)"), re("രക്ത\\s*ബാങ്ക്|രക്തബാങ്ക്|ബ്ലഡ്\\s*ബാങ്ക്|രക്തം\\s*(വേണം|ആവശ്യ)")],
    conditions: [{ name: "A need for blood", why: "Blood banks hold units for transfusion" }] },
  { id: "scan_mri", label: "MRI scan", services: ["mri"], urgency: "routine", patterns: [re("\\bmri\\b|एमआरआई|எம்ஆர்ஐ|எம்\\.ஆர்\\.ஐ|ఎంఆర్ఐ|ఎమ్ఆర్ఐ|എംആർഐ|എം\\.ആർ\\.ഐ")], conditions: [{ name: "A scan the doctor has asked for", why: "MRI shows soft tissue, brain and spine" }] },
  { id: "scan_ct", label: "CT scan", services: ["ct_scan"], urgency: "routine", patterns: [re("\\bct\\s*scan\\b|सीटी\\s*स्कैन|சி\\.?டி\\.?\\s*ஸ்கேன|సి\\.?టి\\s*స్కాన్|సీటీ\\s*స్కాన్|സി\\.?ടി\\.?\\s*സ്കാൻ")], conditions: [{ name: "A scan the doctor has asked for", why: "CT is fast and used for injuries and infections" }] },
  { id: "icu", label: "Intensive care", services: ["icu", "ventilator"], urgency: "urgent", patterns: [re("\\bicu\\b|intensive\\s+care|आईसीयू|ஐசியு|ఐసీయూ|ఐసియు|ഐസിയു|தீவிர\\s*சிகிச்சை|തീവ്രപരിചരണ"), re("ventilator|वेंटिलेटर|வென்டிலேட்டர்|వెంటిలేటర్|വെന്റിലേറ്റർ")], conditions: [{ name: "A very sick person who needs close monitoring", why: "ICUs and ventilators support failing organs" }] },
];

const URGENCY_RANK: Record<Urgency, number> = { routine: 0, urgent: 1, emergency: 2 };
export const maxUrgency = (a: Urgency, b: Urgency): Urgency => (URGENCY_RANK[a] >= URGENCY_RANK[b] ? a : b);

export function matchNeeds(text: string): NeedMatch | null {
  const t = cleanText(text ?? "");
  const services: ServiceId[] = [], conditions: Condition[] = [], labels: string[] = [];
  let urgency: Urgency = "routine";
  let confidence: "high" | "low" = "high";
  for (const r of RULES) {
    if (r.patterns.some((p) => p.test(t))) {
      for (const s of r.services) if (!services.includes(s)) services.push(s);
      conditions.push(...r.conditions);
      labels.push(r.label);
      urgency = maxUrgency(urgency, r.urgency);
      if (r.confidence === "low") confidence = "low";
    }
  }
  // a service named directly ("I need an MRI", "ICU bed", "டயாலிசிஸ் வேண்டும்") is always honoured
  for (const id of servicesNamedIn(t)) {
    if (!services.includes(id)) {
      services.push(id);
      if (SERVICE_BY_ID[id].urgentByNature) urgency = maxUrgency(urgency, "urgent");
    }
  }
  if (!services.length) return null;
  return { services: services.slice(0, 4), urgency, conditions: conditions.slice(0, 3), label: labels[0] ?? "Care you described", confidence };
}

/**
 * Candidate place phrases ("near Patna", "in Lucknow", "800001", "पटना में", "சென்னையில்"), tried in order by the
 * caller. Phrases in an Indian script must be geocoded strictly (see geocode's `strict` option).
 */
export function placeCandidates(text: string): string[] {
  const t = asciiDigits(cleanText(text ?? ""));
  const out: string[] = [];
  const pin = t.match(/\b[1-9]\d{2}\s?-?\d{3}\b/);
  if (pin) out.push(pin[0]);
  const re1 = /\b(?:near|in|at|around|from|close\s+to|nearby)\s+([A-Za-z][A-Za-z .'-]{2,40}?)(?=[,.;!?]|\s+(?:and|but|because|with|for|please|urgently|today|now)\b|$)/gi;
  for (const m of t.matchAll(re1)) out.push(m[1].trim());
  out.push(...indicPlaceCandidates(t));
  return [...new Set(out)];
}
