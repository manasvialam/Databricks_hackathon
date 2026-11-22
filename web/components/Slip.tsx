"use client";
import { Name } from "./Name";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, BadgeCheck, ChevronRight, Clock, FileText, Navigation, Phone, PhoneCall, ShieldQuestion, Volume2 } from "lucide-react";
import type { ResultDto } from "@/lib/recommend";
import { svcLabel, t, type Lang } from "@/lib/i18n";
import { Tx } from "./Tx";

export { svcLabel };

export function sureLevel(r: ResultDto): "high" | "mid" | "low" {
  if (!r.solid) return "low";
  return r.pService >= 0.75 ? "high" : r.pService >= 0.55 ? "mid" : "low";
}
const SURE_KEY = { high: "sureHigh", mid: "sureMid", low: "sureLow" } as const;

/** "TAMIL NADU" -> "Tamil Nadu"; place names in the data are inconsistently cased. */
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());

/** "Thanjavur, Tamil Nadu"; a single name when city and state are the same (Delhi). */
export function placeLine(r: { city: string | null; district: string | null; state: string | null }): string {
  const parts = [r.city ?? r.district, r.state].filter((x): x is string => !!x).map(titleCase);
  return parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i).join(", ");
}

function fmtDate(s: string | null, lang: Lang): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(lang === "en" ? "en-IN" : `${lang}-IN`, { year: "numeric", month: "short" });
}

/** Green PM-JAY mark; tapping it opens a small card that says what was cross-checked. */
export function RegistryBadge({ registry, lang }: { registry: { tier: "verified" | "possible"; nabh: boolean; empanelledOn: string | null } | null; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const rg = registry;
  if (!rg) return null;
  const verified = rg.tier === "verified";
  const since = fmtDate(rg.empanelledOn, lang);
  return (
    <div className="pop-wrap" ref={ref}>
      <button type="button" className="badge tap" data-tier={rg.tier} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        {verified ? <BadgeCheck size={16} aria-hidden /> : <ShieldQuestion size={16} aria-hidden />}{t(lang, "pmjayBadge")}
      </button>
      {open && (
        <div className="pop" role="dialog" aria-label={t(lang, "pmjayTitle")} data-tier={rg.tier}>
          <div className="pop-h">{verified ? <BadgeCheck size={18} aria-hidden /> : <ShieldQuestion size={18} aria-hidden />}{verified ? t(lang, "pmjayTitle") : t(lang, "registryPossible")}</div>
          <p>{verified ? t(lang, "pmjayBody") : t(lang, "pmjayPossibleBody")}</p>
          {verified && since && <p>{t(lang, "empanelledOn", { date: since })}</p>}
          {rg.nabh && <p>{t(lang, "nabh")}</p>}
          <p className="tiny">{t(lang, "registryNote")}</p>
        </div>
      )}
    </div>
  );
}

export function Slip({ r, lang, services, onWhy, onSpeak }: {
  r: ResultDto; lang: Lang; services: { id: string }[]; onWhy: () => void; onSpeak: () => void;
}) {
  const [prep, setPrep] = useState(false);
  const level = sureLevel(r);
  const svc = svcLabel(services[0]?.id ?? "", lang);
  const phone = r.phones[0];
  const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lon}`;
  const on = level === "high" ? 3 : level === "mid" ? 2 : 1;
  const where = placeLine(r);
  const warning = r.warnings[0];
  return (
    <article className="card" aria-labelledby={`n-${r.id}`}>
      <div className="slip-top">
        <div className="tags">
          <RegistryBadge registry={r.registry} lang={lang} />
          {r.open24h && <span className="tag"><Clock size={13} aria-hidden />{t(lang, "open24")}</span>}
        </div>
        <button type="button" className="speak tap" onClick={onSpeak} aria-label={t(lang, "readAloud")}><Volume2 size={17} aria-hidden /></button>
      </div>

      <h2 className="slip-name" id={`n-${r.id}`} data-read><Name text={r.name} lang={lang} /></h2>
      {where && <p className="slip-sub"><Name text={where} lang={lang} /></p>}

      <div className="stats" data-read data-read-text={`${r.etaMinutes} ${t(lang, "min")}, ${r.distanceKm} ${t(lang, "km")}`}>
        <div className="stat-num">{r.etaMinutes}<sup>{t(lang, "min")}</sup></div>
        <div className="stat-num">{r.distanceKm}<sup>{t(lang, "km")}</sup></div>
      </div>
      <p className="eta-note">{t(lang, "etaRange", { low: r.etaLow, high: r.etaHigh })}</p>

      <div className="sure">
        <span className="meter" data-level={level} aria-hidden>{[1, 2, 3].map((i) => <i key={i} data-on={i <= on} />)}</span>
        <span>{t(lang, "howSure")}: <b>{t(lang, SURE_KEY[level])}</b></span>
      </div>
      {!r.solid && <p className="callout"><AlertTriangle size={17} aria-hidden /><span>{t(lang, "weakNote")}</span></p>}
      {r.solid && warning && <p className="callout"><AlertTriangle size={17} aria-hidden /><span><Tx m={warning} lang={lang} /></span></p>}

      <div className="btn-row actions">
        {phone
          ? <a className="btn btn-primary tap" href={`tel:${phone.replace(/[^\d+]/g, "")}`}><Phone size={18} aria-hidden />{t(lang, "call")}</a>
          : <span className="btn" aria-disabled="true"><Phone size={18} aria-hidden />{t(lang, "call")}</span>}
        <a className="btn btn-soft tap" href={dirUrl} target="_blank" rel="noopener noreferrer"><Navigation size={18} aria-hidden />{t(lang, "directions")}</a>
      </div>
      {!phone && <p className="tiny" style={{ marginTop: 8, textAlign: "center" }}>{t(lang, "noPhone")}</p>}

      <div className="more">
        <button type="button" className="more-row" onClick={onWhy}>{t(lang, "whyThis")}<ChevronRight size={18} aria-hidden /></button>
        <button type="button" className="more-row" aria-expanded={prep} aria-controls={`prep-${r.id}`} onClick={() => setPrep((p) => !p)}>
          {t(lang, "beforeYouGo")}<ChevronRight size={18} aria-hidden />
        </button>
        <div className="more-body" id={`prep-${r.id}`} data-open={prep}>
          <div>
            <ul>
              <li><PhoneCall size={16} aria-hidden /><span>{t(lang, "callFirst", { service: svc })}</span></li>
              <li><FileText size={16} aria-hidden /><span>{t(lang, "bringLine")}</span></li>
            </ul>
          </div>
        </div>
      </div>
    </article>
  );
}
