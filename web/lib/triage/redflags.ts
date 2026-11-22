/**
 * Deterministic emergency gate. No LLM is involved: it runs before and after any model call, it can only
 * escalate, and a false alarm is acceptable where a missed emergency is not. The wording of the "while you wait"
 * lines is deliberately minimal and must be reviewed by a clinician before launch.
 */
import type { ServiceId } from "../types";
import { INDIC_PATTERNS, cleanText } from "./redflags.indic";

export interface RedFlagCategory {
  id: string;
  label: string;
  patterns: RegExp[];
  services: ServiceId[];       // what to look for nearby, most important first
  now: string;                 // what to do right now
  whileWaiting?: string;       // one widely accepted first-aid line
  helpline?: { name: string; number: string };
}

// Devanagari and Roman-script Hindi are matched without \b (word boundaries do not work for Devanagari).
// ['’] accepts both the straight and the curly apostrophe that phone keyboards produce.
const re = (s: string) => new RegExp(s, "iu");

export const RED_FLAGS: RedFlagCategory[] = [
  { id: "cardiac", label: "Possible heart emergency", services: ["cath_lab", "icu", "trauma_emergency"],
    patterns: [re("chest\\s*(pain|pressure|tight|heav)"), re("pain.{0,15}chest"), re("heart\\s*attack"), re("seene?.{0,15}(dard|bhaari|jakdan)"), re("chhati.{0,15}dard"), re("सीने.{0,20}(दर्द|जकड़न|भारीपन)"), re("दिल\\s*का\\s*दौरा"), re("हार्ट\\s*अटैक")],
    now: "Call 108 or 112 now. Do not drive yourself.", whileWaiting: "Sit or lie down and stay as calm and still as you can." },
  { id: "breathing", label: "Trouble breathing", services: ["icu", "ventilator", "trauma_emergency"],
    patterns: [re("(can['’]?t|cannot|can not|unable to|not able to)\\s+(breathe|breath)"), re("(difficulty|trouble|hard)\\s+(in\\s+)?breath"), re("short(ness)?\\s+of\\s+breath"), re("breathless"), re("gasping"), re("saans?.{0,15}(nahi|nahin|nhi|lene|phool|ruk)"), re("सांस.{0,15}(नहीं|तकलीफ|दिक्कत|फूल)"), re("साँस.{0,15}(नहीं|तकलीफ|दिक्कत|फूल)"), re("दम\\s*घुट")],
    now: "Call 108 or 112 now.", whileWaiting: "Sit upright if you can, and loosen tight clothing." },
  { id: "stroke", label: "Possible stroke", services: ["ct_scan", "icu", "trauma_emergency"],
    patterns: [re("stroke"), re("face\\s*(is\\s*)?droop"), re("facial\\s*droop"), re("slurred\\s*speech"), re("(can['’]?t|cannot)\\s+speak"), re("sudden(ly)?\\s+(weak|numb)"), re("one\\s*side.{0,20}(weak|numb|paraly)"), re("paralys"), re("लकवा"), re("मुंह\\s*टेढ़ा"), re("बोलने.{0,10}(दिक्कत|परेशानी)")],
    now: "Call 108 or 112 now. Every minute counts with a stroke.", whileWaiting: "Note the time the symptoms started and tell the ambulance crew." },
  { id: "seizure", label: "Seizure or fits", services: ["icu", "trauma_emergency", "ct_scan"],
    patterns: [re("seizure"), re("convuls"), re("\\bfits?\\b"), re("epilep"), re("मिर्गी"), re("दौरे?\\s*(पड़|आ)"), re("jhatke")],
    now: "Call 108 or 112 now.", whileWaiting: "Move hard objects away, turn the person on their side, and put nothing in their mouth." },
  { id: "bleeding", label: "Heavy bleeding", services: ["trauma_emergency", "blood_bank", "icu"],
    patterns: [re("heavy\\s+bleed"), re("bleed\\w*\\s+(a\\s+lot|badly|heavily)"), re("bleed\\w*.{0,25}(won['’]?t|will\\s+not|doesn['’]?t|does\\s+not|not)\\s+(stop|stopping)"), re("too\\s+much\\s+blood"), re("vomit(ing)?\\s+blood"), re("cough(ing)?\\s+(up\\s+)?blood"), re("blood\\s+in\\s+(vomit|stool)"), re("bahut\\s+khoon"), re("khoon\\s+(beh|ruk)"), re("खून\\s*(बह|नहीं\\s*रुक)"), re("खून\\s*की\\s*उल्टी")],
    now: "Call 108 or 112 now.", whileWaiting: "Press firmly on the wound with a clean cloth and keep pressing." },
  { id: "pregnancy", label: "Pregnancy emergency", services: ["obstetrics", "c_section", "nicu", "blood_bank"],
    patterns: [re("pregnan\\w*.{0,40}(bleed|fit|seiz|severe\\s+pain|headache|not\\s+moving|swelling)"), re("(bleed|fit|seiz).{0,40}pregnan"), re("labou?r\\s+pain"), re("water\\s+broke"), re("waters?\\s+(have\\s+)?broke"), re("contractions"), re("baby\\s+(is\\s+)?not\\s+moving"), re("गर्भवती.{0,40}(खून|दर्द|दौरे|झटके)"), re("प्रसव\\s*(पीड़ा|दर्द)"), re("पानी\\s*(की\\s*थैली\\s*)?फट"), re("delivery\\s*(pain|dard)")],
    now: "Call 108 or 112 now, and tell them she is pregnant.", whileWaiting: "Lie her on her left side and do not let her walk or push." },
  { id: "unconscious", label: "Unconscious or not responding", services: ["icu", "trauma_emergency", "ventilator"],
    patterns: [re("unconscious"), re("not\\s+responding"), re("unresponsive"), re("collaps"), re("passed\\s+out"), re("fainted"), re("बेहोश"), re("होश\\s*नहीं"), re("behosh")],
    now: "Call 108 or 112 now.", whileWaiting: "Check they are breathing. If not, tell the call-taker; they will guide you." },
  { id: "poisoning", label: "Poisoning or overdose", services: ["icu", "trauma_emergency"],
    patterns: [re("poison"), re("overdose"), re("swallowed\\s+(acid|pesticide|phenyl|kerosene|tablets|pills|bleach)"), re("(drank|consumed|ate|took)\\s+(pesticide|rat\\s+poison|insecticide|phenyl)"), re("ज़हर|जहर"), re("कीटनाशक"), re("zeher")],
    now: "Call 108 or 112 now. Take the container or tablets with you.", whileWaiting: "Do not make them vomit unless a doctor tells you to." },
  { id: "snakebite", label: "Snake bite", services: ["icu", "trauma_emergency"],
    patterns: [re("snake\\s*bite"), re("bitten\\s+by\\s+(a\\s+)?snake"), re("सांप\\s*(ने\\s*)?(काट|काटा)"), re("साँप\\s*(ने\\s*)?(काट|काटा)"), re("saanp\\s*(ne\\s*)?kat")],
    now: "Call 108 or 112 now and go to a hospital that gives anti-venom.", whileWaiting: "Keep the person still and calm. Do not cut, suck or tie the bite." },
  { id: "infant", label: "Sick newborn or infant", services: ["nicu", "icu", "trauma_emergency"],
    patterns: [re("(newborn|new\\s*born|infant|\\d+[- ]?(day|week)s?[- ]?old).{0,50}(fever|not\\s+feeding|not\\s+breathing|yellow|blue|limp|fit|seiz)"), re("(fever|not\\s+feeding|blue|yellow).{0,40}(newborn|new\\s*born|infant)"), re("नवजात.{0,40}(बुखार|साँस|सांस|पीला|नीला|दूध\\s*नहीं)")],
    now: "Take the baby to a hospital with a newborn unit now, or call 108 or 112.", whileWaiting: "Keep the baby warm and, if the mother can, keep feeding." },
  { id: "burn", label: "Serious burn", services: ["burn_care", "trauma_emergency", "icu"],
    patterns: [re("(severe|bad|serious|large|major|deep)\\s+burn"), re("burn(t|ed)?\\s+(on\\s+)?(face|chest|whole|large|badly)"), re("caught\\s+fire"), re("बुरी\\s*तरह\\s*जल"), re("आग\\s*में\\s*जल")],
    now: "Call 108 or 112 now.", whileWaiting: "Cool the burn with clean running water for 20 minutes. Do not put ointment, toothpaste or oil on it." },
  { id: "injury", label: "Serious injury or accident", services: ["trauma_emergency", "ct_scan", "blood_bank", "icu"],
    patterns: [re("accident"), re("hit\\s+by\\s+(a\\s+)?(car|truck|bus|bike|vehicle|train)"), re("fell\\s+from"), re("fall\\s+from\\s+(a\\s+)?(height|roof|tree|building)"), re("head\\s+injur"), re("stabbed"), re("gun\\s*shot"), re("deep\\s+(cut|wound)"), re("crush"), re("दुर्घटना|एक्सीडेंट|हादसा"), re("सिर\\s*में\\s*चोट")],
    now: "Call 108 or 112 now.", whileWaiting: "Do not move the person unless they are in danger. Press on any bleeding." },
  { id: "allergy", label: "Severe allergic reaction", services: ["icu", "trauma_emergency"],
    patterns: [re("anaphyla"), re("(throat|tongue|face|lips)\\s+(is\\s+)?(swell|closing|swollen)"), re("swelling\\s+of\\s+(the\\s+)?(throat|tongue|face)")],
    now: "Call 108 or 112 now.", whileWaiting: "Stay upright or lie with legs raised if faint, and use an adrenaline pen if one has been prescribed." },
  { id: "self_harm", label: "Thoughts of harming yourself", services: ["trauma_emergency", "icu"],
    patterns: [re("suicid"), re("kill\\s+myself"), re("want\\s+to\\s+die"), re("end\\s+my\\s+life"), re("self[- ]?harm"), re("आत्महत्या"), re("मरना\\s*चाह"), re("जान\\s*दे")],
    now: "You are not alone. If you might act on this, call 112 now or go to the nearest emergency room, and please stay with someone you trust.",
    helpline: { name: "Tele-MANAS (free, 24 hours)", number: "14416" } },
  { id: "meningitis", label: "Fever with confusion or stiff neck", services: ["icu", "ct_scan", "trauma_emergency"],
    patterns: [re("fever.{0,40}(stiff\\s+neck|confus|drowsy|rash\\s+that)"), re("(stiff\\s+neck|confus).{0,40}fever")],
    now: "Go to an emergency room now or call 108 or 112." },
];

// Tamil, Telugu and Malayalam phrases (draft, pending native-speaker and clinician review)
for (const c of RED_FLAGS) for (const p of INDIC_PATTERNS[c.id] ?? []) c.patterns.push(re(p));

export interface RedFlagResult {
  emergency: true;
  categories: { id: string; label: string; now: string; whileWaiting?: string; helpline?: { name: string; number: string }; matched: string }[];
  services: ServiceId[];
  numbers: { name: string; number: string }[];
}

const NUMBERS = [{ name: "Emergency (all services)", number: "112" }, { name: "Ambulance", number: "108" }];

export function checkRedFlags(text: string): RedFlagResult | null {
  const t = cleanText(text ?? "");
  const hits: RedFlagResult["categories"] = [];
  for (const cat of RED_FLAGS) {
    for (const p of cat.patterns) {
      const m = t.match(p);
      if (m) { hits.push({ id: cat.id, label: cat.label, now: cat.now, whileWaiting: cat.whileWaiting, helpline: cat.helpline, matched: m[0] }); break; }
    }
  }
  if (!hits.length) return null;
  const services: ServiceId[] = [];
  for (const h of hits) for (const s of RED_FLAGS.find((c) => c.id === h.id)!.services) if (!services.includes(s)) services.push(s);
  const numbers = [...NUMBERS];
  for (const h of hits) if (h.helpline) numbers.push(h.helpline);
  return { emergency: true, categories: hits, services, numbers };
}
