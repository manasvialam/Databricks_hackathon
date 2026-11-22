"use client";
import { useEffect, useRef } from "react";
import { Mic } from "lucide-react";
import { useMicLevel } from "@/lib/client/audio-level";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";
const BARS = 5;

/**
 * Drives the bars and the halo while the voice is active. Listening follows the microphone's loudness; speaking pulses on every spoken
 * word (the browser's word-boundary events) with a soft wave in between, because speech synthesis exposes no audio to measure.
 * It writes straight to the DOM from one animation frame loop, so it never re-renders the page.
 */
export function useVoiceMotion(state: VoiceState, root: React.RefObject<HTMLElement | null>) {
  const mic = useMicLevel(state === "listening");
  useEffect(() => {
    const el = root.current;
    if (!el || (state !== "listening" && state !== "speaking")) return;
    const bars = Array.from(el.querySelectorAll<HTMLElement>(".vbar"));
    let raf = 0, level = 0, kick = 0;
    const onPulse = () => { kick = 1; };
    window.addEventListener("voice-pulse", onPulse);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    const frame = (now: number) => {
      const t = (now - start) / 1000;
      let target: number;
      if (state === "listening") target = mic.current != null ? Math.max(0.12, mic.current) : 0.28 + 0.2 * Math.sin(t * 2.4);
      else { kick *= 0.9; target = 0.25 + 0.2 * (0.5 + 0.5 * Math.sin(t * 5.2)) + 0.55 * kick; }
      level += (target - level) * 0.3;
      if (!reduce) bars.forEach((b, i) => {
        const wob = 0.55 + 0.45 * Math.sin(t * (state === "speaking" ? 7 : 5) + i * 1.25);
        b.style.transform = `scaleY(${Math.min(1, 0.16 + level * 0.9 * wob).toFixed(3)})`;
      });
      el.style.setProperty("--lv", level.toFixed(3));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("voice-pulse", onPulse); el.style.removeProperty("--lv"); bars.forEach((b) => b.style.removeProperty("transform")); };
  }, [state, root, mic]);
}

export function Bars({ small = false }: { small?: boolean }) {
  return <span className={small ? "vbars vbars-s" : "vbars"} aria-hidden>{Array.from({ length: BARS }, (_, i) => <i key={i} className="vbar" />)}</span>;
}

/** Small live bars for the read-along player. */
export function LiveBars({ active }: { active: boolean }) {
  const root = useRef<HTMLSpanElement>(null);
  useVoiceMotion(active ? "speaking" : "idle", root);
  return <span ref={root} className="ra-wave" style={{ color: "var(--accent)" }}><Bars small /></span>;
}

/** A compact glass pill for screens without the big orb: what the voice is doing, with live bars and a stop button. */
export function VoicePill({ state, label, stopLabel, onStop }: { state: VoiceState; label: string; stopLabel: string; onStop: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useVoiceMotion(state, root);
  return (
    <div ref={root} className="voice-pill glass" data-state={state} role="status" aria-live="polite">
      {state === "thinking" ? <span className="orb-spin orb-spin-s" aria-hidden /> : <Bars small />}
      <span className="voice-pill-label">{label}</span>
      <button type="button" className="voice-pill-stop tap" onClick={onStop} aria-label={stopLabel}><i aria-hidden /></button>
    </div>
  );
}

/** The microphone as an ordinary, obvious button. It shows what the voice is doing (live bars, spinner) and stops it on a second tap. */
export function MicButton({ state, label, onClick }: { state: VoiceState; label: string; onClick: () => void }) {
  const root = useRef<HTMLButtonElement>(null);
  useVoiceMotion(state, root);
  return (
    <button ref={root} type="button" className="mic-pill tap" data-state={state} onClick={onClick} aria-label={label}>
      {state === "idle" && <Mic size={22} strokeWidth={2} aria-hidden />}
      {state === "thinking" && <span className="orb-spin orb-spin-s" aria-hidden />}
      {(state === "listening" || state === "speaking") && <Bars small />}
      <span>{label}</span>
    </button>
  );
}
