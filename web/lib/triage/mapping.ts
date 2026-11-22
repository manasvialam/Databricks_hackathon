import type { ServiceId, Urgency } from "../types";
import { SERVICES } from "../services";

export interface Condition { name: string; why: string }
export interface NeedMatch { services: ServiceId[]; urgency: Urgency; conditions: Condition[]; label: string; confidence: "high" | "low" }

const re = (s: string) => new RegExp(s, "iu");

interface Rule { id: string; patterns: RegExp[]; services: ServiceId[]; urgency: Urgency; conditions: Condition[]; label: string; confidence?: "high" | "low" }

// Reviewed rule table: a symptom pattern maps to the care that is usually needed, never to a diagnosis.
// Conditions are phrased as "patterns that can be seen with"; a clinician must confirm. Needs clinical review before launch.
const RULES: Rule[] = [
  { id: "kidney", label: "Kidney care", services: ["dialysis"], urgency: "urgent",
    patterns: [re("kidney\\s*(failure|problem|disease)"), re("dialysis"), re("not\\s+passing\\s+urine"), re("urine.{0,20}(very\\s+little|stopped)"), re("गुर्दे|किडनी"), re("डायलिसिस")],
    conditions: [{ name: "Kidney problems", why: "Dialysis is used when the kidneys cannot clean the blood" }] },
  { id: "heart", label: "Heart care", services: ["cath_lab", "cardiac_surgery"], urgency: "urgent", confidence: "low",
    patterns: [re("palpitation"), re("irregular\\s+heart"), re("heart\\s+(problem|disease|surgery|blockage)"), re("blocked\\s+artery"), re("angioplasty|angiography|bypass"), re("दिल\\s*की\\s*(बीमारी|धड़कन)"), re("हृदय")],
    conditions: [{ name: "A heart rhythm or blocked-artery problem", why: "These symptoms can be seen with heart conditions; tests such as angiography check this" }] },
  { id: "cancer", label: "Cancer care", services: ["oncology", "linear_accelerator"], urgency: "urgent",
    patterns: [re("cancer|tumou?r|biops|chemo"), re("lump\\s+(in|on)"), re("कैंसर|ट्यूमर|कीमो")],
    conditions: [{ name: "Something that needs specialist tests", why: "A growing lump or a known cancer needs an oncology team" }] },
  { id: "pregnancy", label: "Pregnancy care", services: ["obstetrics", "c_section"], urgency: "urgent",
    patterns: [re("pregnan"), re("antenatal"), re("due\\s+date"), re("expecting\\s+a\\s+baby"), re("delivery"), re("गर्भवती|प्रेग्नेंट|गर्भ"), re("डिलीवरी|प्रसव")],
    conditions: [{ name: "Pregnancy or childbirth care", why: "Antenatal visits, delivery and, if needed, a caesarean" }] },
  { id: "c_section", label: "Caesarean delivery", services: ["c_section", "obstetrics", "blood_bank"], urgency: "urgent",
    patterns: [re("c[- ]?section|caesarean|cesarean"), re("operation\\s+(se\\s+)?delivery"), re("सी\\s*सेक्शन")],
    conditions: [{ name: "A caesarean delivery", why: "Surgery to deliver a baby" }] },
  { id: "newborn", label: "Newborn care", services: ["nicu"], urgency: "urgent",
    patterns: [re("premature\\s+baby|preterm|low\\s+birth\\s+weight"), re("newborn.{0,30}(jaundice|yellow|small|weak)"), re("नवजात")],
    conditions: [{ name: "A newborn who needs close watching", why: "Premature or very small babies often need a newborn intensive care unit" }] },
  { id: "bone", label: "Bone and injury care", services: ["trauma_emergency", "ct_scan"], urgency: "urgent",
    patterns: [re("fractur|broken\\s+(bone|arm|leg)|broke\\s+my"), re("dislocat"), re("हड्डी\\s*(टूट|टूटी)")],
    conditions: [{ name: "A broken or dislocated bone", why: "These need an X-ray or scan and often a procedure" }] },
  { id: "burn", label: "Burn care", services: ["burn_care", "trauma_emergency"], urgency: "urgent",
    patterns: [re("\\bburn(s|ed|t)?\\b"), re("scald"), re("जल\\s*गया|जलने")],
    conditions: [{ name: "A burn", why: "Burns can need specialist dressing and fluids" }] },
  { id: "blood", label: "Blood", services: ["blood_bank"], urgency: "urgent",
    patterns: [re("need\\s+blood"), re("blood\\s+(bank|transfusion|group)"), re("खून\\s*चाहिए|ब्लड\\s*बैंक")],
    conditions: [{ name: "A need for blood", why: "Blood banks hold units for transfusion" }] },
  { id: "scan_mri", label: "MRI scan", services: ["mri"], urgency: "routine", patterns: [re("\\bmri\\b|एमआरआई")], conditions: [{ name: "A scan the doctor has asked for", why: "MRI shows soft tissue, brain and spine" }] },
  { id: "scan_ct", label: "CT scan", services: ["ct_scan"], urgency: "routine", patterns: [re("\\bct\\s*scan\\b|सीटी\\s*स्कैन")], conditions: [{ name: "A scan the doctor has asked for", why: "CT is fast and used for injuries and infections" }] },
  { id: "icu", label: "Intensive care", services: ["icu", "ventilator"], urgency: "urgent", patterns: [re("\\bicu\\b|intensive\\s+care|आईसीयू"), re("ventilator|वेंटिलेटर")], conditions: [{ name: "A very sick person who needs close monitoring", why: "ICUs and ventilators support failing organs" }] },
];

const URGENCY_RANK: Record<Urgency, number> = { routine: 0, urgent: 1, emergency: 2 };
export const maxUrgency = (a: Urgency, b: Urgency): Urgency => (URGENCY_RANK[a] >= URGENCY_RANK[b] ? a : b);

export function matchNeeds(text: string): NeedMatch | null {
  const t = (text ?? "").normalize("NFC");
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
  // a service named directly ("I need an MRI", "ICU bed") is always honoured
  const lower = t.toLowerCase();
  for (const s of SERVICES) {
    if (!services.includes(s.id) && s.keywords.some((k) => lower.includes(k.toLowerCase()))) {
      services.push(s.id);
      if (s.urgentByNature) urgency = maxUrgency(urgency, "urgent");
    }
  }
  if (!services.length) return null;
  return { services: services.slice(0, 4), urgency, conditions: conditions.slice(0, 3), label: labels[0] ?? "Care you described", confidence };
}

/** Candidate place phrases ("near Patna", "in Lucknow", "800001"), tried in order by the caller. */
export function placeCandidates(text: string): string[] {
  const out: string[] = [];
  const pin = text.match(/\b[1-9]\d{2}\s?-?\d{3}\b/);
  if (pin) out.push(pin[0]);
  const re1 = /\b(?:near|in|at|around|from|close\s+to|nearby)\s+([A-Za-z][A-Za-z .'-]{2,40}?)(?=[,.;!?]|\s+(?:and|but|because|with|for|please|urgently|today|now)\b|$)/gi;
  for (const m of text.matchAll(re1)) out.push(m[1].trim());
  const dev = text.match(/(?:के\s*पास|में)\s*([ऀ-ॿ ]{2,30})/);
  if (dev) out.push(dev[1].trim());
  return [...new Set(out)];
}
