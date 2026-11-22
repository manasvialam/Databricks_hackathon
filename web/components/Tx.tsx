"use client";
import { hasKey, say, type Lang, type Msg } from "@/lib/i18n";
import { useMachineTranslation } from "@/lib/client/mt";

/** A server message in the person's language: the reviewed translation when one exists, otherwise a model translation of the English. */
export function Tx({ m, lang }: { m: Msg; lang: Lang }) {
  const missing = lang !== "en" && !hasKey(lang, m.k);
  const mt = useMachineTranslation(missing ? m.text : null, lang);
  return <>{mt ?? say(m, lang)}</>;
}

/** Free English text from the data or the model (no message key), translated the same way. */
export function TxText({ text, lang }: { text: string; lang: Lang }) {
  const mt = useMachineTranslation(lang !== "en" ? text : null, lang);
  return <>{mt ?? text}</>;
}
