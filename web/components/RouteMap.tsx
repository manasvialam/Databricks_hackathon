"use client";
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export interface TrafficData { area: string | null; tier: string; source: string; hour: number; factor: number; level: "light" | "moderate" | "heavy" | "severe"; hourly: number[] }
export interface RouteData { available: boolean; km?: number; minutes?: number; freeMinutes?: number; geometry?: [number, number][]; steps?: { text: string; km: number }[]; traffic?: TrafficData }
export interface Pt { lat: number; lon: number }

const memo = new Map<string, Promise<RouteData>>();
/** One route per origin and destination, shared by the small map, the traffic strip and the full map sheet. */
export function useRoute(origin: Pt | null, dest: Pt | null): RouteData | null {
  const [route, setRoute] = useState<RouteData | null>(null);
  const key = origin && dest ? `${origin.lat.toFixed(4)},${origin.lon.toFixed(4)}>${dest.lat.toFixed(4)},${dest.lon.toFixed(4)}` : null;
  useEffect(() => {
    if (!key || !origin || !dest) { setRoute(null); return; }
    let live = true;
    let p = memo.get(key);
    if (!p) {
      p = fetch(`/api/route?lat=${origin.lat}&lon=${origin.lon}&tlat=${dest.lat}&tlon=${dest.lon}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<RouteData>) : { available: false }))
        .catch(() => ({ available: false }));
      memo.set(key, p);
      p.then((v) => { if (!v.available) memo.delete(key); });          // do not remember a failure
      if (memo.size > 60) memo.delete(memo.keys().next().value as string);
    }
    setRoute(null);
    p.then((v) => live && setRoute(v));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return route;
}

/** An OpenStreetMap map with the route drawn (or a straight dashed line when no road route is available). Standard tiles, muted in CSS. */
export function RouteMap({ origin, dest, route, interactive = true, label }: { origin: Pt; dest: Pt; route: RouteData | null; interactive?: boolean; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current || !route) return;
    let map: import("leaflet").Map | null = null, dead = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (dead || !el.current) return;
      map = L.map(el.current, { zoomControl: false, attributionControl: interactive, scrollWheelZoom: false, dragging: interactive, touchZoom: interactive, doubleClickZoom: interactive, boxZoom: false, keyboard: false, tap: false } as import("leaflet").MapOptions);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map);
      if (interactive) L.control.zoom({ position: "bottomright" }).addTo(map);
      const you = L.divIcon({ className: "mk-wrap", html: '<span class="mk mk-you"></span>', iconSize: [22, 22], iconAnchor: [11, 11] });
      const hosp = L.divIcon({ className: "mk-wrap", html: '<span class="mk mk-hosp"></span>', iconSize: [26, 26], iconAnchor: [13, 13] });
      const a: [number, number] = [origin.lat, origin.lon], b: [number, number] = [dest.lat, dest.lon];
      if (route.available && route.geometry?.length) {
        const pts = route.geometry.map(([lo, la]) => [la, lo] as [number, number]);
        L.polyline(pts, { color: "#ffffff", weight: 9, opacity: 0.95, lineCap: "round", lineJoin: "round" }).addTo(map);
        const line = L.polyline(pts, { color: "#0e7c86", weight: 5, lineCap: "round", lineJoin: "round" }).addTo(map);
        L.marker(a, { icon: you, keyboard: false, interactive: false }).addTo(map);
        L.marker(b, { icon: hosp, keyboard: false, interactive: false }).addTo(map);
        map.fitBounds(line.getBounds(), { padding: [30, 30] });
      } else {
        L.polyline([a, b], { color: "#0e7c86", weight: 3, dashArray: "6 8", opacity: 0.8 }).addTo(map);
        L.marker(a, { icon: you, keyboard: false, interactive: false }).addTo(map);
        L.marker(b, { icon: hosp, keyboard: false, interactive: false }).addTo(map);
        map.fitBounds(L.latLngBounds([a, b]), { padding: [40, 40] });
      }
    })();
    return () => { dead = true; map?.remove(); };
  }, [route, origin.lat, origin.lon, dest.lat, dest.lon, interactive]);
  return <div ref={el} className="map" role="img" aria-label={label} />;
}
