"use client";
import { AlertTriangle, ArrowUpRight, Clock, ExternalLink, HelpCircle, MessageCircle, Navigation, Phone, ShieldCheck, Volume2, Briefcase } from "lucide-react";
import type { ResultDto } from "@/lib/recommend";
import { fieldLabel, levelLabel, say, svcLabel, t, typeLabel, type Lang } from "@/lib/i18n";

export { svcLabel };

export function sureLevel(r: ResultDto): "high" | "mid" | "low" {
  if (!r.solid) return "low";
  return r.pService >= 0.75 ? "high" : r.pService >= 0.55 ? "mid" : "low";
}
const SURE_KEY = { high: "sureHigh", mid: "sureMid", low: "sureLow" } as const;

/** Travel time: free-flow minutes solid graphite, traffic delay amber, the likely range as a soft band. */
export function RoadBar({ r, scale, lang }: { r: ResultDto; scale: number; lang: Lang }) {
  const free = r.congestion > 1 ? r.etaMinutes / r.congestion : r.etaMinutes;
  const pct = (m: number) => `${Math.min(100, (m / scale) * 100)}%`;
  const delay = Math.max(0, r.etaMinutes - free);
  const label = `${r.etaMinutes} ${t(lang, "min")} (${r.etaLow}-${r.etaHigh})`;
  return (
    <div role="img" aria-label={label}>
      <div className="road">
        <div className="road-free" style={{ width: pct(free) }} />
        {delay >= 1 && <div className="road-delay" style={{ left: pct(free), width: `calc(${pct(r.etaMinutes)} - ${pct(free)})` }} />}
        <div className="road-range" style={{ left: pct(r.etaLow), width: `calc(${pct(r.etaHigh)} - ${pct(r.etaLow)})` }} />
      </div>
      <div className="road-legend">
        <span><i style={{ background: "var(--accent)" }} />{r.liveTraffic ? t(lang, "trafficLive") : t(lang, "trafficEst")}</span>
        {delay >= 1 && <span><i style={{ background: "#f2a93b" }} />+{Math.round(delay)} {t(lang, "min")}</span>}
      </div>
    </div>
  );
}

const TAG_KEY: Record<string, "fastest" | "mostTrusted" | "bestValue" | "mostComfortable" | "closest"> = {
  fastest: "fastest", most_trusted: "mostTrusted", best_value: "bestValue", most_comfortable: "mostComfortable", closest: "closest",
};

export function Chips({ r, lang }: { r: ResultDto; lang: Lang }) {
  return (
    <div className="chips">
      {r.tags.filter((x) => TAG_KEY[x]).map((x) => <span key={x} className="chip chip-accent">{t(lang, TAG_KEY[x])}</span>)}
      {r.registry?.tier === "verified" && <span className="chip chip-info"><ShieldCheck size={14} aria-hidden />{t(lang, "registryListed")}</span>}
      {r.registry?.tier === "possible" && <span className="chip chip-warn"><AlertTriangle size={14} aria-hidden />{t(lang, "registryPossible")}</span>}
      {r.registry?.nabh && <span className="chip chip-info">{t(lang, "nabh")}</span>}
      {r.ownership === "government" && <span className="chip">{t(lang, "gov")}</span>}
      {r.ownership === "private" && <span className="chip">{t(lang, "priv")}</span>}
      {r.open24h && <span className="chip"><Clock size={14} aria-hidden />{t(lang, "open24")}</span>}
    </div>
  );
}

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

export function Slip({ r, scale, lang, services, onWhy, onSpeak }: {
  r: ResultDto; scale: number; lang: Lang; services: { id: string }[]; onWhy: () => void; onSpeak: () => void;
}) {
  const level = sureLevel(r);
  const ev = r.evidence.find((e) => e.snippets.length) ?? r.evidence[0];
  const quote = ev?.snippets[0];
  const src = ev?.sources[0];
  const svc = svcLabel(services[0]?.id ?? "", lang);
  const where = [r.city ?? r.district, r.state].filter(Boolean).join(" · ");     // place names exist only in English
  const phone = r.phones[0];
  const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lon}`;
  const on = level === "high" ? 3 : level === "mid" ? 2 : 1;
  return (
    <article className="card" aria-labelledby={`n-${r.id}`}>
      <Chips r={r} lang={lang} />
      <p className="slip-kicker">{t(lang, "bestFor", { service: svc })}</p>
      <h2 className="slip-name" id={`n-${r.id}`} lang="en">{r.name}</h2>
      {(r.type || where) && <p className="slip-sub">{r.type && <>{typeLabel(r.type, lang)}{where && " · "}</>}<span lang="en">{where}</span></p>}

      <div className="stats">
        <div className="stat"><div className="stat-num">{r.etaMinutes}<sup>{t(lang, "min")}</sup></div></div>
        <div className="stat"><div className="stat-num">{r.distanceKm}<sup>{t(lang, "km")}</sup></div></div>
      </div>
      <RoadBar r={r} scale={scale} lang={lang} />

      <div className="tiles-2">
        <div className="mini">
          <div className="mini-k">{t(lang, "howSure")}</div>
          <div className="mini-v">{t(lang, SURE_KEY[level])}</div>
          <div className="meter" data-level={level} aria-hidden>{[1, 2, 3].map((i) => <i key={i} data-on={i <= on} />)}</div>
        </div>
        <div className="mini">
          <div className="mini-k">{t(lang, "likelyRange")}</div>
          <div className="mini-v">{r.etaLow}–{r.etaHigh} <span className="small">{t(lang, "min")}</span></div>
        </div>
      </div>
      {!r.solid && <p className="callout"><AlertTriangle size={18} aria-hidden /><span>{t(lang, "weakNote")}</span></p>}

      <div className="btn-row actions">
        {phone
          ? <a className="btn btn-dark tap" href={`tel:${phone.replace(/[^\d+]/g, "")}`}><Phone size={18} aria-hidden />{t(lang, "call")}</a>
          : <span className="btn" aria-disabled="true"><Phone size={18} aria-hidden />{t(lang, "call")}</span>}
        <a className="btn tap" href={dirUrl} target="_blank" rel="noopener noreferrer"><Navigation size={18} aria-hidden />{t(lang, "directions")}<ArrowUpRight size={16} className="arrow" aria-hidden /></a>
        {!phone && <p className="small wide">{t(lang, "noPhone")}</p>}
      </div>

      {(quote || (ev?.notes.length ?? 0) > 0) && (
        <div className="block">
          <h3 className="block-h">{t(lang, "evidenceFrom")} · {svcLabel(ev.service, lang)}</h3>
          {/* the quote is the facility's own text, cited verbatim, so it stays in the language it was written in */}
          {quote
            ? <blockquote className="quote" lang="en">“{quote.text.length > 300 ? quote.text.slice(0, 297) + "…" : quote.text}”</blockquote>
            : <blockquote className="quote" lang="en">{ev.notes.slice(0, 2).join(" ")}</blockquote>}
          <p className="src">
            <span>{levelLabel(ev.level, lang)}{quote ? ` · ${fieldLabel(quote.field, lang)}` : ""}</span>
            {src && <>
              <span aria-hidden>·</span>
              <a href={src.url} target="_blank" rel="noopener noreferrer">{t(lang, "source")}: <span lang="en">{host(src.url)}</span><ExternalLink size={12} aria-hidden /></a>
              {!src.namesFacility && <span>({t(lang, "srcNotNamed")})</span>}
            </>}
          </p>
        </div>
      )}

      {r.warnings.map((w) => <p key={w.text} className="callout"><AlertTriangle size={18} aria-hidden /><span>{say(w, lang)}</span></p>)}

      <div className="block">
        <h3 className="block-h">{t(lang, "showAtDoor")}</h3>
        <div className="timeline">
          <div className="tl-item"><span className="tl-dot"><MessageCircle size={12} aria-hidden /></span><div className="tl-k">{t(lang, "say")}</div><div className="tl-v">{t(lang, "sayLine", { service: svc })}</div></div>
          <div className="tl-item"><span className="tl-dot"><HelpCircle size={12} aria-hidden /></span><div className="tl-k">{t(lang, "ask")}</div><div className="tl-v">{t(lang, "askLine", { service: svc })}</div></div>
          <div className="tl-item"><span className="tl-dot"><Briefcase size={12} aria-hidden /></span><div className="tl-k">{t(lang, "carry")}</div><div className="tl-v"><ul>{t(lang, "carryItems").split("|").map((x) => <li key={x}>{x}</li>)}</ul></div></div>
        </div>
      </div>

      <div className="btn-row actions">
        <button type="button" className="btn tap" onClick={onWhy}>{t(lang, "why")}</button>
        <button type="button" className="btn tap" onClick={onSpeak}><Volume2 size={18} aria-hidden />{t(lang, "readAloud")}</button>
      </div>
    </article>
  );
}
