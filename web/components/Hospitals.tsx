"use client";
import { useMemo, useState } from "react";
import { BadgeCheck, ChevronRight } from "lucide-react";
import type { NearbyHospital } from "@/lib/nearby";
import { svcLabel, t, type Lang } from "@/lib/i18n";
import { placeLine } from "./Slip";

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
