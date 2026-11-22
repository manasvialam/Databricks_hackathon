"use client";
import { isNatural, rankVoices, tag } from "./voices";
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

/**
 * Listen once in `lang` (a BCP-47 tag such as "ta-IN"). Error codes are the browser's own: "not-allowed",
 * "service-not-allowed", "language-not-supported", "no-speech", "network", "audio-capture", plus "start-failed".
 */
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

// ---------- reading aloud -------------------------------------------------------------------------------------------
// Voices load asynchronously in Chrome (the list is empty until "voiceschanged"), so keep the latest list.
let voices: SpeechSynthesisVoice[] = [];
const loadVoices = () => { if (canSpeak()) voices = window.speechSynthesis.getVoices(); };
if (canSpeak()) { loadVoices(); window.speechSynthesis.addEventListener?.("voiceschanged", loadVoices); }

/** True once the browser has listed its voices (Chrome lists them late, so an empty list means unknown, not none). */
export const voicesReady = () => voices.length > 0;

const pickKey = (lang: string) => `voice:${tag(lang).split("-")[0]}`;
const getPick = (lang: string) => { try { return localStorage.getItem(pickKey(lang)); } catch { return null; } };

/** Installed voices for a language, most natural first. */
export function voiceChoices(lang: string): SpeechSynthesisVoice[] {
  if (!canSpeak()) return [];
  if (!voices.length) loadVoices();
  return rankVoices(voices, lang);
}

/** The chosen voice for a language (the person's own pick if it is still installed), otherwise the most natural one. */
export function voiceFor(lang: string): SpeechSynthesisVoice | null {
  const list = voiceChoices(lang);
  const pick = getPick(lang);
  return (pick && list.find((v) => v.voiceURI === pick || v.name === pick)) || list[0] || null;
}

/** Remember a voice for a language; null goes back to automatic. */
export function chooseVoice(lang: string, v: SpeechSynthesisVoice | null) {
  try { if (v) localStorage.setItem(pickKey(lang), v.voiceURI || v.name); else localStorage.removeItem(pickKey(lang)); } catch { /* storage unavailable */ }
}
export const chosenVoice = (lang: string) => { const p = getPick(lang); return p ? voiceChoices(lang).find((v) => v.voiceURI === p || v.name === p) ?? null : null; };

/** Neural voices are smoother at their own speed; old voices sound less choppy a little slower. */
export const speechRate = (v: SpeechSynthesisVoice | null) => (v && isNatural(v) ? 1 : 0.92);

/**
 * Speak sentence by sentence so a tap can cancel quickly. Returns false, and says nothing, when the device lists its
 * voices and none speaks this language: an English voice reading Tamil script is silent or gibberish.
 */
export function speak(text: string, lang: string): boolean {
  if (!canSpeak()) return false;
  const voice = voiceFor(lang);
  if (!voice && voices.length) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const parts = text.match(/[^.!?।]+[.!?।]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  for (const p of parts) {
    const u = new SpeechSynthesisUtterance(p);
    u.lang = lang; u.rate = speechRate(voice);
    if (voice) u.voice = voice;
    synth.speak(u);
  }
  return true;
}
export const stopSpeaking = () => { if (canSpeak()) window.speechSynthesis.cancel(); };
