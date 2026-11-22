"use client";
import { useEffect, useId, useRef } from "react";
import { useMicLevel } from "@/lib/client/audio-level";

export type Mood = "idle" | "listening" | "thinking" | "speaking" | "happy" | "concerned";

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/**
 * The guide is a silhouette cat: one solid cream shape (round head, two triangle ears, a teardrop body, a curled tail) with nothing drawn on it but
 * two glowing orange eyes with slit pupils, a few whisker strokes outside the outline, and a tiny mouth that opens when it speaks. Moods: the tail
 * sways when idle and wags when pleased, the head tilts, the ears perk and sound arcs appear when listening, the eyes look up with dots when thinking,
 * the eyes close into happy arcs when pleased, and the ears go flat with slanted eyes and a sweat drop when worried. One loop drives continuous motion; switches (eyes, brows, dots) come from `data-mood` in CSS.
 */
function useCatMotion(mood: Mood, root: React.RefObject<SVGSVGElement | null>) {
  const mic = useMicLevel(mood === "listening");
  useEffect(() => {
    const svg = root.current;
    if (!svg) return;
    const one = (p: string) => svg.querySelector<SVGElement>(`[data-p="${p}"]`);
    const head = one("head"), tail = one("tail"), earL = one("earL"), earR = one("earR"), mouth = one("mouth"), eyes = one("eyes"), look = one("look");
    const arcs = Array.from(svg.querySelectorAll<SVGElement>('[data-p="arc"]'));
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, kick = 0, lv = 0, tilt = 0, tailR = 0, eL = 0, eR = 0, lx = 0, ly = 0, nextBlink = performance.now() + 2200, blinkAt = -1e9;
    const ptr = { x: 0, y: 0 };
    const t0 = performance.now();
    const onPulse = () => { kick = 1; };
    const onMove = (e: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      ptr.x = clamp((e.clientX - (r.left + r.width * 0.5)) / (window.innerWidth * 0.5), -1, 1);
      ptr.y = clamp((e.clientY - (r.top + r.height * 0.4)) / (window.innerHeight * 0.5), -1, 1);
    };
    window.addEventListener("voice-pulse", onPulse);
    window.addEventListener("pointermove", onMove, { passive: true });
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      let tt = ptr.x * 5, tl = Math.sin(t * 1.3) * 7, ea = 0, eb = 0, px = ptr.x * 3, py = ptr.y * 2.4;
      if (mood === "listening") { tt = -9; tl = Math.sin(t * 2) * 4; ea = -6; eb = 6; px = 0; py = 0; }
      else if (mood === "thinking") { tt = 7; tl = Math.sin(t * 0.9) * 10 + 6; px = 3.4; py = -3.4; }
      else if (mood === "speaking") { tt = Math.sin(t * 2.2) * 2.6 + kick * 3; tl = Math.sin(t * 3) * 6; px = 0; py = 0; }
      else if (mood === "happy") { tt = -4; tl = Math.sin(t * 13) * 20; px = 0; py = 0; }
      else if (mood === "concerned") { tt = 6; tl = -4; ea = 26; eb = -26; px = 0; py = 2; }
      tilt += (tt - tilt) * 0.1; tailR += (tl - tailR) * 0.15; eL += (ea - eL) * 0.15; eR += (eb - eR) * 0.15; lx += (px - lx) * 0.12; ly += (py - ly) * 0.12; kick *= 0.88;
      if (!reduce) {
        head && (head.style.transform = `rotate(${tilt.toFixed(2)}deg)`);
        tail && (tail.style.transform = `rotate(${tailR.toFixed(2)}deg)`);
        earL && (earL.style.transform = `rotate(${eL.toFixed(2)}deg)`); earR && (earR.style.transform = `rotate(${eR.toFixed(2)}deg)`);
        look && (look.style.transform = `translate(${lx.toFixed(2)}px, ${ly.toFixed(2)}px)`);
        if (now > nextBlink) { blinkAt = now; nextBlink = now + 2400 + Math.random() * 3400; }
        const bp = (now - blinkAt) / 150, blink = bp >= 0 && bp < 1 ? Math.sin(bp * Math.PI) : 0;
        eyes && (eyes.style.transform = `scaleY(${(1 - 0.92 * blink).toFixed(3)})`);
        mouth && (mouth.style.transform = `scaleY(${mood === "speaking" ? clamp(0.25 + 0.45 * (0.5 + 0.5 * Math.sin(t * 9.5)) + 0.5 * kick, 0.15, 1).toFixed(3) : 0.01})`);
        if (mood === "listening") {
          const target = (mic.current != null ? mic.current : 0.25) + 0.12 * (0.5 + 0.5 * Math.sin(t * 3.1));
          lv += (target - lv) * 0.3;
          arcs.forEach((a, i) => { a.style.transform = `scale(${(1 + lv * (0.16 + i * 0.1)).toFixed(3)})`; a.style.opacity = String(clamp(0.4 + lv * 0.9 - i * 0.15, 0.15, 1).toFixed(2)); });
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); window.removeEventListener("voice-pulse", onPulse); window.removeEventListener("pointermove", onMove);
      [head, tail, earL, earR, mouth, eyes, look, ...arcs].forEach((n) => { n?.style.removeProperty("transform"); n?.style.removeProperty("opacity"); });
    };
  }, [mood, root, mic]);
}

export function HelperFace({ mood }: { mood: Mood }) {
  const ref = useRef<SVGSVGElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  useCatMotion(mood, ref);
  const fill = `url(#c${id})`;
  return (
    <svg ref={ref} className="cat" data-mood={mood} viewBox="0 0 170 150" preserveAspectRatio="xMidYMax meet" aria-hidden focusable="false">
      <defs><linearGradient id={`c${id}`} x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stopColor="#fff6e8" /><stop offset="1" stopColor="#ffd3a0" /></linearGradient></defs>
      <ellipse className="ct-shadow" cx="80" cy="143" rx="40" ry="5" />
      <g className="ct-all">
        <g data-p="tail"><path className="ct-tail" stroke={fill} d="M112 126 C146 126 152 92 134 78" /></g>
        <path fill={fill} d="M44 140 C36 102 54 82 80 82 C106 82 124 102 116 140 Z" />
        <g data-p="head">
          <g data-p="earL"><polygon fill={fill} points="52,46 54,14 78,34" /></g>
          <g data-p="earR"><polygon fill={fill} points="108,46 106,14 82,34" /></g>
          <circle fill={fill} cx="80" cy="62" r="31" />
          <g data-p="look">
            <g data-p="eyes" className="ct-eyes">
              <g className="ct-eye ct-eye-l"><ellipse className="ct-iris" cx="66" cy="62" rx="6.2" ry="8" /><ellipse className="ct-pupil" cx="66" cy="62" rx="1.9" ry="6.4" /></g>
              <g className="ct-eye ct-eye-r"><ellipse className="ct-iris" cx="94" cy="62" rx="6.2" ry="8" /><ellipse className="ct-pupil" cx="94" cy="62" rx="1.9" ry="6.4" /></g>
            </g>
          </g>
          <g className="ct-happy"><path d="M58 65 Q66 53 74 65" /><path d="M86 65 Q94 53 102 65" /></g>
          <g data-p="mouth" className="ct-mouth"><ellipse cx="80" cy="82" rx="5" ry="4.4" /></g>
          <path className="ct-whisk" d="M50 74 L26 69 M50 79 L26 82 M110 74 L134 69 M110 79 L134 82" />
          <g className="ct-dots"><circle cx="116" cy="30" r="3.6" /><circle cx="126" cy="18" r="4.8" /><circle cx="138" cy="4" r="6" /></g>
          <path className="ct-sweat" d="M108 40 Q113 48 108 52 Q103 48 108 40 Z" />
        </g>
        <g className="ct-arcs"><path data-p="arc" className="ct-arc" d="M134 40 Q144 62 134 84" /><path data-p="arc" className="ct-arc" d="M148 30 Q162 62 148 94" /></g>
      </g>
    </svg>
  );
}
