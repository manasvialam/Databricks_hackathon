// Choosing the most natural installed voice. Browsers list every voice the device has, from old robotic ones to neural ones;
// without a choice the first match wins, which is often the oldest. Names are the only signal the API gives, so rank by them.

export interface VoiceInfo { name: string; lang: string; localService: boolean; voiceURI?: string }

export const tag = (s: string) => s.toLowerCase().replace("_", "-");   // older Android reports "ta_IN"

/** Higher is more natural. */
export function voiceScore(v: VoiceInfo, want: string): number {
  const n = v.name.toLowerCase();
  let s = 0;
  if (tag(v.lang) === tag(want)) s += 20;                                   // exact region ("ta-IN") over the same language
  if (/natural|neural/.test(n)) s += 100;                                   // Edge "Microsoft Pallavi Online (Natural)", Azure neural voices
  if (/premium|enhanced|siri|studio|wavenet|journey|chirp/.test(n)) s += 60; // iOS premium, Google Cloud voice families
  if (/online/.test(n)) s += 40;
  if (/^google/.test(n)) s += 45;                                           // Chrome's network voices ("Google हिन्दी")
  if (!v.localService) s += 15;                                             // streamed voices are neural almost everywhere
  if (/compact|espeak|festival|flite/.test(n)) s -= 60;
  if (/desktop/.test(n)) s -= 30;                                           // legacy Windows voices ("Microsoft Hemant - Hindi (India)" and "... Desktop")
  if (/^microsoft [a-z]+ - /.test(n)) s -= 20;
  return s;
}

/** Voices for a language, most natural first. */
export function rankVoices<T extends VoiceInfo>(all: T[], lang: string): T[] {
  const want = tag(lang), base = want.split("-")[0];
  return all.filter((v) => tag(v.lang).split("-")[0] === base).sort((a, b) => voiceScore(b, want) - voiceScore(a, want) || a.name.localeCompare(b.name));
}

/** Natural enough that nobody would call it a robot (a neural, online or premium voice). */
export const isNatural = (v: VoiceInfo) => /natural|neural|premium|enhanced|siri|studio|wavenet|journey|chirp|^google|online/i.test(v.name) || !v.localService;
