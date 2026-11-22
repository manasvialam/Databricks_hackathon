"use client";
import { useMemo, useState } from "react";
import { BadgeCheck, ChevronRight, Clock, Hand, Navigation, Phone } from "lucide-react";
import type { NearbyHospital } from "@/lib/nearby";
import { t, type Lang } from "@/lib/i18n";
import { specLabel } from "@/lib/specialty";
import { MiniMap, placeLine, RegistryBadge } from "./Slip";
import { useRoute } from "./RouteMap";
import { TrafficStrip } from "./Traffic";
import { Name } from "./Name";
import { cleanNeed } from "@/lib/need";
import { Tx } from "./Tx";
import { RideButtons } from "./RideButtons";

const MAX_TAGS = 2;

/** Hospitals first, nearest first. Services are tags on each hospital and chips filter the list; nothing is grouped by service. */
export function HospitalList({ hospitals, lang, onOpen }: { hospitals: NearbyHospital[]; lang: Lang; onOpen: (h: NearbyHospital) => void }) {
  const [filter, setFilter] = useState<string | null>(null);
  const chips = useMemo(() => {
    const n = new Map<string, number>();
    for (const h of hospitals) for (const s of h.specialties) if (s !== "general") n.set(s, (n.get(s) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id);
  }, [hospitals]);
  const shown = filter ? hospitals.filter((h) => h.specialties.includes(filter)) : hospitals;
  return (
    <>
      {chips.length > 0 && (
        <div className="chip-scroll" role="group" aria-label={t(lang, "nearYou")}>
          <button type="button" className="fchip tap" aria-pressed={filter === null} onClick={() => setFilter(null)}>{t(lang, "filterAll")}</button>
          {chips.map((id) => <button key={id} type="button" className="fchip tap" aria-pressed={filter === id} onClick={() => setFilter(filter === id ? null : id)}>{specLabel(id, lang)}</button>)}
        </div>
      )}
      <div className="list">
        {shown.map((h) => {
          const tags = h.specialties.slice(0, MAX_TAGS), more = h.specialties.length - tags.length;
          return (
            <button key={h.id} type="button" className="hrow" onClick={() => onOpen(h)}>
              <span className="hrow-top">
                <span className="row-title"><Name text={h.name} lang={lang} />{h.registry === "verified" && <BadgeCheck size={15} aria-label={t(lang, "registryListed")} />}</span>
                <span className="row-meta">{h.roadKm ?? h.km} {t(lang, "km")}</span>
                <ChevronRight size={16} className="chev" aria-hidden />
              </span>
              <span className="row-sub"><Name text={placeLine(h)} lang={lang} /></span>
              <span className="tags">
                {tags.map((id) => <span key={id} className="tag" data-hit={h.matched.includes(id)}>{specLabel(id, lang)}</span>)}
                {more > 0 && <span className="tag tag-more">{t(lang, "moreTags", { n: more })}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Rough travel time for a straight-line distance, used only until the road route arrives or when routing is unavailable. */
export const estMinutes = (km: number) => Math.max(3, Math.round((km * 1.4) / 0.4));

/**
 * The full card for a hospital opened from the nearby list or after a need that maps to no service (leg pain, fever). Same parts as the
 * recommendation card minus the per-service confidence, which does not exist here. When the person described a problem (`guidance`),
 * "Why this hospital" and "Show at the door" (what to say, what to bring) are offered; a plain browse shows facts only.
 */
export function HospitalCard({ h, lang, need, guidance, origin, onWhy, onDoor, onDirections }: { h: NearbyHospital; lang: Lang; need: string | null; guidance: boolean; origin: { lat: number; lon: number } | null; onWhy: () => void; onDoor: () => void; onDirections: () => void }) {
  const route = useRoute(origin, h);
  // what to say at the desk: the model's short summary of the problem, without "I'm having" or a closing full stop, so the sentence reads on its own
  const shortNeed = cleanNeed(need);
  // how well this hospital fits what was described: the model's score where there is one, otherwise whether its listed specialties matched
  const level: "high" | "mid" | "low" = h.fit != null ? (h.fit >= 0.7 ? "high" : h.fit >= 0.4 ? "mid" : "low") : h.matched.length ? "mid" : "low";
  const on = level === "high" ? 3 : level === "mid" ? 2 : 1;
  const SURE = { high: "sureHigh", mid: "sureMid", low: "sureLow" } as const;
  const tags = h.specialties.slice(0, 6), more = h.specialties.length - tags.length;
  const warning = h.warnings[0];
  const km = route?.available ? route.km : h.roadKm ?? h.km, min = route?.available ? route.minutes : h.minutes ?? estMinutes(h.km);
  return (
    <article className="card" aria-labelledby={`n-${h.id}`}>
      <div className="tags">
        <RegistryBadge registry={h.registry ? { tier: h.registry, nabh: h.nabh, empanelledOn: h.empanelledOn } : null} lang={lang} />
        {h.ownership === "government" && <span className="tag">{t(lang, "gov")}</span>}
        {h.ownership === "private" && <span className="tag">{t(lang, "priv")}</span>}
        {h.open24h && <span className="tag"><Clock size={13} aria-hidden />{t(lang, "open24")}</span>}
      </div>

      <h2 className="slip-name" id={`n-${h.id}`} data-read><Name text={h.name} lang={lang} /></h2>
      <p className="slip-sub"><Name text={placeLine(h)} lang={lang} /></p>

      <div className="stats" data-read data-read-text={`${min} ${t(lang, "min")}, ${km} ${t(lang, "km")}`}>
        <div className="stat-num">{min}<sup>{t(lang, "min")}</sup></div>
        <div className="stat-num">{km}<sup>{t(lang, "km")}</sup></div>
      </div>
      {route?.available && route.traffic
        ? <TrafficStrip traffic={route.traffic} extraMin={Math.max(0, (route.minutes ?? 0) - (route.freeMinutes ?? 0))} lang={lang} />
        : <p className="eta-note">{h.roadKm != null ? t(lang, "byRoadNote") : t(lang, "trafficEst")}</p>}
      {origin && <MiniMap origin={origin} dest={h} name={h.name} route={route} lang={lang} onOpen={onDirections} />}

      <div className="block" style={{ marginTop: 16 }}>
        <h3 className="block-h">{t(lang, "specialisesIn")}</h3>
        {h.specialties.length
          ? <div className="tags">{tags.map((id) => <span key={id} className="tag" data-hit={h.matched.includes(id)}>{specLabel(id, lang)}</span>)}{more > 0 && <span className="tag tag-more">{t(lang, "moreTags", { n: more })}</span>}</div>
          : <p className="small">{t(lang, "noServicesYet")}</p>}
      </div>
      {guidance && (
        <div className="sure" data-level={level}>
          <span className="meter" aria-hidden>{[1, 2, 3].map((i) => <i key={i} data-on={i <= on} />)}</span>
          <span className="sure-t"><small>{t(lang, "howSure")}</small><b>{t(lang, SURE[level])}</b></span>
        </div>
      )}
      {warning && <p className="callout"><Tx m={warning} lang={lang} /></p>}

      <div className="btn-row actions">
        {h.phone
          ? <a className="btn btn-primary tap" href={`tel:${h.phone.replace(/[^\d+]/g, "")}`}><Phone size={18} aria-hidden />{t(lang, "call")}</a>
          : <span className="btn" aria-disabled="true"><Phone size={18} aria-hidden />{t(lang, "call")}</span>}
        <button type="button" className="btn btn-soft tap" onClick={onDirections}><Navigation size={18} aria-hidden />{t(lang, "directions")}</button>
      </div>
      <RideButtons origin={origin} dest={{ lat: h.lat, lon: h.lon, name: h.name }} lang={lang} />
      {!h.phone && <p className="tiny" style={{ marginTop: 8, textAlign: "center" }}>{t(lang, "noPhone")}</p>}

      {guidance && (
        <>
          <button type="button" className="door-card tap" onClick={onDoor}>
            <span className="door-ico"><Hand size={22} strokeWidth={2} aria-hidden /></span>
            <span className="door-t">{t(lang, "showAtDoor")}<small>{shortNeed ? t(lang, "sayNeedLine", { need: shortNeed }) : t(lang, "sayLine", { service: "a doctor" })}</small></span>
            <ChevronRight size={20} aria-hidden />
          </button>
          <div className="more">
            <button type="button" className="more-row" onClick={onWhy}>{t(lang, "whyThis")}<ChevronRight size={18} aria-hidden /></button>
          </div>
        </>
      )}
    </article>
  );
}
