"use client";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { t, type Lang } from "@/lib/i18n";
import type { TrafficData } from "./RouteMap";

const LEVEL_KEY = { light: "trafficLight", moderate: "trafficModerate", heavy: "trafficHeavy", severe: "trafficSevere" } as const;
const levelOf = (f: number) => (f < 1.25 ? "light" : f < 1.6 ? "moderate" : f < 2.0 ? "heavy" : "severe");

/** Traffic as a picture: a four-step gauge, how many minutes it adds right now, and (tap to open) the usual pattern across the day. */
export function TrafficStrip({ traffic, extraMin, lang }: { traffic: TrafficData; extraMin: number; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const max = Math.max(...traffic.hourly);
  return (
    <div>
      <button type="button" className="traffic tap" data-level={traffic.level} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="tg" aria-hidden><i /><i /><i /><i /></span>
        <span className="tl"><b>{t(lang, LEVEL_KEY[traffic.level])}</b>{extraMin > 0 && <> · {t(lang, "trafficExtra", { n: extraMin })}</>}</span>
        <ChevronDown size={18} aria-hidden />
      </button>
      <div className="more-body" data-open={open}>
        <div>
          <div className="tday">
            <div className="tday-bars" role="img" aria-label={traffic.area ? t(lang, "trafficDay", { area: traffic.area }) : t(lang, "trafficDayHere")}>
              {traffic.hourly.map((f, h) => <i key={h} data-level={levelOf(f)} data-now={h === traffic.hour} style={{ height: `${Math.max(8, ((f - 1) / Math.max(0.01, max - 1)) * 100)}%` }} />)}
            </div>
            <div className="tday-axis" aria-hidden><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span></div>
            <p className="tiny">{traffic.area ? t(lang, "trafficDay", { area: traffic.area }) : t(lang, "trafficDayHere")}. {t(lang, "trafficTypical")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
