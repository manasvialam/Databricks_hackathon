import { handle, HttpError } from "@/lib/http";
import { geocode, reverse } from "@/lib/geocoder";
import { inIndia } from "@/lib/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get("lat")), lon = Number(u.searchParams.get("lon"));
  if (u.searchParams.has("lat") && Number.isFinite(lat) && Number.isFinite(lon)) {          // "where is this position?" for the phone's location
    if (!inIndia(lat, lon)) return Response.json({ status: "not_found" });
    const r = reverse(lat, lon);
    return Response.json(r ? { status: "ok", label: [r.district, r.state].filter(Boolean).join(", ") } : { status: "not_found" });
  }
  const q = (u.searchParams.get("q") ?? "").trim();
  if (!q || q.length > 80) throw new HttpError(400, "Type a city, district or PIN code.");
  return Response.json(geocode(q, u.searchParams.get("state")));
});
