"use client";
import { useEffect } from "react";

const SELECTOR = ".quick-ico";

/** Interactive shade: while a finger or pointer is over a glass control, a soft highlight follows it (CSS reads --mx and --my). */
export function Shade() {
  useEffect(() => {
    let current: HTMLElement | null = null;
    const set = (el: HTMLElement, e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${Math.round(((e.clientX - r.left) / r.width) * 100)}%`);
      el.style.setProperty("--my", `${Math.round(((e.clientY - r.top) / r.height) * 100)}%`);
    };
    const clear = (el: HTMLElement | null) => { if (!el) return; el.removeAttribute("data-shading"); el.style.removeProperty("--mx"); el.style.removeProperty("--my"); };
    const move = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.(SELECTOR) as HTMLElement | null;
      if (el !== current) { clear(current); current = el; }
      if (el) { el.setAttribute("data-shading", "true"); set(el, e); }
    };
    const up = (e: PointerEvent) => { if (e.pointerType !== "mouse") { clear(current); current = null; } };
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerdown", move, { passive: true });
    document.addEventListener("pointerup", up, { passive: true });
    document.addEventListener("pointercancel", up, { passive: true });
    return () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerdown", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up); };
  }, []);
  return null;
}
