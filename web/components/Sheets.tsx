"use client";
import { useEffect, useRef, useState } from "react";
import { SegmentedControl, Slider } from "glisse";
import { Minus, Phone, Plus, X } from "lucide-react";
import type { ResultDto } from "@/lib/recommend";
import type { RedFlagResult } from "@/lib/triage/redflags";
import type { Preferences } from "@/lib/types";
import { t, type Lang } from "@/lib/i18n";

export type CardAnswer = "yes" | "no" | "unknown";

function Sheet({ title, onClose, lang, children }: { title: string; onClose: () => void; lang: Lang; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("keydown", esc); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 className="h2">{title}</h2>
          <button type="button" className="btn btn-text close" onClick={onClose} aria-label={t(lang, "close")}><X size={22} aria-hidden /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function WhySheet({ r, lang, onClose, trafficNote }: { r: ResultDto; lang: Lang; onClose: () => void; trafficNote: string }) {
  return (
    <Sheet title={t(lang, "why")} onClose={onClose} lang={lang}>
      <p>{t(lang, "whyIntro")}</p>
      <div className="why-row">
        <b>{Math.round(r.pBest * 100)}%</b>
        <div className="bar" aria-hidden><i style={{ width: `${Math.round(r.pBest * 100)}%` }} /></div>
      </div>
      <div className="section">
        <h3>{t(lang, "positives")}</h3>
        <ul className="why-list">
          <li><Plus size={16} aria-hidden /><span>{r.why.baseline}</span></li>
          {r.why.positive.map((p) => <li key={p.label}><Plus size={16} aria-hidden /><span>{p.label}{p.detail ? `. ${p.detail}` : ""}</span></li>)}
        </ul>
      </div>
      {r.why.negative.length > 0 && (
        <div className="section">
          <h3>{t(lang, "negatives")}</h3>
          <ul className="why-list">{r.why.negative.map((p) => <li key={p.label}><Minus size={16} aria-hidden /><span>{p.label}{p.detail ? `. ${p.detail}` : ""}</span></li>)}</ul>
        </div>
      )}
      <div className="section">
        <p className="small">{trafficNote}</p>
        {r.registry && <p className="small" style={{ marginTop: 8 }}>{t(lang, "registryNote")}</p>}
        <p className="small" style={{ marginTop: 8 }}>{t(lang, "estimate")}</p>
        <p className="small" style={{ marginTop: 8 }}>{t(lang, "notAffiliated")}</p>
      </div>
    </Sheet>
  );
}

const SLIDERS: { k: keyof Preferences; label: "prefSpeed" | "prefTrust" | "prefCost" | "prefComfort" }[] = [
  { k: "speed", label: "prefSpeed" }, { k: "trust", label: "prefTrust" }, { k: "cost", label: "prefCost" }, { k: "comfort", label: "prefComfort" },
];

export function PrefSheet({ lang, prefs, card, onApply, onClose }: {
  lang: Lang; prefs: Preferences; card: CardAnswer; onApply: (p: Preferences, c: CardAnswer) => void; onClose: () => void;
}) {
  const [p, setP] = useState(prefs);
  const [c, setC] = useState<CardAnswer>(card);
  return (
    <Sheet title={t(lang, "prefs")} onClose={onClose} lang={lang}>
      <div className="field">
        <label id="card-q">{t(lang, "card")}</label>
        <SegmentedControl aria-labelledby="card-q" value={c} onValueChange={(v) => setC(v as CardAnswer)}
          items={[{ value: "yes", label: t(lang, "yes") }, { value: "no", label: t(lang, "no") }, { value: "unknown", label: t(lang, "notSure") }]} />
      </div>
      {SLIDERS.map(({ k, label }) => (
        <div className="field" key={k}>
          <label htmlFor={`s-${k}`}>{t(lang, label)}</label>
          <Slider id={`s-${k}`} min={0} max={1} step={0.05} value={p[k]} onValueChange={(v) => setP({ ...p, [k]: v })} />
        </div>
      ))}
      <div className="actions" style={{ marginTop: 22 }}>
        <button type="button" className="btn btn-primary wide" onClick={() => onApply(p, c)}>{t(lang, "apply")}</button>
      </div>
    </Sheet>
  );
}

export function EmergencyCard({ gate, lang, online }: { gate: RedFlagResult; lang: Lang; online: boolean }) {
  const cats = gate.categories.slice(0, 2);
  const helpline = gate.numbers.find((n) => n.number === "14416");
  return (
    <section className="emerg" role="alert" aria-labelledby="em-h">
      <h1 id="em-h">{t(lang, "emergencyTitle")}</h1>
      <p>{t(lang, "emergencyNow")}</p>
      <div className="emerg-call">
        <a href="tel:108"><Phone size={30} aria-hidden /><div>{t(lang, "callNow", { n: 108 })}<span>{t(lang, "ambulance")}</span></div></a>
        <a href="tel:112"><Phone size={30} aria-hidden /><div>{t(lang, "callNow", { n: 112 })}<span>{t(lang, "emergencyAll")}</span></div></a>
        {helpline && <a href="tel:14416"><Phone size={30} aria-hidden /><div>{t(lang, "callNow", { n: 14416 })}<span>{t(lang, "teleManas")}</span></div></a>}
      </div>
      {cats.map((c) => (
        <div key={c.id} lang="en" style={{ marginTop: 16 }}>
          <p style={{ fontSize: 18, marginTop: 0 }}><b>{c.label}.</b> {c.now}</p>
          {c.whileWaiting && <p className="small" style={{ marginTop: 6 }}>{t(lang, "whileWaiting")}: {c.whileWaiting}</p>}
        </div>
      ))}
      {!online && <p className="small" style={{ marginTop: 14 }}>{t(lang, "emergencyOffline")}</p>}
    </section>
  );
}
