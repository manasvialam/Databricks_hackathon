"use client";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { t, type Lang } from "@/lib/i18n";
import { Sheet } from "./Sheets";
import { Name } from "./Name";
import { TxText } from "./Tx";
import { RouteMap, useRoute } from "./RouteMap";
import { TrafficStrip } from "./Traffic";
import { RideButtons } from "./RideButtons";

export interface MapTarget { name: string; lat: number; lon: number; fallbackKm?: number; fallbackMinutes?: number }

/**
 * Full directions: the OpenStreetMap map with the driving route, a glass chip with time and road distance, today's traffic with the
 * typical day, the turns, and a hand-off to a maps app. Routing is OSRM on OpenStreetMap data; times are a calibrated typical figure,
 * not live traffic (lib/congestion.ts). When routing is unreachable the map still shows both places and says so.
 */
export function MapSheet({ origin, dest, lang, onClose, onListen }: { origin: { lat: number; lon: number }; dest: MapTarget; lang: Lang; onClose: () => void; onListen?: () => void }) {
  const route = useRoute(origin, dest);
  const [steps, setSteps] = useState(false);
  const km = route?.available ? route.km : dest.fallbackKm;
  const min = route?.available ? route.minutes : dest.fallbackMinutes;
  const gmaps = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lon}&destination=${dest.lat},${dest.lon}&travelmode=driving`;
  return (
    <Sheet title={t(lang, "directionsMap")} onClose={onClose} lang={lang} onListen={onListen}>
      <div className="mapbox">
        <RouteMap origin={origin} dest={dest} route={route} label={dest.name} />
        {!route && <div className="map-loading" aria-hidden><span className="dots"><i /><i /><i /></span></div>}
        {min != null && km != null && (
          <div className="glass-chip" role="status"><b>{min}</b><span>{t(lang, "min")}</span><i aria-hidden /><b>{km}</b><span>{t(lang, "km")}</span></div>
        )}
      </div>
      <p className="map-dest" data-read><Name text={dest.name} lang={lang} /></p>
      <p className="tiny">{route?.available ? t(lang, "byRoadNote") : route ? t(lang, "routeUnavailable") : " "}</p>
      {route?.available && route.traffic && <TrafficStrip traffic={route.traffic} extraMin={Math.max(0, (route.minutes ?? 0) - (route.freeMinutes ?? 0))} lang={lang} />}
      {route?.available && route.steps && route.steps.length > 0 && (
        <div className="more">
          <button type="button" className="more-row" aria-expanded={steps} onClick={() => setSteps((s) => !s)}>{t(lang, "turnByTurn")}<span className="chev-txt" aria-hidden>{steps ? "–" : "+"}</span></button>
          <div className="more-body" data-open={steps}>
            <div><ol className="turns">{route.steps.map((s, i) => <li key={i}><span><TxText text={s.text} lang={lang} /></span><small>{s.km} {t(lang, "km")}</small></li>)}</ol></div>
          </div>
        </div>
      )}
      <a className="btn btn-soft tap" style={{ width: "100%", marginTop: 14 }} href={gmaps} target="_blank" rel="noopener noreferrer"><ExternalLink size={17} aria-hidden />{t(lang, "openInMaps")}</a>
      <div style={{ marginTop: 10 }}><RideButtons origin={origin} dest={dest} lang={lang} /></div>
    </Sheet>
  );
}
