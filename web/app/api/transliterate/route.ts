import { handle, HttpError, readJson } from "@/lib/http";
import { isLang } from "@/lib/i18n";
import { transliterate } from "@/lib/translit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hospital and place names written in the person's script. */
export const POST = handle(async (req) => {
  const b = (await readJson(req)) as { lang?: unknown; names?: unknown };
  if (!isLang(b.lang)) throw new HttpError(400, "Unknown language.");
  const names = Array.isArray(b.names) ? b.names.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 160).slice(0, 16) : [];
  if (!names.length) throw new HttpError(400, "No names.");
  return Response.json(await transliterate(b.lang, names));
});
