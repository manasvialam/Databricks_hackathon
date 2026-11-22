"use client";
import { useEffect, useState } from "react";
import type { Lang } from "@/lib/i18n";

/** Browser side of /api/translate: batches strings requested in the same tick, caches per page, never throws. */
const done = new Map<string, string | null>();
const waiting = new Map<string, Set<() => void>>();
let queue: { lang: Lang; text: string }[] = [];
let scheduled = false;

async function flush() {
  scheduled = false;
  const batch = queue; queue = [];
  const byLang = new Map<Lang, string[]>();
  for (const q of batch) byLang.set(q.lang, [...(byLang.get(q.lang) ?? []), q.text]);
  for (const [lang, all] of byLang) {
    for (let i = 0; i < all.length; i += 8) {
      const texts = all.slice(i, i + 8);
      let res: (string | null)[] = texts.map(() => null);
      try {
        const r = await fetch("/api/translate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang, texts }) });
        if (r.ok) res = ((await r.json()) as { texts: (string | null)[] }).texts;
      } catch { /* offline: keep English */ }
      texts.forEach((text, k) => {
        const key = `${lang}|${text}`;
        done.set(key, res[k] ?? null);
        waiting.get(key)?.forEach((cb) => cb()); waiting.delete(key);
      });
    }
  }
}

/** The translation of `text` into `lang`, or null while loading, when unavailable, or when `text` is null. */
export function useMachineTranslation(text: string | null, lang: Lang): string | null {
  const key = text && lang !== "en" ? `${lang}|${text}` : null;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!key || !text) return;
    if (done.has(key)) return;
    const cb = () => tick((n) => n + 1);
    (waiting.get(key) ?? waiting.set(key, new Set()).get(key)!).add(cb);
    if (!queue.some((q) => q.lang === lang && q.text === text)) queue.push({ lang, text });
    if (!scheduled) { scheduled = true; queueMicrotask(flush); }
    return () => { waiting.get(key)?.delete(cb); };
  }, [key, text, lang]);
  return key ? done.get(key) ?? null : null;
}
