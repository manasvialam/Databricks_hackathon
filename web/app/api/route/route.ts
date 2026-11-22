import { handle, HttpError } from "@/lib/http";
import { inIndia } from "@/lib/geo";
import { osrmRoute } from "@/lib/routing";
import { areaFor, driveMinutes, istHour, trafficInfo } from "@/lib/congestion";
import { snapshot } from "@/lib/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Driving route from the person to a hospital: distance, time, the line for the map and the turns. Road data from OpenStreetMap (OSRM). */
export const GET = handle(async (req) => {
  const u = new URL(req.url);
  const [lat, lon, tlat, tlon] = ["lat", "lon", "tlat", "tlon"].map((k) => Number(u.searchParams.get(k)));
  if (![lat, lon, tlat, tlon].every(Number.isFinite) || !inIndia(lat, lon) || !inIndia(tlat, tlon)) throw new HttpError(400, "Both places must be in India.");
  const route = await osrmRoute({ lat, lon }, { lat: tlat, lon: tlon });
  if (!route) return Response.json({ available: false });
  const area = areaFor(lat, lon, snapshot().index.within(lat, lon, 5).length), hour = istHour();
  return Response.json({ available: true, ...route, freeMinutes: driveMinutes(route.minutes, area, 3, route.km), minutes: driveMinutes(route.minutes, area, hour, route.km), traffic: trafficInfo(area), attribution: "Routing and map data © OpenStreetMap contributors" });
});
