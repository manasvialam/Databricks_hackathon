"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { speechLang, t, type Lang } from "@/lib/i18n";
import { canSpeak, speechRate, voiceFor, voicesReady } from "./speech";

/**
 * Read-along: speaks the parts of the screen marked data-read, one after another, in the language each part is written in,
 * highlights the part being read (and the current word where the browser reports word boundaries), and scrolls to it.
 *
 *   data-read            read the element's text
 *   data-read="list"     read each child as its own sentence
 *   data-read-text="…"   read this text instead (for numbers and icons that do not read well)
 * A lang attribute on the element or a parent sets the voice, so quoted English text is read with an English voice.
 */
export interface Piece { node: Text; at: number; len: number; s: number }   // a text node's spoken span: spoken[s..s+len) = node text from index at
export interface Seg { el: HTMLElement; text: string; lang: string; words: boolean; map?: Piece[] }
export type RAState = { status: "idle" | "playing" | "paused"; index: number; total: number; skipped: boolean };

const TAG: Record<string, string> = { en: "en-IN", hi: "hi-IN", ta: "ta-IN", te: "te-IN", ml: "ml-IN" };
const tagOf = (l: string, ui: Lang) => TAG[l.toLowerCase().split("-")[0]] ?? speechLang(ui);

function visible(el: HTMLElement) { return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"; }

const INLINE = new Set(["SPAN", "B", "I", "STRONG", "EM", "SMALL", "A", "SUP", "SUB", "OUTPUT", "CODE", "Q", "ABBR", "TIME", "BDI", "MARK", "LABEL", "BR"]);
const IGNORE = new Set(["SCRIPT", "STYLE", "SVG", "CANVAS", "NOSCRIPT"]);
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** All visible text pieces of an element, in order, joined so that separate pieces ("Your location", "Patna") do not run together. */
function pieces(el: HTMLElement): { text: string; map: Piece[] } {
  const map: Piece[] = []; let text = "";
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => n.nodeType === 1 && ((n as HTMLElement).getAttribute("aria-hidden") === "true" || IGNORE.has((n as HTMLElement).tagName.toUpperCase())) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let n: Node | null;
  while ((n = w.nextNode())) {
    if (n.nodeType !== 3) continue;
    const raw = n.textContent ?? "";
    let c = clean(raw).replace(/·/g, ",");                       // same length, so highlight positions stay exact
    if (!c) continue;
    if (/^[:;]$/.test(c)) { text += c; continue; }                // "Source" + ":" -> "Source:"
    if (/^[\s,.·•|()[\]\-–—+/]+$/.test(c)) continue;             // lone symbols are layout, not speech
    let lead = raw.length - raw.trimStart().length;
    const stripped = /^[,.;\s]+/.exec(c);                       // ". detail" after a label: speak "detail" without a stray full stop
    if (stripped && stripped[0].length < c.length) { c = c.slice(stripped[0].length); lead += stripped[0].length; }
    const unit = /^[a-zA-Z%]{1,4}$|^\p{L}{1,8}$/u.test(c) && /\d$/.test(text);   // "7" + "min" -> "7 min"
    if (text) text += unit || /[.!?।:,;]$/.test(text) ? " " : ", ";
    map.push({ node: n as Text, at: lead, len: c.length, s: text.length });
    text += c;
  }
  return { text: text.replace(/\s+,/g, ","), map };
}

/** Everything on a screen that a person would read, in order: marked parts (data-read) as authored, the rest found by walking the page. */
export function collect(root: ParentNode, ui: Lang): Seg[] {
  const out: Seg[] = [];
  const langOf = (el: Element) => tagOf(el.closest("[lang]")?.getAttribute("lang") ?? ui, ui);
  const state = (el: HTMLElement) => (el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-pressed") === "true" ? `, ${t(ui, "selected")}` : "");
  const visit = (el: HTMLElement) => {
    if (el.getAttribute("aria-hidden") === "true" || el.hasAttribute("data-noread") || IGNORE.has(el.tagName.toUpperCase()) || el.hidden) return;
    if (el.dataset.read !== undefined) {
      if (!visible(el)) return;
      const override = el.dataset.readText;
      let text: string, words = false;
      if (override) text = override;
      else if (el.dataset.read === "list") text = Array.from(el.children).map((c) => clean(c.textContent ?? "")).filter(Boolean).join(". ");
      else { text = el.textContent ?? ""; words = true; }
      if (text.trim()) out.push({ el, text, lang: langOf(el), words });
      return;
    }
    const tag = el.tagName.toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA") {
      const type = (el as HTMLInputElement).type;
      const label = el.getAttribute("aria-label") || (el as HTMLInputElement).placeholder;
      if (label && type !== "range" && type !== "hidden" && visible(el)) out.push({ el, text: label, lang: langOf(el), words: false });
      return;
    }
    const kids = Array.from(el.children) as HTMLElement[];
    const isBlock = kids.every((k) => INLINE.has(k.tagName.toUpperCase()) || IGNORE.has(k.tagName.toUpperCase()));
    if (isBlock) {
      if (!visible(el)) return;
      const { text, map } = pieces(el);
      if (text) out.push({ el, text: text + state(el), lang: langOf(el), words: true, map });
      else if ((tag === "BUTTON" || tag === "A") && el.getAttribute("aria-label")) out.push({ el, text: el.getAttribute("aria-label")! + state(el), lang: langOf(el), words: false });   // icon-only controls
      return;
    }
    kids.forEach(visit);
  };
  Array.from((root as Element).children ?? []).forEach((c) => visit(c as HTMLElement));
  if ((root as Element).nodeType === 1 && !out.length) visit(root as HTMLElement);
  return out;
}

function rangeAt(el: HTMLElement, start: number, end: number): Range | null {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let pos = 0, n: Node | null, r: Range | null = null;
  while ((n = w.nextNode())) {
    const len = (n.textContent ?? "").length;
    if (!r && start < pos + len) { r = document.createRange(); r.setStart(n, start - pos); }
    if (r && end <= pos + len) { r.setEnd(n, Math.max(0, end - pos)); return r; }
    pos += len;
  }
  return r;
}
type HL = { set(name: string, h: unknown): void; delete(name: string): void };
const highlights = (): HL | null => (typeof CSS !== "undefined" && (CSS as unknown as { highlights?: HL }).highlights) || null;
const clearWord = () => highlights()?.delete("readword");

export class ReadAlong {
  private segs: Seg[] = [];
  private i = 0;
  private status: RAState["status"] = "idle";
  private skipped = false;
  private token = 0;
  rate = 1;          // 1 = normal; the slow button sets a lower value
  constructor(private ui: () => Lang, private on: (s: RAState) => void) {}

  private emit() { this.on({ status: this.status, index: this.i, total: this.segs.length, skipped: this.skipped }); }
  private mark(el: HTMLElement | null) {
    document.querySelectorAll("[data-reading]").forEach((e) => e.removeAttribute("data-reading"));
    clearWord();
    if (el) {
      el.setAttribute("data-reading", "true");
      el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  }

  start(root: ParentNode = document, from = 0): boolean {
    if (!canSpeak()) return false;
    this.cancel();
    this.segs = collect(root, this.ui());
    this.i = Math.min(from, Math.max(0, this.segs.length - 1));
    this.skipped = false;
    if (!this.segs.length) { this.status = "idle"; this.emit(); return false; }
    this.status = "playing";
    this.speakAt(this.i);
    return true;
  }

  private speakAt(i: number): void {
    const my = ++this.token;
    window.speechSynthesis.cancel();
    if (i >= this.segs.length) return this.finish();
    this.i = i; const seg = this.segs[i];
    const voice = voiceFor(seg.lang);
    if (!voice && voicesReady()) { this.skipped = true; this.emit(); return this.speakAt(i + 1); }   // no voice for this language: skip, never garble
    this.mark(seg.el); this.emit();
    const u = new SpeechSynthesisUtterance(seg.text);
    u.lang = seg.lang; u.rate = this.rate === 1 ? speechRate(voice) : this.rate; if (voice) u.voice = voice;
    u.onboundary = (e) => {
      if (my !== this.token || !seg.words) return;
      const h = highlights(); if (!h || typeof Highlight === "undefined") return;
      const m = /^\S+/.exec(seg.text.slice(e.charIndex));
      let r: Range | null = null;
      if (m && seg.map) {
        const p = seg.map.find((x) => e.charIndex >= x.s && e.charIndex < x.s + x.len);
        if (p) { const from = p.at + (e.charIndex - p.s), to = Math.min(p.at + p.len, from + m[0].length); r = document.createRange(); r.setStart(p.node, from); r.setEnd(p.node, to); }
      } else if (m) r = rangeAt(seg.el, e.charIndex, e.charIndex + m[0].length);
      if (r) h.set("readword", new Highlight(r));
    };
    u.onend = () => { if (my === this.token && this.status === "playing") this.speakAt(i + 1); };
    u.onerror = (e) => { if (my === this.token && e.error !== "interrupted" && e.error !== "canceled" && this.status === "playing") this.speakAt(i + 1); };
    window.speechSynthesis.speak(u);
  }

  pause() { if (this.status !== "playing") return; this.status = "paused"; this.token++; window.speechSynthesis.cancel(); this.emit(); }
  resume() { if (this.status !== "paused") return; this.status = "playing"; this.speakAt(this.i); }
  next() { if (this.status === "idle") return; this.status = "playing"; this.speakAt(this.i + 1); }
  prev() { if (this.status === "idle") return; this.status = "playing"; this.speakAt(Math.max(0, this.i - 1)); }
  setRate(r: number) { this.rate = r; if (this.status === "playing") this.speakAt(this.i); }
  private finish() { this.status = "idle"; this.mark(null); this.emit(); }
  cancel() { this.token++; if (canSpeak()) window.speechSynthesis.cancel(); this.mark(null); if (this.status !== "idle") { this.status = "idle"; this.emit(); } }
}

export function useReadAlong(lang: Lang) {
  const [state, setState] = useState<RAState>({ status: "idle", index: 0, total: 0, skipped: false });
  const langRef = useRef(lang); langRef.current = lang;
  const ra = useRef<ReadAlong | null>(null);
  if (!ra.current && typeof window !== "undefined") ra.current = new ReadAlong(() => langRef.current, setState);
  const [available, setAvailable] = useState(false);   // known only in the browser, so decided after mount (keeps server and client HTML equal)
  useEffect(() => { setAvailable(canSpeak()); return () => ra.current?.cancel(); }, []);
  const start = useCallback((root?: ParentNode) => ra.current?.start(root) ?? false, []);
  return {
    state, start, available,
    pause: () => ra.current?.pause(), resume: () => ra.current?.resume(), next: () => ra.current?.next(), prev: () => ra.current?.prev(),
    stop: () => ra.current?.cancel(), setRate: (r: number) => ra.current?.setRate(r),
  };
}
