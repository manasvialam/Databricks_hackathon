"use client";
// Browser speech only. Recognition may send audio to the browser vendor, so the UI tells people before first use.

type SR = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type SRCtor = new () => SR;

const ctor = (): SRCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const canListen = () => !!ctor();
export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

export interface Listener { stop(): void }

export function listen(lang: string, on: { interim: (t: string) => void; final: (t: string) => void; error: (code: string) => void; end: () => void }): Listener | null {
  const C = ctor();
  if (!C) return null;
  const r = new C();
  r.lang = lang; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  let finalText = "";
  r.onresult = (e) => {
    let interim = "";
    for (let i = 0; i < e.results.length; i++) {
      const alt = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += alt; else interim += alt;
    }
    on.interim((finalText + interim).trim());
  };
  r.onerror = (e) => on.error(e.error);
  r.onend = () => { if (finalText.trim()) on.final(finalText.trim()); on.end(); };
  try { r.start(); } catch { on.error("start-failed"); return null; }
  return { stop: () => { try { r.stop(); } catch { /* already stopped */ } } };
}

/** Speak sentence by sentence so a tap can cancel quickly. */
export function speak(text: string, lang: string) {
  if (!canSpeak()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const parts = text.match(/[^.!?।]+[.!?।]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  for (const p of parts) {
    const u = new SpeechSynthesisUtterance(p);
    u.lang = lang; u.rate = 0.95;
    synth.speak(u);
  }
}
export const stopSpeaking = () => { if (canSpeak()) window.speechSynthesis.cancel(); };
