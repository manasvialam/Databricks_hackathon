"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, Check, ExternalLink, Minus, Navigation, Phone, Plus, ShieldQuestion, Volume2, X } from "lucide-react";
import type { ResultDto } from "@/lib/recommend";
import type { RedFlagResult } from "@/lib/triage/redflags";
import type { Contribution, Preferences } from "@/lib/types";
import { emergencyText, LANGS, say, svcLabel, t, termText, type Lang, type Msg } from "@/lib/i18n";
import type { NearbyHospital } from "@/lib/nearby";
import { placeLine } from "./Slip";
import { Tx, TxText } from "./Tx";

export type CardAnswer = "yes" | "no" | "unknown";

/** iOS-style bottom sheet: springs up, closes with a slide, and can be dragged down by its grabber. */
export function Sheet({ title, onClose, lang, onListen, children }: { title: string; onClose: () => void; lang: Lang; onListen?: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const drag = useRef<{ y: number; dy: number; t: number } | null>(null);

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(onClose, reduce ? 0 : 260);
  }, [closing, onClose]);

  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = overflow; prev?.focus?.({ preventScroll: true }); };
  }, []);

  const onDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, dy: 0, t: performance.now() };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (ref.current) ref.current.style.transition = "none";
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !ref.current) return;
    const dy = Math.max(0, e.clientY - drag.current.y);
    drag.current.dy = dy;
    ref.current.style.transform = `translateY(${dy}px)`;
  };
  const onUp = () => {
    const d = drag.current; drag.current = null;
    const el = ref.current;
    if (!d || !el) return;
    const v = d.dy / Math.max(1, performance.now() - d.t);
    if (d.dy > 110 || v > 0.6) { el.style.setProperty("--drag", `${d.dy}px`); el.style.transform = ""; el.style.transition = ""; close(); return; }
    el.style.transition = "transform .45s cubic-bezier(.32,.72,0,1)";
    el.style.transform = "";
  };

  return (
    <div className="scrim" data-closing={closing} onClick={close}>
      <div className="sheet" data-closing={closing} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="grabber" data-noread aria-label={t(lang, "close")} onClick={close}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        <div className="sheet-head">
          <h2 className="title">{title}</h2>
          {onListen && <button type="button" className="close tap" data-noread onClick={onListen} aria-label={t(lang, "listen")}><Volume2 size={16} strokeWidth={2.5} aria-hidden /></button>}
          <button type="button" className="close tap" data-noread onClick={close} aria-label={t(lang, "close")}><X size={16} strokeWidth={2.5} aria-hidden /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Term({ c, lang }: { c: Contribution; lang: Lang }) {
  const { label, detail } = termText(c, lang);
  // free text with no message key (the model's one-line reason, a data contradiction) is English: translate it
  const free = lang !== "en" && !c.dk && c.detail ? c.detail : null;
  return <span>{label}{free ? <>. <TxText text={free} lang={lang} /></> : detail ? `. ${detail}` : ""}</span>;
}

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

export function WhySheet({ r, lang, onClose, trafficNote, context = [], onListen }: { r: ResultDto; lang: Lang; onClose: () => void; trafficNote: Msg; context?: Msg[]; onListen?: () => void }) {
  const pct = Math.round(r.pBest * 100);
  const ev = r.evidence.find((e) => e.snippets.length);
  const quote = ev?.snippets[0];
  const src = ev?.sources[0];
  return (
    <Sheet title={t(lang, "whyThis")} onClose={onClose} lang={lang} onListen={onListen}>
      <p className="muted">{t(lang, "whyIntro")}</p>
      <div style={{ marginTop: 14 }}>
        <div className="big-pct">{pct}<small>%</small></div>
        <div className="bar" aria-hidden><i style={{ width: `${pct}%` }} /></div>
      </div>
      {quote && (
        <div className="block">
          <h3 className="block-h">{t(lang, "theySay")}</h3>
          {/* the facility's own text, cited verbatim, so it stays in the language it was written in */}
          <blockquote className="quote" lang="en">“{quote.text.length > 300 ? quote.text.slice(0, 297) + "…" : quote.text}”</blockquote>
          {src && <p className="src"><a href={src.url} target="_blank" rel="noopener noreferrer">{t(lang, "source")}: <span lang="en">{host(src.url)}</span><ExternalLink size={12} aria-hidden /></a>{!src.namesFacility && <span className="tiny"> ({t(lang, "srcNotNamed")})</span>}</p>}
        </div>
      )}
      <div className="block">
        <h3 className="block-h">{t(lang, "positives")}</h3>
        <ul className="why-list">
          <li><span className="why-ico pos"><Plus size={14} strokeWidth={2.5} aria-hidden /></span><Term c={r.why.baseline} lang={lang} /></li>
          {r.why.positive.map((p) => <li key={p.label}><span className="why-ico pos"><Plus size={14} strokeWidth={2.5} aria-hidden /></span><Term c={p} lang={lang} /></li>)}
        </ul>
      </div>
      {r.why.negative.length > 0 && (
        <div className="block">
          <h3 className="block-h">{t(lang, "negatives")}</h3>
          <ul className="why-list">{r.why.negative.map((p) => <li key={p.label}><span className="why-ico neg"><Minus size={14} strokeWidth={2.5} aria-hidden /></span><Term c={p} lang={lang} /></li>)}</ul>
        </div>
      )}
      <div className="block card-flat" style={{ display: "grid", gap: 8 }}>
        {r.warnings.slice(1).map((w) => <p key={w.text} className="small"><Tx m={w} lang={lang} /></p>)}
        {context.map((c) => <p key={c.text} className="small"><Tx m={c} lang={lang} /></p>)}
        <p className="small"><Tx m={trafficNote} lang={lang} /></p>
        {r.registry && <p className="small">{t(lang, "registryNote")}</p>}
        <p className="small">{t(lang, "estimate")}</p>
        <p className="small">{t(lang, "notAffiliated")}</p>
      </div>
    </Sheet>
  );
}

function Segmented<V extends string>({ value, onChange, items, labelledBy }: { value: V; onChange: (v: V) => void; items: { value: V; label: string }[]; labelledBy: string }) {
  const i = Math.max(0, items.findIndex((x) => x.value === value));
  return (
    <div className="seg" role="radiogroup" aria-labelledby={labelledBy}>
      <span className="seg-thumb" aria-hidden style={{ width: `calc((100% - 6px) / ${items.length})`, transform: `translateX(${i * 100}%)` }} />
      {items.map((x) => (
        <button key={x.value} type="button" role="radio" aria-checked={x.value === value} onClick={() => onChange(x.value)}>{x.label}</button>
      ))}
    </div>
  );
}

const SLIDERS: { k: keyof Preferences; label: "prefSpeed" | "prefTrust" | "prefCost" | "prefComfort" }[] = [
  { k: "speed", label: "prefSpeed" }, { k: "trust", label: "prefTrust" }, { k: "cost", label: "prefCost" }, { k: "comfort", label: "prefComfort" },
];

export function PrefSheet({ lang, prefs, card, onApply, onClose, onListen }: {
  lang: Lang; prefs: Preferences; card: CardAnswer; onApply: (p: Preferences, c: CardAnswer) => void; onClose: () => void; onListen?: () => void;
}) {
  const [p, setP] = useState(prefs);
  const [c, setC] = useState<CardAnswer>(card);
  return (
    <Sheet title={t(lang, "prefs")} onClose={onClose} lang={lang} onListen={onListen}>
      <div className="field" style={{ marginTop: 4 }}>
        <span className="field-label" id="card-q">{t(lang, "card")}</span>
        <Segmented labelledBy="card-q" value={c} onChange={setC}
          items={[{ value: "yes", label: t(lang, "yes") }, { value: "no", label: t(lang, "no") }, { value: "unknown", label: t(lang, "notSure") }]} />
      </div>
      {SLIDERS.map(({ k, label }) => (
        <div className="field" key={k}>
          <label className="field-label" htmlFor={`s-${k}`}>{t(lang, label)}<output htmlFor={`s-${k}`}>{Math.round(p[k] * 100)}</output></label>
          <input id={`s-${k}`} className="range" type="range" min={0} max={1} step={0.05} value={p[k]}
            style={{ ["--fill" as string]: `${p[k] * 100}%` }} onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} />
        </div>
      ))}
      <button type="button" className="btn btn-dark tap" style={{ width: "100%", marginTop: 28 }} onClick={() => onApply(p, c)}>{t(lang, "apply")}</button>
    </Sheet>
  );
}

export function LangSheet({ lang, onPick, onClose, onListen }: { lang: Lang; onPick: (l: Lang) => void; onClose: () => void; onListen?: () => void }) {
  return (
    <Sheet title={t(lang, "language")} onClose={onClose} lang={lang} onListen={onListen}>
      <div>
        {LANGS.map((l) => (
          <button key={l.id} type="button" className="check-row tap" lang={l.id} aria-pressed={l.id === lang} onClick={() => onPick(l.id)}>
            <span>{l.native}{l.native !== l.label && <small lang="en">{l.label}</small>}</span>
            {l.id === lang && <Check size={20} strokeWidth={2.5} aria-hidden />}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function EmergencyCard({ gate, lang, online }: { gate: RedFlagResult; lang: Lang; online: boolean }) {
  const cats = gate.categories.slice(0, 2);
  const helpline = gate.numbers.find((n) => n.number === "14416");
  return (
    <section className="emerg" role="alert" aria-labelledby="em-h">
      <h1 id="em-h" data-read>{t(lang, "emergencyTitle")}</h1>
      <p data-read>{t(lang, "emergencyNow")}</p>
      <div className="emerg-call" data-read="list">
        <a href="tel:108" className="tap"><span className="ring"><Phone size={22} aria-hidden /></span><div>{t(lang, "callNow", { n: 108 })}<span>{t(lang, "ambulance")}</span></div></a>
        <a href="tel:112" className="tap"><span className="ring"><Phone size={22} aria-hidden /></span><div>{t(lang, "callNow", { n: 112 })}<span>{t(lang, "emergencyAll")}</span></div></a>
        {helpline && <a href="tel:14416" className="tap"><span className="ring"><Phone size={22} aria-hidden /></span><div>{t(lang, "callNow", { n: 14416 })}<span>{t(lang, "teleManas")}</span></div></a>}
      </div>
      {cats.map((c) => {
        // the gate's own text is English; a translation replaces it whole, so a card never mixes two languages
        const tr = emergencyText(c.id, lang);
        const text = tr ?? { label: c.label, now: c.now, wait: c.whileWaiting };
        return (
          <div key={c.id} lang={tr ? lang : "en"} className="emerg-cat">
            <p data-read><b>{text.label}.</b> {text.now}</p>
            {text.wait && <p className="wait" data-read><span lang={lang}>{t(lang, "whileWaiting")}:</span> {text.wait}</p>}
          </div>
        );
      })}
      {!online && <p style={{ fontSize: 14 }}>{t(lang, "emergencyOffline")}</p>}
    </section>
  );
}

export function HospitalSheet({ h, lang, onClose, onListen }: { h: NearbyHospital; lang: Lang; onClose: () => void; onListen?: () => void }) {
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lon}`;
  return (
    <Sheet title={h.name} onClose={onClose} lang={lang} onListen={onListen}>
      <p className="muted" lang="en">{placeLine(h)}</p>
      <p className="small" style={{ marginTop: 4 }}>{t(lang, "kmAway", { km: h.km })}</p>
      <div className="tags" style={{ marginTop: 12 }}>
        {h.registry && <span className="badge" data-tier={h.registry}>{h.registry === "verified" ? <BadgeCheck size={16} aria-hidden /> : <ShieldQuestion size={16} aria-hidden />}{t(lang, h.registry === "verified" ? "pmjayListed" : "registryPossible")}</span>}
        {h.nabh && <span className="tag">{t(lang, "nabh")}</span>}
        {h.open24h && <span className="tag">{t(lang, "open24")}</span>}
      </div>
      <div className="block">
        <h3 className="block-h">{t(lang, "servicesFound")}</h3>
        {h.services.length
          ? <div className="tags">{h.services.map((id) => <span key={id} className="tag">{svcLabel(id, lang)}</span>)}</div>
          : <p className="small">{t(lang, "noServicesYet")}</p>}
      </div>
      <div className="btn-row actions">
        {h.phone
          ? <a className="btn btn-primary tap" href={`tel:${h.phone.replace(/[^\d+]/g, "")}`}><Phone size={18} aria-hidden />{t(lang, "call")}</a>
          : <span className="btn" aria-disabled="true"><Phone size={18} aria-hidden />{t(lang, "call")}</span>}
        <a className="btn btn-soft tap" href={dir} target="_blank" rel="noopener noreferrer"><Navigation size={18} aria-hidden />{t(lang, "directions")}</a>
      </div>
      {!h.phone && <p className="tiny" style={{ marginTop: 8, textAlign: "center" }}>{t(lang, "noPhone")}</p>}
    </Sheet>
  );
}
