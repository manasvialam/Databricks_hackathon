import { handle, HttpError } from "@/lib/http";
import { nearbyHospitals, nearbyServices } from "@/lib/nearby";
import { reverse } from "@/lib/geocoder";
import { inIndia } from "@/lib/geo";
import { isSpecialtyId } from "@/lib/specialty";
import { osrmTable } from "@/lib/routing";
import { areaFor, driveMinutes, istHour, trafficInfo } from "@/lib/congestion";
import { snapshot } from "@/lib/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get("lat")), lon = Number(u.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inIndia(lat, lon)) throw new HttpError(400, "A location in India is needed.");
  const radius = Math.min(100, Math.max(5, Number(u.searchParams.get("radius")) || 25));
  const near = nearbyServices(lat, lon, radius);
  const where = reverse(lat, lon);
  const want = (u.searchParams.get("sp") ?? "").split(",").filter(isSpecialtyId).slice(0, 3);
  const list = nearbyHospitals(lat, lon, 12, want);
  // real road distance and time from OpenStreetMap routing; the straight-line figure stays when it is unavailable
  const legs = await osrmTable({ lat, lon }, list.hospitals);
  const area = areaFor(lat, lon, snapshot().index.within(lat, lon, 5).length), hour = istHour();
  if (legs) list.hospitals.forEach((h, i) => { const l = legs[i]; if (l) { h.roadKm = l.km; h.minutes = driveMinutes(l.minutes, area, hour, l.km); h.freeMinutes = driveMinutes(l.minutes, area, 3, l.km); } });
  return Response.json({ ...near, hospitals: list.hospitals, hospitalsRadiusKm: list.radiusKm, matchedCount: list.matchedCount, wanted: want, traffic: trafficInfo(area), radiusKm: radius, district: where?.district ?? null, state: where?.state ?? null,
    note: "Counts are facilities in our data with solid evidence for the service, not every facility in the area." });
});
