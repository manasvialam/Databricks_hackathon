"use client";
import { useEffect, useState } from "react";
import type { Lang } from "@/lib/i18n";

/**
 * Browser side of /api/transliterate: names shown on screen are batched, looked up once, and remembered in this browser, so a name is
 * only ever transliterated once. English shows until the script version arrives (and stays if there is none).
 */
const done = new Map<string, string | null>();
const waiting = new Map<string, Set<() => void>>();
let queue: { lang: Lang; text: string }[] = [];
let scheduled = false;
const KEY = (lang: Lang) => `tl1:${lang}`;
const loaded = new Set<Lang>();

function restore(lang: Lang) {
  if (loaded.has(lang) || typeof localStorage === "undefined") return;
  loaded.add(lang);
  try { for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(KEY(lang)) ?? "{}") as Record<string, string>)) done.set(`${lang}|${k}`, v); } catch { /* storage unavailable */ }
}
function persist(lang: Lang) {
  try {
    const mine = [...done.entries()].filter(([k, v]) => k.startsWith(`${lang}|`) && v).slice(-900);
    localStorage.setItem(KEY(lang), JSON.stringify(Object.fromEntries(mine.map(([k, v]) => [k.slice(lang.length + 1), v]))));
  } catch { /* storage full or unavailable */ }
}

async function flush() {
  scheduled = false;
  const batch = queue; queue = [];
  const byLang = new Map<Lang, string[]>();
  for (const q of batch) byLang.set(q.lang, [...new Set([...(byLang.get(q.lang) ?? []), q.text])]);
  for (const [lang, all] of byLang) {
    // small batches sent at the same time: the first names on screen (the chosen hospital) arrive after one short call
    const chunks: string[][] = [];
    for (let i = 0; i < all.length; i += 6) chunks.push(all.slice(i, i + 6));
    await Promise.all(chunks.map(async (names) => {
      let res: (string | null)[] = names.map(() => null);
      let ok = false;
      try {
        const r = await fetch("/api/transliterate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang, names }) });
        if (r.ok) { res = ((await r.json()) as { names: (string | null)[] }).names; ok = true; }
      } catch { /* offline: keep English */ }
      names.forEach((text, k) => {
        const key = `${lang}|${text}`;
        if (ok) done.set(key, res[k] ?? null);          // a failed request is retried next time the name is shown
        waiting.get(key)?.forEach((cb) => cb()); waiting.delete(key);
      });
    }));
    persist(lang);
  }
}

/** `text` written in `lang`'s script, or null while loading, when unavailable, or for English. */
export function useTranslit(text: string | null | undefined, lang: Lang): string | null {
  const key = text && lang !== "en" ? `${lang}|${text}` : null;
  const [, tick] = useState(0);
  if (key) restore(lang);
  useEffect(() => {
    if (!key || !text) return;
    restore(lang);
    if (done.has(key)) return;
    const cb = () => tick((n) => n + 1);
    (waiting.get(key) ?? waiting.set(key, new Set()).get(key)!).add(cb);
    if (!queue.some((q) => q.lang === lang && q.text === text)) queue.push({ lang, text });
    if (!scheduled) { scheduled = true; setTimeout(flush, 120); }
    return () => { waiting.get(key)?.delete(cb); };
  }, [key, text, lang]);
  return key ? done.get(key) ?? null : null;
}
