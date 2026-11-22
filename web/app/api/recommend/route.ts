import { handle, HttpError, readJson } from "@/lib/http";
import { recommend } from "@/lib/recommend";
import { geocode } from "@/lib/geocoder";
import { inIndia } from "@/lib/geo";
import { isServiceId } from "@/lib/services";
import { PERSONA_BY_ID, type PersonaId } from "@/lib/preferences";
import type { Preferences, ServiceId, Urgency } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export const POST = handle(async (req) => {
  const b = (await readJson(req)) as Record<string, unknown>;

  const services = (Array.isArray(b.services) ? b.services : []).filter((s): s is ServiceId => typeof s === "string" && isServiceId(s)).slice(0, 4);
  if (!services.length) throw new HttpError(400, "Tell us which kind of care is needed.");
  const urgency: Urgency = b.urgency === "emergency" || b.urgency === "urgent" || b.urgency === "routine" ? b.urgency : "routine";

  let lat: number, lon: number, label: string | null = null;
  const loc = b.location as Record<string, unknown> | undefined;
  if (loc && num(loc.lat) && num(loc.lon)) {
    if (!inIndia(loc.lat, loc.lon)) throw new HttpError(422, "That location is outside India. Please check it.");
    lat = loc.lat; lon = loc.lon; label = typeof loc.label === "string" ? loc.label.slice(0, 80) : null;
  } else if (loc && typeof loc.query === "string" && loc.query.trim()) {
    const g = geocode(loc.query.trim().slice(0, 80), typeof loc.state === "string" ? loc.state : null);
    if (g.status === "ambiguous") return Response.json({ error: g.message, ambiguous: g }, { status: 422 });
    if (g.status !== "ok") return Response.json({ error: g.message }, { status: 422 });
    lat = g.lat; lon = g.lon; label = g.matched;
  } else throw new HttpError(400, "Tell us where you are, or allow location access.");

  const persona = typeof b.persona === "string" && b.persona in PERSONA_BY_ID ? (b.persona as PersonaId) : "everyone";
  const preferences: Partial<Preferences> = {};
  if (b.preferences && typeof b.preferences === "object") {
    for (const k of ["speed", "trust", "cost", "comfort", "government"] as const) {
      const v = (b.preferences as Record<string, unknown>)[k];
      if (num(v)) preferences[k] = Math.min(1, Math.max(0, v));
    }
  }
  const card = b.card === "yes" || b.card === "no" ? b.card : "unknown";

  const data = await recommend({ services, urgency, lat, lon, locationLabel: label, persona, preferences, card });
  return Response.json(data);
});
