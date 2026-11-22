/**
 * Ride links to a hospital or clinic. Pure functions; the link carries only the coordinates and name already on screen.
 *
 * OLA - documented at developers.olacabs.com/docs/deep-linking (checked 2026-11-22):
 *   web deep link   https://book.olacabs.com/?lat&lng&drop_lat&drop_lng&dsw=yes&drop_name   (India only)
 *   universal link  https://olawebcdn.com/assets/ola-universal-link.html?lat&lng&drop_lat&drop_lng&landing_page=bk&drop_address
 *                   opens the Ola app if installed, else book.olacabs.com; mobile browsers only, not webviews.
 *   app scheme      olacabs://app/launch?  (documented, not used here: the universal link already falls back correctly)
 *   lat/lng are the pickup; leaving them out makes Ola use the person's current location.
 *   The docs call `utm_source` (an affiliate XAPP token issued by Ola) required for attribution. We have no token and never invent one;
 *   set NEXT_PUBLIC_OLA_XAPP to add it. Without it the links are NOT confirmed to pre-fill the drop. UNVERIFIED on a device.
 *
 * RAPIDO - no public deep-link specification was found. UNVERIFIED: we only open https://www.rapido.bike/ (an app link on phones that
 *   have the app, otherwise the website) and the screen copies the hospital name so the person can paste it as the drop. No drop
 *   parameters are sent because none are documented.
 *
 * Not used: `geo:` URIs and navigator.share. Both list map apps, and neither reliably lists Ola or Rapido, so they would not give the
 * one-tap result asked for.
 */
export interface Point { lat: number; lon: number }
export interface RideDest extends Point { name: string }

const OLA_UNIVERSAL = "https://olawebcdn.com/assets/ola-universal-link.html";
const OLA_WEB = "https://book.olacabs.com/";
export const RAPIDO_URL = "https://www.rapido.bike/";

/** Five decimals is about a metre; keeps links short and avoids float noise. */
export const coord = (n: number) => String(Math.round(n * 1e5) / 1e5);
const valid = (p: Point | null | undefined): p is Point => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

function query(pairs: [string, string | undefined][]) {
  return pairs.filter((p): p is [string, string] => p[1] !== undefined && p[1] !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

export function olaLink(origin: Point | null | undefined, dest: RideDest, opts: { mobile: boolean; xapp?: string }): string {
  const o = valid(origin) ? origin : null;
  const name = dest.name.trim().slice(0, 120);
  const common: [string, string | undefined][] = [
    ["lat", o ? coord(o.lat) : undefined], ["lng", o ? coord(o.lon) : undefined],
    ["drop_lat", coord(dest.lat)], ["drop_lng", coord(dest.lon)],
  ];
  if (opts.mobile) return `${OLA_UNIVERSAL}?${query([...common, ["landing_page", "bk"], ["drop_address", name], ["utm_source", opts.xapp]])}`;
  return `${OLA_WEB}?${query([...common, ["dsw", "yes"], ["drop_name", name], ["utm_source", opts.xapp]])}`;
}

export function rapidoLink(): string { return RAPIDO_URL; }

/** Text copied for Rapido: the name of the place, nothing else. */
export const rapidoDropText = (dest: RideDest) => dest.name.trim();

export const isMobileUA = (ua: string) => /Android|iPhone|iPad|iPod/i.test(ua);
