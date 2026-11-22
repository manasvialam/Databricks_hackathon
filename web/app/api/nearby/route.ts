import { handle, HttpError } from "@/lib/http";
import { nearbyServices } from "@/lib/nearby";
import { reverse } from "@/lib/geocoder";
import { inIndia } from "@/lib/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get("lat")), lon = Number(u.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inIndia(lat, lon)) throw new HttpError(400, "A location in India is needed.");
  const radius = Math.min(100, Math.max(5, Number(u.searchParams.get("radius")) || 25));
  const near = nearbyServices(lat, lon, radius);
  const where = reverse(lat, lon);
  return Response.json({ ...near, radiusKm: radius, district: where?.district ?? null, state: where?.state ?? null,
    note: "Counts are facilities in our data with solid evidence for the service, not every facility in the area." });
});
