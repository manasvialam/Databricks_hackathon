"use client";
import { useMemo, useState } from "react";
import { BadgeCheck, ChevronRight, Clock, FileText, Navigation, Phone, PhoneCall, Volume2 } from "lucide-react";
import type { NearbyHospital } from "@/lib/nearby";
import { svcLabel, t, type Lang } from "@/lib/i18n";
import { placeLine, RegistryBadge } from "./Slip";
import { Tx } from "./Tx";

const MAX_TAGS = 2;

/** Hospitals first, nearest first. Services are tags on each hospital and chips filter the list; nothing is grouped by service. */
export function HospitalList({ hospitals, lang, onOpen }: { hospitals: NearbyHospital[]; lang: Lang; onOpen: (h: NearbyHospital) => void }) {
  const [filter, setFilter] = useState<string | null>(null);
  const chips = useMemo(() => {
    const n = new Map<string, number>();
    for (const h of hospitals) for (const s of h.services) n.set(s, (n.get(s) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id);
  }, [hospitals]);
  const shown = filter ? hospitals.filter((h) => h.services.includes(filter as never)) : hospitals;
  return (
    <>
      {chips.length > 0 && (
        <div className="chip-scroll" role="group" aria-label={t(lang, "nearYou")}>
          <button type="button" className="fchip tap" aria-pressed={filter === null} onClick={() => setFilter(null)}>{t(lang, "filterAll")}</button>
          {chips.map((id) => <button key={id} type="button" className="fchip tap" aria-pressed={filter === id} onClick={() => setFilter(filter === id ? null : id)}>{svcLabel(id, lang)}</button>)}
        </div>
      )}
      <div className="list">
        {shown.map((h) => {
          const tags = h.services.slice(0, MAX_TAGS), more = h.services.length - tags.length;
          return (
            <button key={h.id} type="button" className="hrow" onClick={() => onOpen(h)}>
              <span className="hrow-top">
                <span className="row-title"><span lang="en">{h.name}</span>{h.registry === "verified" && <BadgeCheck size={15} aria-label={t(lang, "registryListed")} />}</span>
                <span className="row-meta">{h.km} {t(lang, "km")}</span>
                <ChevronRight size={16} className="chev" aria-hidden />
              </span>
              <span className="row-sub" lang="en">{placeLine(h)}</span>
              <span className="tags">
                {tags.map((id) => <span key={id} className="tag">{svcLabel(id, lang)}</span>)}
                {more > 0 && <span className="tag tag-more">{t(lang, "moreTags", { n: more })}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Rough travel time for a straight-line distance, the same 36 km/h plus 40% detour assumption the ranking uses when there is no live traffic. */
export const estMinutes = (km: number) => Math.max(3, Math.round((km * 1.4) / 0.6));

/**
 * The full card for a hospital when the need could not be matched to one service (leg pain, fever): same parts as the
 * recommendation card, minus the per-service confidence, which does not exist here. Services are tags, "Why this
 * hospital" says honestly that the list is nearest first, and "Before you go" tells the person what to ask.
 */
export function HospitalCard({ h, lang, need, onWhy, onSpeak }: { h: NearbyHospital; lang: Lang; need: string | null; onWhy: () => void; onSpeak: () => void }) {
  const [prep, setPrep] = useState(false);
  const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lon}`;
  const shortNeed = need ? (need.length > 60 ? need.slice(0, 57) + "…" : need) : null;
  const tags = h.services.slice(0, 6), more = h.services.length - tags.length;
  const warning = h.warnings[0];
  return (
    <article className="card" aria-labelledby={`n-${h.id}`}>
      <div className="slip-top">
        <div className="tags">
          <RegistryBadge registry={h.registry ? { tier: h.registry, nabh: h.nabh, empanelledOn: h.empanelledOn } : null} lang={lang} />
          {h.open24h && <span className="tag"><Clock size={13} aria-hidden />{t(lang, "open24")}</span>}
        </div>
        <button type="button" className="speak tap" onClick={onSpeak} aria-label={t(lang, "readAloud")}><Volume2 size={17} aria-hidden /></button>
      </div>

      <h2 className="slip-name" id={`n-${h.id}`} lang="en" data-read>{h.name}</h2>
      <p className="slip-sub" lang="en">{placeLine(h)}</p>

      <div className="stats" data-read data-read-text={`${estMinutes(h.km)} ${t(lang, "min")}, ${h.km} ${t(lang, "km")}`}>
        <div className="stat-num">{estMinutes(h.km)}<sup>{t(lang, "min")}</sup></div>
        <div className="stat-num">{h.km}<sup>{t(lang, "km")}</sup></div>
      </div>
      <p className="eta-note">{t(lang, "trafficEst")}</p>

      <div className="block" style={{ marginTop: 16 }}>
        <h3 className="block-h">{t(lang, "servicesFound")}</h3>
        {h.services.length
          ? <div className="tags">{tags.map((id) => <span key={id} className="tag">{svcLabel(id, lang)}</span>)}{more > 0 && <span className="tag tag-more">{t(lang, "moreTags", { n: more })}</span>}</div>
          : <p className="small">{t(lang, "noServicesYet")}</p>}
      </div>
      {warning && <p className="callout"><Tx m={warning} lang={lang} /></p>}

      <div className="btn-row actions">
        {h.phone
          ? <a className="btn btn-primary tap" href={`tel:${h.phone.replace(/[^\d+]/g, "")}`}><Phone size={18} aria-hidden />{t(lang, "call")}</a>
          : <span className="btn" aria-disabled="true"><Phone size={18} aria-hidden />{t(lang, "call")}</span>}
        <a className="btn btn-soft tap" href={dirUrl} target="_blank" rel="noopener noreferrer"><Navigation size={18} aria-hidden />{t(lang, "directions")}</a>
      </div>
      {!h.phone && <p className="tiny" style={{ marginTop: 8, textAlign: "center" }}>{t(lang, "noPhone")}</p>}

      <div className="more">
        <button type="button" className="more-row" onClick={onWhy}>{t(lang, "whyThis")}<ChevronRight size={18} aria-hidden /></button>
        <button type="button" className="more-row" aria-expanded={prep} aria-controls={`prep-${h.id}`} onClick={() => setPrep((p) => !p)}>
          {t(lang, "beforeYouGo")}<ChevronRight size={18} aria-hidden />
        </button>
        <div className="more-body" id={`prep-${h.id}`} data-open={prep}>
          <div>
            <ul>
              <li><PhoneCall size={16} aria-hidden /><span>{shortNeed ? t(lang, "callFirstGeneral", { need: shortNeed }) : t(lang, "callFirstAny")}</span></li>
              <li><FileText size={16} aria-hidden /><span>{t(lang, "bringLine")}</span></li>
            </ul>
          </div>
        </div>
      </div>
    </article>
  );
}
