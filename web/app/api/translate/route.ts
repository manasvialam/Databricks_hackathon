import { handle, HttpError, readJson } from "@/lib/http";
import { isLang } from "@/lib/i18n";
import { translateTexts } from "@/lib/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async (req) => {
  const b = (await readJson(req)) as { lang?: unknown; texts?: unknown };
  if (!isLang(b.lang)) throw new HttpError(400, "Unknown language.");
  const texts = Array.isArray(b.texts) ? b.texts.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 300).slice(0, 8) : [];
  if (!texts.length) throw new HttpError(400, "Nothing to translate.");
  return Response.json(await translateTexts(b.lang, texts));
});
