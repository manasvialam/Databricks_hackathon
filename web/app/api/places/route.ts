import { handle } from "@/lib/http";
import { suggestPlaces } from "@/lib/placesearch";
import { inIndia } from "@/lib/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Address suggestions as the person types: GET /api/places?q=madambakkam main road&lat=12.9&lon=80.1 (lat and lon only bias the order). */
export const GET = handle(async (req) => {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (q.length < 2) return Response.json({ places: [] });
  const lat = Number(u.searchParams.get("lat")), lon = Number(u.searchParams.get("lon"));
  const near = Number.isFinite(lat) && Number.isFinite(lon) && inIndia(lat, lon) ? { lat, lon } : undefined;
  return Response.json({ places: await suggestPlaces(q, near) });
}, { limit: 240, key: "places" });
