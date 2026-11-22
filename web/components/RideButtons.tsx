"use client";
import { useEffect, useState } from "react";
import { Car } from "lucide-react";
import { t, type Lang } from "@/lib/i18n";
import { isMobileUA, olaLink, rapidoDropText, rapidoLink, type Point, type RideDest } from "@/lib/rides";

/**
 * Two buttons below Directions that open Ola or Rapido with the hospital as the drop. Each is a real link, so it works on a desktop
 * (opens the website) and is never a dead button. Rapido's drop cannot be pre-filled (no public spec), so the name is copied for pasting.
 * Availability is not checked: both apps run only in some cities, and the note says so.
 */
export function RideButtons({ origin, dest, lang }: { origin: Point | null; dest: RideDest; lang: Lang }) {
  const [mobile, setMobile] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setMobile(isMobileUA(navigator.userAgent)); }, []);
  const ola = olaLink(origin, dest, { mobile, xapp: process.env.NEXT_PUBLIC_OLA_XAPP });
  const copy = () => {
    try { void navigator.clipboard?.writeText(rapidoDropText(dest)).then(() => setCopied(true), () => {}); } catch { /* the link still opens */ }
  };
  return (
    <>
      <div className="btn-row ride-row">
        <a className="btn btn-soft tap" href={ola} target="_blank" rel="noopener noreferrer" aria-label={t(lang, "rideOlaLabel")}><Car size={18} aria-hidden />{t(lang, "rideOla")}</a>
        <a className="btn btn-soft tap" href={rapidoLink()} target="_blank" rel="noopener noreferrer" onClick={copy} aria-label={t(lang, "rideRapidoLabel")}><Car size={18} aria-hidden />{t(lang, "rideRapido")}</a>
      </div>
      <p className="tiny ride-note" role="status">{copied ? t(lang, "rideCopied") : t(lang, "rideNote")}</p>
    </>
  );
}
