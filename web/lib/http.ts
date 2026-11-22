// Small helpers for the route handlers: safe JSON body reading, per-IP rate limiting, consistent errors.
const hits = new Map<string, number[]>();

export function rateLimited(ip: string, limit = 40, windowMs = 60_000, now = Date.now()): boolean {
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return arr.length > limit;
}
export function _resetRateLimitForTests() { hits.clear(); }

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

export async function readJson(req: Request, maxBytes = 20_000): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "That message is too long.");
  try { return JSON.parse(text); } catch { throw new HttpError(400, "The request was not valid JSON."); }
}

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

export const fail = (status: number, message: string, extra: Record<string, unknown> = {}) => Response.json({ error: message, ...extra }, { status, headers: { "Cache-Control": "no-store" } });

/** `key` and `limit` give a route its own budget (typing suggestions fire many small requests and must not use up the one for searches). */
export function handle(fn: (req: Request) => Promise<Response>, opts: { limit?: number; key?: string } = {}) {
  return async (req: Request) => {
    try {
      if (rateLimited(opts.key ? `${clientIp(req)}|${opts.key}` : clientIp(req), opts.limit ?? 40)) return fail(429, "Too many requests. Please wait a moment and try again.");
      const res = await fn(req);
      if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store");   // every answer depends on the request: never reuse one for another search
      return res;
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message);
      console.error("route error", e instanceof Error ? e.message : e);
      return fail(500, "Something went wrong on our side. Please try again.");
    }
  };
}
