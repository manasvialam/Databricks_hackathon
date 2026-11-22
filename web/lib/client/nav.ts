"use client";
import { useEffect, useRef } from "react";

/** What the person is looking at. Each distinct value is one step in the browser history. */
export interface NavEntry { v: string; sel: number; ov: string | null; g: boolean }
const key = (e: NavEntry) => `${e.v}|${e.sel}|${e.ov ?? ""}|${e.g ? 1 : 0}`;

/**
 * Makes the phone's back button, the iOS swipe-back and the in-app back arrow behave like a native app.
 * The app is one page, so without this "back" would leave it from any screen. The current screen, chosen hospital and
 * open sheet are mirrored into history: moving forward to a new combination pushes an entry; returning to the previous
 * combination (closing a sheet, the back arrow) goes back instead of pushing a duplicate; the browser back button
 * restores the previous combination through `apply`.
 */
export function useHistorySync(entry: NavEntry, apply: (e: NavEntry) => void) {
  const stack = useRef<NavEntry[]>([entry]);
  const cur = useRef(0);
  const applyRef = useRef(apply); applyRef.current = apply;

  useEffect(() => {
    try { window.history.replaceState({ ...(window.history.state ?? {}), navI: 0 }, ""); } catch { /* no history API */ }
    const onPop = (ev: PopStateEvent) => {
      const i = (ev.state as { navI?: number } | null)?.navI;
      const target = typeof i === "number" ? stack.current[i] : undefined;
      cur.current = target ? (i as number) : 0;                       // an entry we do not know: go to the first screen
      applyRef.current(target ?? stack.current[0]);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const k = key(entry);
  useEffect(() => {
    const here = stack.current[cur.current];
    if (key(here) === k) { stack.current[cur.current] = entry; return; }
    const before = stack.current[cur.current - 1];
    if (before && key(before) === k) { cur.current -= 1; window.history.back(); return; }
    stack.current = stack.current.slice(0, cur.current + 1);
    stack.current.push(entry);
    cur.current += 1;
    try { window.history.pushState({ navI: cur.current }, ""); } catch { /* ignore */ }
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    /** One step back; on the first entry, return to the first screen. */
    back: () => { if (cur.current > 0) window.history.back(); else applyRef.current(stack.current[0]); },
  };
}
