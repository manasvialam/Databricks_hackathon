/**
 * Interface language. One file per language (en.ts is the source) so a native speaker can review a single file.
 *
 * DRAFT: every non-English string needs review by a native speaker, and anything touching emergencies by a clinician.
 * t() falls back to English per key, and missingKeys(lang) lists what a language still lacks.
 *
 * The server never sends finished sentences for the interface: it sends a Msg (a key plus values, with the English
 * text alongside for API users and logs), and the browser renders it in the person's language with say().
 */
import type { Contribution, ServiceId } from "../types";
import { SERVICE_BY_ID } from "../services";
import { en, type Messages } from "./en";
import { hi } from "./hi";
import { ta } from "./ta";
import { te } from "./te";
import { ml } from "./ml";

export type Lang = "en" | "hi" | "ta" | "te" | "ml";
export const LANGS: { id: Lang; label: string; native: string; speech: string }[] = [
  { id: "en", label: "English", native: "English", speech: "en-IN" },
  { id: "hi", label: "Hindi", native: "हिन्दी", speech: "hi-IN" },
  { id: "ta", label: "Tamil", native: "தமிழ்", speech: "ta-IN" },
  { id: "te", label: "Telugu", native: "తెలుగు", speech: "te-IN" },
  { id: "ml", label: "Malayalam", native: "മലയാളം", speech: "ml-IN" },
];
export const isLang = (x: unknown): x is Lang => typeof x === "string" && LANGS.some((l) => l.id === x);

export type MsgKey = keyof Messages;
export type Vars = Record<string, string | number>;

export interface ServiceText { label: string; plain: string }
/** Emergency card text for one red-flag category (lib/triage/redflags.ts). */
export interface EmergencyText { label: string; now: string; wait?: string }
export interface Pack {
  ui: Partial<Messages>;
  services: Partial<Record<ServiceId, ServiceText>>;
  emergency: Partial<Record<string, EmergencyText>>;
}

const PACKS: Record<Exclude<Lang, "en">, Pack> = { hi, ta, te, ml };
const pack = (lang: Lang): Pack | null => (lang === "en" ? null : PACKS[lang]);

export function t(lang: Lang, key: MsgKey, vars?: Vars): string {
  let s = (pack(lang)?.ui[key] ?? en[key]) as string;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Keys that fall back to English in a language, so reviewers can see exactly what is missing. */
export function missingKeys(lang: Lang): MsgKey[] {
  const p = pack(lang);
  return p ? (Object.keys(en) as MsgKey[]).filter((k) => !(k in p.ui)) : [];
}
export const hasKey = (lang: Lang, key: MsgKey) => lang === "en" || key in (pack(lang)?.ui ?? {});
export const speechLang = (l: Lang) => LANGS.find((x) => x.id === l)!.speech;

// ---------- services, emergency text, labels ------------------------------------------------------------------------
export const svcLabel = (id: string, lang: Lang): string =>
  pack(lang)?.services[id as ServiceId]?.label ?? SERVICE_BY_ID[id]?.en ?? id;
export const svcPlain = (id: string, lang: Lang): string =>
  pack(lang)?.services[id as ServiceId]?.plain ?? SERVICE_BY_ID[id]?.plain ?? "";

/** Translated emergency text for a red-flag category, or null when only the English in redflags.ts exists. */
export const emergencyText = (id: string, lang: Lang): EmergencyText | null => pack(lang)?.emergency[id] ?? null;

const LEVEL_KEY: Record<string, MsgKey> = {
  Strong: "lvlStrong", Moderate: "lvlModerate", Inferred: "lvlInferred", Weak: "lvlWeak", Contradicted: "lvlContradicted", "No evidence found": "lvlNone",
};
const FIELD_KEY: Record<string, MsgKey> = {
  specialties: "fieldSpecialties", capability: "fieldCapability", procedure: "fieldProcedure", equipment: "fieldEquipment", description: "fieldDescription",
};
const TYPE_KEY: Record<string, MsgKey> = {
  hospital: "typeHospital", clinic: "typeClinic", dentist: "typeDentist", doctor: "typeDoctor", pharmacy: "typePharmacy", nursing_home: "typeNursingHome",
};
const label = (table: Record<string, MsgKey>) => (value: string, lang: Lang) => (table[value] ? t(lang, table[value]) : value);
export const levelLabel = label(LEVEL_KEY);
export const fieldLabel = label(FIELD_KEY);
export const typeLabel = label(TYPE_KEY);

// ---------- messages from the server --------------------------------------------------------------------------------
export interface Msg { k: MsgKey; v?: Vars; text: string }
export const msg = (k: MsgKey, v?: Vars): Msg => (v ? { k, v, text: t("en", k, v) } : { k, text: t("en", k) });
/** A sentence taken from the data, which only exists in English. Other languages show the generic sentence for `k`. */
export const dataMsg = (k: MsgKey, text: string): Msg => ({ k, text });
/** A server message in the person's language. English keeps the original text (which may be more specific). */
export const say = (m: Msg, lang: Lang): string => (lang === "en" ? m.text : t(lang, m.k, m.v));

/** "90 out of 100. Based on: address matches its PIN code, phone number on file, own website (x.org)": parts are message keys so each can be translated. */
export function trustDetail(dv: Vars, lang: Lang): string {
  const parts = String(dv.parts ?? "").split(",").filter(Boolean).map((k) => t(lang, k as MsgKey, { site: String(dv.site ?? "") }));
  return parts.length ? t(lang, "whyTrustDetail", { n: dv.n ?? "", list: parts.join(", ") }) : t(lang, "whyTrustNoParts", { n: dv.n ?? "" });
}

/** One line of "How we decided" in the person's language. A detail that only exists in English is dropped. */
export function termText(c: Contribution, lang: Lang): { label: string; detail: string | null } {
  if (lang === "en" || !c.k) return { label: c.label, detail: c.detail ?? null };
  let detail: string | null = null;
  if (c.dk === "whyFieldsDetail" && c.dv) {
    const list = String(c.dv.list ?? "").split(", ").filter(Boolean).map((f) => fieldLabel(f, lang)).join(", ");
    detail = t(lang, "whyFieldsDetail", { ...c.dv, list });
  } else if (c.dk === "whyTrustDetail" && c.dv) detail = trustDetail(c.dv, lang);
  else if (c.dk) detail = t(lang, c.dk, c.dv);
  const v = c.v && c.v.svc ? { ...c.v, svc: svcLabel(String(c.v.svc), lang) } : c.v;
  return { label: t(lang, c.k, v), detail };
}
