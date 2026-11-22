import { handle, HttpError, readJson } from "@/lib/http";
import { assistText } from "@/lib/assist";
import { isLang } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The model's wording for "where are you?" and "is this where you are?", in the person's language. */
export const POST = handle(async (req) => {
  const b = (await readJson(req)) as { kind?: unknown; lang?: unknown; need?: unknown; place?: unknown };
  if (b.kind !== "ask" && b.kind !== "confirm") throw new HttpError(400, "kind must be ask or confirm");
  const lang = isLang(b.lang) ? b.lang : "en";
  const need = typeof b.need === "string" ? b.need.slice(0, 300) : undefined;
  const place = typeof b.place === "string" ? b.place.trim().slice(0, 100) : undefined;
  return Response.json(await assistText(b.kind, { lang, need, place }));
});
