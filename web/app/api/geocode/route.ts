import { handle, HttpError } from "@/lib/http";
import { geocode } from "@/lib/geocoder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").trim();
  if (!q || q.length > 80) throw new HttpError(400, "Type a city, district or PIN code.");
  return Response.json(geocode(q, u.searchParams.get("state")));
});
