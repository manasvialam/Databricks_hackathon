import { handle, HttpError, readJson } from "@/lib/http";
import { rerankFit } from "@/lib/rerank";
import { snapshot } from "@/lib/snapshot";
import type { Facility } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * For a need that maps to none of the 15 services (leg pain, fever): the language model scores how well each of the nearest
 * hospitals' own records suit what the person described. It can only score hospitals it is given, so it cannot add any.
 */
export const POST = handle(async (req) => {
  const b = (await readJson(req)) as { need?: unknown; ids?: unknown };
  const need = typeof b.need === "string" ? b.need.trim().slice(0, 400) : "";
  const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  if (!need || !ids.length) throw new HttpError(400, "need and ids are required");
  const byId = snapshot().byId;
  const facilities = ids.map((id) => byId.get(id)).filter((f): f is Facility => !!f);
  const fits = await rerankFit(need, facilities);
  return Response.json({ fits: fits ?? {}, source: fits ? "model" : "none" });
});
