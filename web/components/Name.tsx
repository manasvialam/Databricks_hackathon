"use client";
import { useTranslit } from "@/lib/client/translit";
import type { Lang } from "@/lib/i18n";

/** A hospital, place or address name: in the person's script when we have it, otherwise as written in the data (English). */
export function Name({ text, lang }: { text: string; lang: Lang }) {
  const t = useTranslit(text, lang);
  return <span lang={t ? lang : "en"}>{t ?? text}</span>;
}
