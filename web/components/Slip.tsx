"use client";
import { Name } from "./Name";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, BadgeCheck, ChevronRight, Clock, Hand, Navigation, Phone, ShieldQuestion } from "lucide-react";
import type { ResultDto } from "@/lib/recommend";
import { svcLabel, t, type Lang } from "@/lib/i18n";
import { specLabel } from "@/lib/specialty";
import { Tx } from "./Tx";
import { lcFirst } from "@/lib/need";
import { RouteMap, useRoute } from "./RouteMap";
import { TrafficStrip } from "./Traffic";

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

const PICK_KEY: Record<string, "fastest" | "mostTrusted" | "bestValue" | "mostComfortable" | "closest"> = {
  fastest: "fastest", most_trusted: "mostTrusted", best_value: "bestValue", most_comfortable: "mostComfortable", closest: "closest",
};

/** The small route map inside a card: tap it to open the full map. */
export function MiniMap({ origin, dest, name, route, lang, onOpen }: { origin: { lat: number; lon: number }; dest: { lat: number; lon: number }; name: string; route: ReturnType<typeof useRoute>; lang: Lang; onOpen: () => void }) {
  return (
    <div className="mini" role="button" tabIndex={0} aria-label={t(lang, "openMap")} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}>
      <RouteMap origin={origin} dest={dest} route={route} interactive={false} label={name} />
      <span className="glass mini-open">{t(lang, "openMap")}</span>
    </div>
  );
}

export function Slip({ r, lang, services, origin, onWhy, onDirections, onDoor }: {
  r: ResultDto; lang: Lang; services: { id: string }[]; origin: { lat: number; lon: number } | null; onWhy: () => void; onDirections: () => void; onDoor: () => void;
}) {
  const route = useRoute(origin, r);
  const level = sureLevel(r);
  const svc = svcLabel(services[0]?.id ?? "", lang);
  const phone = r.phones[0];
  const on = level === "high" ? 3 : level === "mid" ? 2 : 1;
  const where = placeLine(r);
  const ev = r.evidence.find((e) => e.snippets.length);
  const quote = ev?.snippets[0]?.text, src = ev?.sources[0]?.url;
  const domain = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const warning = r.warnings[0];
  const km = route?.available ? route.km : r.distanceKm, min = route?.available ? route.minutes : r.etaMinutes;
  const picks = r.tags.filter((x) => PICK_KEY[x]);
  return (
    <article className="card" aria-labelledby={`n-${r.id}`}>
      <div className="tags">
        {picks.map((x) => <span key={x} className="tag tag-pick">{t(lang, PICK_KEY[x])}</span>)}
        <RegistryBadge registry={r.registry} lang={lang} />
        {r.ownership === "government" && <span className="tag">{t(lang, "gov")}</span>}
        {r.ownership === "private" && <span className="tag">{t(lang, "priv")}</span>}
        {r.open24h && <span className="tag"><Clock size={13} aria-hidden />{t(lang, "open24")}</span>}
      </div>

      <h2 className="slip-name" id={`n-${r.id}`} data-read><Name text={r.name} lang={lang} /></h2>
      {where && <p className="slip-sub"><Name text={where} lang={lang} /></p>}

      <div className="stats">
        <div className="stat-num">{min}<sup>{t(lang, "min")}</sup></div>
        <div className="stat-num">{km}<sup>{t(lang, "km")}</sup></div>
      </div>
      {route?.available && route.traffic
        ? <TrafficStrip traffic={route.traffic} extraMin={Math.max(0, (route.minutes ?? 0) - (route.freeMinutes ?? 0))} lang={lang} />
        : <p className="eta-note">{t(lang, "etaRange", { low: r.etaLow, high: r.etaHigh })}</p>}
      {origin && <MiniMap origin={origin} dest={r} name={r.name} route={route} lang={lang} onOpen={onDirections} />}

      {r.specialties.length > 0 && (
        <div className="block" style={{ marginTop: 16 }}>
          <h3 className="block-h">{t(lang, "specialisesIn")}</h3>
          <div className="tags">{r.specialties.slice(0, 4).map((id) => <span key={id} className="tag">{specLabel(id, lang)}</span>)}</div>
        </div>
      )}

      {quote && <p className="quote-line" lang="en">“{quote.length > 110 ? quote.slice(0, 107) + "…" : quote}”{src && <small> {domain(src)}</small>}</p>}

      <div className="sure" data-level={level}>
        <span className="meter" aria-hidden>{[1, 2, 3].map((i) => <i key={i} data-on={i <= on} />)}</span>
        <span className="sure-t"><small>{t(lang, "howSure")}</small><b>{t(lang, SURE_KEY[level])}</b></span>
      </div>
      {!r.solid && <p className="callout"><AlertTriangle size={17} aria-hidden /><span>{t(lang, "weakNote")}</span></p>}
      {r.solid && warning && <p className="callout"><AlertTriangle size={17} aria-hidden /><span><Tx m={warning} lang={lang} /></span></p>}

      <div className="btn-row actions">
        {phone
          ? <a className="btn btn-primary tap" href={`tel:${phone.replace(/[^\d+]/g, "")}`}><Phone size={18} aria-hidden />{t(lang, "call")}</a>
          : <span className="btn" aria-disabled="true"><Phone size={18} aria-hidden />{t(lang, "call")}</span>}
        <button type="button" className="btn btn-soft tap" onClick={onDirections}><Navigation size={18} aria-hidden />{t(lang, "directions")}</button>
      </div>
      {!phone && <p className="tiny" style={{ marginTop: 8, textAlign: "center" }}>{t(lang, "noPhone")}</p>}

      <button type="button" className="door-card tap" onClick={onDoor}>
        <span className="door-ico"><Hand size={22} strokeWidth={2} aria-hidden /></span>
        <span className="door-t">{t(lang, "showAtDoor")}<small>{t(lang, "sayLine", { service: lang === "en" ? lcFirst(svc) : svc })}</small></span>
        <ChevronRight size={20} aria-hidden />
      </button>

      <div className="more">
        <button type="button" className="more-row" onClick={onWhy}>{t(lang, "whyThis")}<ChevronRight size={18} aria-hidden /></button>
      </div>
    </article>
  );
}
