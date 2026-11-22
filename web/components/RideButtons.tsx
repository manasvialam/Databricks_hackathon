"use client";
import { useEffect, useState } from "react";
import { Car } from "lucide-react";
import { t, type Lang } from "@/lib/i18n";
import { isMobileUA, olaLink, uberLink, type Point, type RideDest } from "@/lib/rides";

/**
 * Two buttons below Directions that open Ola or Uber with the hospital filled in as the drop. Each is a real link, so on a desktop it opens
 * the website and it is never a dead button. Brand colours and the plain name only: no logos. Availability is not checked: both apps run
 * only in some cities, and the note says so.
 */
export function RideButtons({ origin, dest, lang }: { origin: Point | null; dest: RideDest; lang: Lang }) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => { setMobile(isMobileUA(navigator.userAgent)); }, []);
  const ola = olaLink(origin, dest, { mobile, xapp: process.env.NEXT_PUBLIC_OLA_XAPP });
  return (
    <>
      <div className="btn-row ride-row">
        <a className="btn tap btn-ola" href={ola} target="_blank" rel="noopener noreferrer" aria-label={t(lang, "rideOlaLabel")}><Car size={18} aria-hidden />{t(lang, "rideOla")}</a>
        <a className="btn tap btn-uber" href={uberLink(origin, dest)} target="_blank" rel="noopener noreferrer" aria-label={t(lang, "rideUberLabel")}><Car size={18} aria-hidden />{t(lang, "rideUber")}</a>
      </div>
      <p className="tiny ride-note">{t(lang, "rideNote")}</p>
    </>
  );
}
