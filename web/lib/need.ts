/** The problem as a short phrase that reads after "a doctor about": no "I'm having" up front, no closing full stop, at most 60 characters. */
export function cleanNeed(need: string | null | undefined): string | null {
  const c = (need ?? "").trim().replace(/^(?:i(?:'m|\s+am)?\s+)?(?:having|facing|suffering\s+from|getting|feeling|have|feel)\s+/i, "").replace(/[\s.!?]+$/, "");
  return c ? lcFirst(c.length > 60 ? c.slice(0, 57) + "…" : c) : null;
}
/** "Pregnancy and childbirth care" reads wrongly capitalised inside "I need ..."; keep acronyms (ICU, NICU) as they are. */
export const lcFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
/** True when the text is Latin script, so staff reading English can read it. */
export const isLatin = (s: string) => !/[^\u0000-ɏ -⁯]/.test(s);
