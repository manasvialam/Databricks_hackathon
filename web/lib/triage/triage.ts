import type { ServiceId, Urgency } from "../types";
import { isServiceId } from "../services";
import { checkRedFlags, type RedFlagResult } from "./redflags";
import { matchNeeds, maxUrgency, placeCandidates, type Condition } from "./mapping";
import type { Lang } from "../i18n";

export interface LlmExtraction {
  symptoms: string[];
  urgency: Urgency;
  services: string[];
  possibleConditions: Condition[];
  followUps: string[];
  location?: string | null;
  summary?: string;
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
  return { symptoms: arr(o.symptoms).slice(0, 8), urgency: urg, services: arr(o.services).filter(isServiceId), possibleConditions: conds, followUps: arr(o.followUps).slice(0, 2), location: typeof o.location === "string" ? o.location.slice(0, 80) : null, summary: typeof o.summary === "string" ? o.summary.slice(0, 300) : undefined };
}

export async function triage(text: string, opts: { history?: string[]; llm?: LlmExtractor | null; lang?: Lang } = {}): Promise<TriageResult> {
  const history = opts.history ?? [];
  // 1. the gate sees the new message and the recent conversation: a red flag mentioned earlier still counts
  let emergency = checkRedFlags([...history.slice(-4), text].join(" . "));
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
  rules?.services.forEach(push);
  llm?.services.forEach((s) => isServiceId(s) && push(s));

  const conditions = llm?.possibleConditions.length ? llm.possibleConditions : rules?.conditions ?? [];
  const followUps = (llm?.followUps ?? []).slice(0, 2);
  const places = placeCandidates(text);
  if (llm?.location) places.unshift(llm.location);

  return {
    emergency, urgency, services: services.slice(0, 4), conditions, followUps,
    placeCandidates: [...new Set(places)], understood: services.length > 0, lowConfidence: !!rules && rules.confidence === "low" && !llm,
    source: llm ? "llm+rules" : "rules",
    note: llm ? null : "Understood with built-in rules; the language model was not used for this message.",
  };
}
