"use client";
import { useEffect, useId, useRef } from "react";
import { useMicLevel } from "@/lib/client/audio-level";

export type Mood = "idle" | "listening" | "thinking" | "speaking" | "happy" | "concerned";

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/**
 * The guide is a simple hospital: one cream building with two low wings, an orange cross badge on top, a grid of windows and an arched door.
 * Moods: idle - the cross breathes; listening - windows light up and sound arcs swell with the mic; thinking - the windows light in turn;
 * speaking - the cross pulses with each spoken word; happy - the building hops and the cross glows; concerned - the cross turns red and a beacon flashes.
 * One loop drives the continuous parts (mic arcs, word pulse); the rest is CSS from `data-mood`.
 */
function useHospitalMotion(mood: Mood, root: React.RefObject<SVGSVGElement | null>) {
  const mic = useMicLevel(mood === "listening");
  useEffect(() => {
    const svg = root.current;
    if (!svg) return;
    const cross = svg.querySelector<SVGElement>('[data-p="cross"]');
    const arcs = Array.from(svg.querySelectorAll<SVGElement>('[data-p="arc"]'));
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, kick = 0, lv = 0;
    const t0 = performance.now();
    const onPulse = () => { kick = 1; };
    window.addEventListener("voice-pulse", onPulse);
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      if (!reduce) {
        if (mood === "speaking") cross && (cross.style.transform = `scale(${(1 + 0.1 * (0.5 + 0.5 * Math.sin(t * 8)) + 0.16 * kick).toFixed(3)})`);
        else cross && cross.style.removeProperty("transform");
        if (mood === "listening") {
          const target = (mic.current != null ? mic.current : 0.25) + 0.12 * (0.5 + 0.5 * Math.sin(t * 3.1));
          lv += (target - lv) * 0.3;
          arcs.forEach((a, i) => { a.style.transform = `scale(${(1 + lv * (0.16 + i * 0.1)).toFixed(3)})`; a.style.opacity = String(clamp(0.4 + lv * 0.9 - i * 0.15, 0.15, 1).toFixed(2)); });
        }
        kick *= 0.88;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); window.removeEventListener("voice-pulse", onPulse);
      [cross, ...arcs].forEach((n) => { n?.style.removeProperty("transform"); n?.style.removeProperty("opacity"); });
    };
  }, [mood, root, mic]);
}

/** Window grid of a typical multi-storey Indian hospital block. */
const WINDOWS: [number, number][] = [48, 68, 88].flatMap((y) => [35, 57, 79, 101].map((x) => [x, y] as [number, number]));

export function HelperFace({ mood }: { mood: Mood }) {
  const ref = useRef<SVGSVGElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  useHospitalMotion(mood, ref);
  const fill = `url(#h${id})`;
  return (
    <svg ref={ref} className="hosp" data-mood={mood} viewBox="0 0 170 150" preserveAspectRatio="xMidYMax meet" aria-hidden focusable="false">
      <defs><linearGradient id={`h${id}`} x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stopColor="#fff6e8" /><stop offset="1" stopColor="#ffd3a0" /></linearGradient></defs>
      <ellipse className="hs-shadow" cx="85" cy="143" rx="74" ry="5" />
      <g className="hs-all">
        <rect fill={fill} x="30" y="38" width="90" height="102" rx="3" />
        <rect className="hs-roof" x="27" y="35" width="96" height="6" rx="3" />
        <g data-p="cross" className="hs-cross">
          <rect className="hs-badge" x="46" y="12" width="58" height="24" rx="5" />
          <path className="hs-plus" d="M60 17.5 H65 V22 H69.5 V27 H65 V31.5 H60 V27 H55.5 V22 H60 Z" />
          <rect className="hs-plus" x="75" y="19" width="22" height="3" rx="1.5" /><rect className="hs-plus" x="75" y="26" width="15" height="3" rx="1.5" />
        </g>
        {WINDOWS.map(([x, y], i) => <rect key={i} className="hs-win" style={{ animationDelay: `${(i % 4) * 0.14 + Math.floor(i / 4) * 0.14}s` }} x={x} y={y} width="14" height="13" rx="2" />)}
        <rect className="hs-roof" x="48" y="106" width="54" height="5" rx="2.5" />
        <rect className="hs-door" x="60" y="112" width="30" height="28" rx="2" /><path className="hs-doorline" d="M75 112 V140" />
        <g className="hs-amb">
          <rect className="hs-body" x="102" y="112" width="44" height="26" rx="4" />
          <path className="hs-body" d="M144 120 H152 Q158 120 160 128 V138 H144 Z" />
          <path className="hs-door" d="M148 123 H152 Q155 123 157 129 H148 Z" />
          <rect className="hs-badge" x="102" y="129" width="58" height="3" />
          <path className="hs-badge" d="M119 117 h4 v3.5 h3.5 v4 h-3.5 v3.5 h-4 v-3.5 h-3.5 v-4 h3.5 Z" />
          <g className="hs-beacon"><rect x="128" y="108" width="10" height="4" rx="2" /></g>
          <circle className="hs-wheel" cx="116" cy="138" r="6" /><circle className="hs-wheel" cx="150" cy="138" r="6" />
          <circle className="hs-hub" cx="116" cy="138" r="2.2" /><circle className="hs-hub" cx="150" cy="138" r="2.2" />
        </g>
        <g className="hs-arcs">
          <path data-p="arc" className="hs-arc" d="M18 56 Q8 84 18 112" /><path data-p="arc" className="hs-arc" d="M4 44 Q-12 84 4 124" />
          <path data-p="arc" className="hs-arc" d="M152 44 Q168 66 152 88" /><path data-p="arc" className="hs-arc" d="M164 34 Q184 66 164 98" />
        </g>
        <g className="hs-dots"><circle cx="124" cy="26" r="3.4" /><circle cx="134" cy="14" r="4.6" /><circle cx="146" cy="2" r="5.8" /></g>
      </g>
    </svg>
  );
}
