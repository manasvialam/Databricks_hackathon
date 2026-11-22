import type { ServiceId, Urgency } from "../types";
import { isServiceId } from "../services";
import { ASSISTANT_PREFIX } from "./history";
import { checkRedFlags, type RedFlagResult } from "./redflags";
import { matchNeeds, maxUrgency, placeCandidates, type Condition } from "./mapping";
import type { Lang } from "../i18n";
import { isSpecialtyId, matchSpecialties } from "../specialty";
import { asksForPlaceOfCare, isSmallTalk } from "./smalltalk";

export interface LlmExtraction {
  symptoms: string[];
  urgency: Urgency;
  services: string[];
  possibleConditions: Condition[];
  followUps: string[];
  location?: string | null;
  summary?: string;
  specialties?: string[];           // specialty category ids the need points to (lib/specialty.ts)
  careRequest?: boolean;            // false for a greeting, thanks or unrelated chat: the person has not asked for care
}
/** `lang` is the interface language: follow-up questions and the summary should come back in it. */
export type LlmExtractor = (text: string, history: string[], lang?: Lang) => Promise<LlmExtraction | null>;

export interface TriageResult {
  emergency: RedFlagResult | null;
  urgency: Urgency;
  services: ServiceId[];            // primary first
  conditions: Condition[];          // "patterns that can be seen with"; a clinician must confirm
  followUps: string[];              // at most 2
  placeCandidates: string[];
  understood: boolean;              // false when no service could be identified
  lowConfidence: boolean;
  specialties: string[];            // specialty categories the need points to, best first (model first, keyword match as fallback)
  chat: boolean;                    // small talk: no symptom and no request for care, so no hospitals should be shown
  need: string | null;              // the model's plain-English restatement of the need, used to judge hospital fit
  source: "rules" | "llm+rules";
  note: string | null;
}

/** Validate a model's JSON against the schema; anything unexpected is dropped, never trusted. */
export function validateExtraction(x: unknown): LlmExtraction | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const urg = o.urgency === "emergency" || o.urgency === "urgent" || o.urgency === "routine" ? o.urgency : null;
  if (!urg) return null;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((s) => typeof s === "string").map((s) => String(s).slice(0, 200)) : []);
  const conds = Array.isArray(o.possibleConditions)
    ? o.possibleConditions.filter((c): c is Record<string, string> => !!c && typeof (c as Record<string, unknown>).name === "string").slice(0, 3).map((c) => ({ name: String(c.name).slice(0, 80), why: String(c.why ?? "").slice(0, 200) }))
    : [];
  return { symptoms: arr(o.symptoms).slice(0, 8), urgency: urg, services: arr(o.services).filter(isServiceId), possibleConditions: conds, followUps: arr(o.followUps).slice(0, 2), location: typeof o.location === "string" ? o.location.slice(0, 80) : null, summary: typeof o.summary === "string" ? o.summary.slice(0, 300) : undefined, specialties: arr(o.specialties).filter(isSpecialtyId).slice(0, 3), careRequest: o.careRequest === false ? false : true };
}

export { ASSISTANT_PREFIX };

export async function triage(text: string, opts: { history?: string[]; llm?: LlmExtractor | null; lang?: Lang } = {}): Promise<TriageResult> {
  const history = opts.history ?? [];
  // 1. the gate sees the new message and what the person said earlier (never the app's own questions, which may contain warning words): a red flag mentioned earlier still counts
  const said = history.filter((h) => !h.startsWith(ASSISTANT_PREFIX));
  let emergency = checkRedFlags([...said.slice(-4), text].join(" . "));
  if (!emergency && isSmallTalk(text)) {
    return { emergency: null, urgency: "routine", services: [], conditions: [], followUps: [], placeCandidates: [], understood: false, lowConfidence: false, specialties: [], chat: true, need: null, source: "rules", note: null };
  }
  const rules = matchNeeds(text);
  let llm: LlmExtraction | null = null;
  if (opts.llm && !emergency) {
    try { llm = validateExtraction(await opts.llm(text, history, opts.lang ?? "en")); } catch { llm = null; }
  }
  // 2. the gate runs again on whatever the model produced; the model can only escalate
  if (llm && !emergency) emergency = checkRedFlags([llm.summary ?? "", ...llm.symptoms].join(" . "));

  let urgency: Urgency = rules?.urgency ?? "routine";
  if (llm) urgency = maxUrgency(urgency, llm.urgency);
  if (emergency) urgency = "emergency";

  const services: ServiceId[] = [];
  const push = (s: ServiceId) => { if (!services.includes(s)) services.push(s); };
  if (emergency) emergency.services.forEach(push);
  // when the model answered, its reading of the message decides the care needed; keyword rules are only the fallback.
  // (The emergency gate above is independent of both and can only escalate.)
  if (llm) llm.services.forEach((s) => isServiceId(s) && push(s)); else rules?.services.forEach(push);

  const conditions = llm?.possibleConditions.length ? llm.possibleConditions : rules?.conditions ?? [];
  const followUps = (llm?.followUps ?? []).slice(0, 2);
  const places = placeCandidates(text);
  if (llm?.location) places.unshift(llm.location);

  const chat = !emergency && !!llm && llm.careRequest === false && services.length === 0 && !asksForPlaceOfCare(text);   // asking for a hospital or clinic is always a request for care
  return {
    emergency, urgency, services: services.slice(0, 4), conditions, followUps, chat,
    placeCandidates: [...new Set(places)], understood: services.length > 0, lowConfidence: !!rules && rules.confidence === "low" && !llm,
    specialties: [...new Set([...(llm?.specialties ?? []), ...matchSpecialties(text)])].slice(0, 3),
    need: llm?.summary ?? null,
    source: llm ? "llm+rules" : "rules",
    note: llm ? null : "Understood with built-in rules; the language model was not used for this message.",
  };
}
