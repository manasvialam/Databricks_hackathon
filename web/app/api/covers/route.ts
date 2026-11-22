import { handle, HttpError, readJson } from "@/lib/http";
import { solidServices } from "@/lib/nearby";
import { snapshot } from "@/lib/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which of the 15 services this facility has solid evidence for (the same rule as the hospital list and the service tiles). */
export const POST = handle(async (req) => {
  const b = (await readJson(req)) as { id?: unknown };
  const f = typeof b.id === "string" ? snapshot().byId.get(b.id) : undefined;
  if (!f) throw new HttpError(404, "Unknown facility.");
  return Response.json({ services: solidServices(f) });
});
