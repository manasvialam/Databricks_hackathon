"use client";
import { useEffect, useState } from "react";
import { Navigation } from "lucide-react";
import { t, type Lang } from "@/lib/i18n";
import { isMobileUA, olaLink, uberLink, type Point, type RideDest } from "@/lib/rides";
import { OlaLogo, UberLogo } from "./RideLogos";

/**
 * One row of rounded buttons below Call: Directions (when `onDirections` is given), Ola and Uber, the last two carrying the services' own
 * marks. Each ride button is a real link, so on a desktop it opens the website and is never dead. Availability is not checked: both
 * apps run only in some cities, and the note says so.
 */
export function RideButtons({ origin, dest, lang, onDirections }: { origin: Point | null; dest: RideDest; lang: Lang; onDirections?: () => void }) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => { setMobile(isMobileUA(navigator.userAgent)); }, []);
  const ola = olaLink(origin, dest, { mobile, xapp: process.env.NEXT_PUBLIC_OLA_XAPP });
  return (
    <>
      <div className="ride-row" data-n={onDirections ? 3 : 2}>
        {onDirections && <button type="button" className="pill tap" onClick={onDirections}><Navigation size={18} aria-hidden /><span>{t(lang, "directions")}</span></button>}
        <a className="pill pill-ride tap" href={ola} target="_blank" rel="noopener noreferrer" aria-label={t(lang, "rideOlaLabel")}><OlaLogo height={26} /></a>
        <a className="pill pill-ride tap" href={uberLink(origin, dest)} target="_blank" rel="noopener noreferrer" aria-label={t(lang, "rideUberLabel")}><UberLogo height={22} /></a>
      </div>
      <p className="tiny ride-note">{t(lang, "rideNote")}</p>
    </>
  );
}
