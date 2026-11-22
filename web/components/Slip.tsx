"use client";
import { AlertTriangle, Clock, ExternalLink, Navigation, Phone, ShieldCheck, Volume2 } from "lucide-react";
import type { ResultDto } from "@/lib/recommend";
import { fieldLabel, levelLabel, say, svcLabel, t, typeLabel, type Lang } from "@/lib/i18n";

export { svcLabel };

export function sureLevel(r: ResultDto): "high" | "mid" | "low" {
  if (!r.solid) return "low";
  return r.pService >= 0.75 ? "high" : r.pService >= 0.55 ? "mid" : "low";
}
const SURE_KEY = { high: "sureHigh", mid: "sureMid", low: "sureLow" } as const;

/** The signature: free-flow minutes solid, traffic delay hatched yellow, the likely range bracketed. */
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
        <span><i style={{ background: "var(--board)" }} />{r.liveTraffic ? t(lang, "trafficLive") : t(lang, "trafficEst")}</span>
        {delay >= 1 && <span><i style={{ background: "repeating-linear-gradient(135deg,#ffc20e 0 3px,#1c1500 3px 4px)" }} />+{Math.round(delay)} {t(lang, "min")}</span>}
        <span>{r.etaLow}-{r.etaHigh} {t(lang, "min")}</span>
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
      {r.tags.filter((x) => TAG_KEY[x]).map((x) => <span key={x} className="chip chip-tag">{t(lang, TAG_KEY[x])}</span>)}
      {r.registry?.tier === "verified" && <span className="chip chip-reg"><ShieldCheck size={16} aria-hidden />{t(lang, "registryListed")}</span>}
      {r.registry?.tier === "possible" && <span className="chip chip-warn"><AlertTriangle size={16} aria-hidden />{t(lang, "registryPossible")}</span>}
      {r.registry?.nabh && <span className="chip chip-reg">{t(lang, "nabh")}</span>}
      {r.ownership === "government" && <span className="chip">{t(lang, "gov")}</span>}
      {r.ownership === "private" && <span className="chip">{t(lang, "priv")}</span>}
      {r.open24h && <span className="chip"><Clock size={16} aria-hidden />{t(lang, "open24")}</span>}
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
  return (
    <article className="panel" aria-labelledby={`n-${r.id}`}>
      <Chips r={r} lang={lang} />
      <h2 className="slip-name" id={`n-${r.id}`} lang="en">{r.name}</h2>
      <p className="slip-sub">{r.type && <>{typeLabel(r.type, lang)}{where && " · "}</>}<span lang="en">{where}</span></p>

      <div className="nums">
        <span className="num">{r.distanceKm}<small>{t(lang, "km")}</small></span>
        <span className="num">{r.etaMinutes}<small>{t(lang, "min")}</small></span>
      </div>
      <RoadBar r={r} scale={scale} lang={lang} />

      <div className="sure">
        <span className="meter" data-level={level} aria-hidden>{[0, 1, 2].map((i) => <i key={i} data-on={i <= (level === "high" ? 2 : level === "mid" ? 1 : 0)} />)}</span>
        <b>{t(lang, "howSure")}: {t(lang, SURE_KEY[level])}</b>
      </div>
      {!r.solid && <p className="caution"><AlertTriangle size={20} aria-hidden /><span>{t(lang, "weakNote")}</span></p>}

      <div className="actions">
        {phone
          ? <a className="btn btn-primary" href={`tel:${phone.replace(/[^\d+]/g, "")}`}><Phone size={20} aria-hidden />{t(lang, "call")}</a>
          : <span className="btn" aria-disabled="true"><Phone size={20} aria-hidden />{t(lang, "call")}</span>}
        <a className="btn" href={dirUrl} target="_blank" rel="noopener noreferrer"><Navigation size={20} aria-hidden />{t(lang, "directions")}</a>
        {!phone && <p className="small wide" style={{ gridColumn: "1 / -1" }}>{t(lang, "noPhone")}</p>}
      </div>

      {(quote || (ev?.notes.length ?? 0) > 0) && (
        <div className="section">
          <h3>{t(lang, "evidenceFrom")}: {svcLabel(ev.service, lang)}</h3>
          {/* the quote is the facility's own text, cited verbatim, so it stays in the language it was written in */}
          {quote
            ? <blockquote className="quote" lang="en">“{quote.text.length > 300 ? quote.text.slice(0, 297) + "…" : quote.text}”</blockquote>
            : <blockquote className="quote" lang="en">{ev.notes.slice(0, 2).join(" ")}</blockquote>}
          <p className="src">
            {levelLabel(ev.level, lang)}{quote ? ` · ${fieldLabel(quote.field, lang)}` : ""}
            {src && <> · {t(lang, "source")}: <a className="muted-link src-link" href={src.url} target="_blank" rel="noopener noreferrer" lang="en">{host(src.url)}<ExternalLink size={13} style={{ marginLeft: 3, verticalAlign: -1 }} aria-hidden /></a>{!src.namesFacility && ` (${t(lang, "srcNotNamed")})`}</>}
          </p>
        </div>
      )}

      {r.warnings.map((w) => <p key={w.text} className="caution"><AlertTriangle size={20} aria-hidden /><span>{say(w, lang)}</span></p>)}

      <div className="section">
        <h3>{t(lang, "showAtDoor")}</h3>
        <div className="door">
          <div className="door-row"><span className="door-k">{t(lang, "say")}</span><span>{t(lang, "sayLine", { service: svc })}</span></div>
          <div className="door-row"><span className="door-k">{t(lang, "ask")}</span><span>{t(lang, "askLine", { service: svc })}</span></div>
          <div className="door-row"><span className="door-k">{t(lang, "carry")}</span><ul>{t(lang, "carryItems").split("|").map((x) => <li key={x}>{x}</li>)}</ul></div>
        </div>
      </div>

      <div className="actions" style={{ marginTop: 20 }}>
        <button type="button" className="btn" onClick={onWhy}>{t(lang, "why")}</button>
        <button type="button" className="btn" onClick={onSpeak}><Volume2 size={20} aria-hidden />{t(lang, "readAloud")}</button>
      </div>
    </article>
  );
}
