import { handle, HttpError, readJson } from "@/lib/http";
import { triage } from "@/lib/triage/triage";
import { geocode, type GeocodeResult } from "@/lib/geocoder";
import { llmConfigured, llmExtract } from "@/lib/databricks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isString = (x: unknown): x is string => typeof x === "string";

export const POST = handle(async (req) => {
  const b = (await readJson(req)) as { message?: unknown; history?: unknown };
  const message = isString(b.message) ? b.message.trim() : "";
  if (!message || message.length > 1000) throw new HttpError(400, "Please type or say what you need (up to 1000 characters).");
  const history = Array.isArray(b.history) ? b.history.filter(isString).slice(-6).map((s) => s.slice(0, 500)) : [];

  const result = await triage(message, { history, llm: llmConfigured() ? llmExtract : null });

  let location: GeocodeResult | null = null, ambiguous: GeocodeResult | null = null;
  for (const q of result.placeCandidates) {
    const g = geocode(q);
    if (g.status === "ok") { location = g; break; }
    if (g.status === "ambiguous" && !ambiguous) ambiguous = g;
  }
  return Response.json({ triage: result, location, ambiguous });
});
