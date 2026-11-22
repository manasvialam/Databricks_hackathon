import "server-only";
import fs from "node:fs";
import path from "node:path";
import { haversineKm, inIndia } from "./geo";
import { asciiDigits, hasIndic, nativePlace, phon, toLatin } from "./indic";

// Port of Person_2/geocoder.py. Data comes from scripts/export_geocoder_data.py.
type PlaceRow = [number, string, number, number, "d" | "p" | "c", string, number]; // state idx, district, lat, lon, level, label, weight
interface Data {
  states: string[];
  pins: Record<string, [number, number, number, string]>;
  places: Record<string, PlaceRow[]>;
  stateCentroid: Record<string, [number, number]>;
  cityAlias: Record<string, string>;
  stateAlias: Record<string, string>;
}

export type GeoLevel = "coordinates" | "pin" | "post_office" | "city" | "district" | "state";
export type GeocodeResult =
  | { status: "ok"; lat: number; lon: number; level: GeoLevel; matched: string; state: string | null; district: string | null; confidence: number; note: string | null }
  | { status: "ambiguous"; query: string; message: string; candidates: { label: string; state: string; district: string; lat: number; lon: number }[] }
  | { status: "not_found"; message: string };

let data: Data | null = null;
const load = (): Data => (data ??= JSON.parse(fs.readFileSync(path.join(/*turbopackIgnore: true*/ process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "data"), "geocoder.json"), "utf-8")) as Data);

const words = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter(Boolean);
export const lkey = (s: string) => words(s).join("");
export const skey = (s: string) => words(s).filter((w) => w !== "and" && w !== "the").join("");

export function canonCity(s: string): string {
  const k = lkey(s);
  return load().cityAlias[k] ?? k;
}

export function normState(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = load();
  const k = skey(s);
  const byKey = new Map(d.states.map((n) => [skey(n), n]));
  if (byKey.has(k)) return byKey.get(k)!;
  if (d.stateAlias[k] && d.states.includes(d.stateAlias[k])) return d.stateAlias[k];
  const padded = ` ${words(s).filter((w) => w !== "and" && w !== "the").join(" ")} `;
  const seqs = d.states.map((n) => [words(n).filter((w) => w !== "and" && w !== "the").join(" "), n] as const).sort((a, b) => b[0].length - a[0].length);
  for (const [seq, n] of seqs) if (padded.includes(` ${seq} `)) return n;
  return null;
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}
const FUZZY = 0.84;
const LEVEL_ORDER: Record<string, number> = { c: 2, p: 2, d: 3 };
const LEVEL_NAME: Record<string, GeoLevel> = { c: "city", p: "post_office", d: "district" };

const ok = (lat: number, lon: number, level: GeoLevel, matched: string, state: string | null, district: string | null, confidence: number, note: string | null = null): GeocodeResult =>
  ({ status: "ok", lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, level, matched, state, district, confidence: Math.round(confidence * 100) / 100, note });

/**
 * strict: only an exact match on a city or district (or a known native-script name). Used for place phrases pulled
 * out of a sentence, where a loose match could turn an ordinary word into a town.
 */
export function geocode(query: string, stateHint?: string | null, opts: { strict?: boolean } = {}): GeocodeResult {
  const d = load();
  const q = asciiDigits((query ?? "").trim());
  if (!q) return { status: "not_found", message: "empty query" };

  const digits = q.replace(/[ -]/g, "");
  if (/^[1-9]\d{5}$/.test(digits)) {
    const p = d.pins[digits];
    return p ? ok(p[0], p[1], "pin", `PIN ${digits}`, d.states[p[2]] ?? null, p[3], 1) : { status: "not_found", message: `PIN ${digits} is not in the India Post directory` };
  }

  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const a = parseFloat(m[1]), b = parseFloat(m[2]);
    if (inIndia(a, b)) return ok(a, b, "coordinates", q, null, null, 1);
    if (inIndia(b, a)) return ok(b, a, "coordinates", q, null, null, 0.9, "latitude and longitude looked swapped and were corrected");
    return { status: "not_found", message: "coordinates are outside India" };
  }

  if (hasIndic(q)) return geocodeIndic(q, stateHint ?? null, !!opts.strict);

  let st = normState(stateHint ?? null);
  const parts = q.split(",").map((s) => s.trim()).filter(Boolean);
  const name = parts[0];
  if (parts.length > 1 && !st) for (const p of parts.slice(1)) st = normState(p) ?? st;
  const sOnly = normState(name);
  if (sOnly && parts.length === 1 && !st && d.stateCentroid[sOnly]) {
    const c = d.stateCentroid[sOnly];
    return ok(c[0], c[1], "state", name, sOnly, null, 0.5, "only the state centre is known; give a city, district or PIN for a better answer");
  }

  const key = canonCity(name);
  let cands: PlaceRow[] = d.places[key] ?? [];
  let how = "exact";
  if (!cands.length) {
    const close = Object.keys(d.places).map((k) => [k, similarity(key, k)] as const).filter(([, s]) => s >= FUZZY).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (close.length) { cands = close.flatMap(([k]) => d.places[k]); how = "fuzzy"; }
  }
  return resolve(cands, how, st, name);
}

// ---------- names written in an Indian script -----------------------------------------------------------------------
let phonIdx: Map<string, string[]> | null = null;
function phonIndex(): Map<string, string[]> {
  if (phonIdx) return phonIdx;
  phonIdx = new Map();
  for (const k of Object.keys(load().places)) {
    const p = phon(k);
    const list = phonIdx.get(p);
    if (list) list.push(k); else phonIdx.set(p, [k]);
  }
  return phonIdx;
}

function indicState(s: string): string | null {
  const latin = toLatin(s);
  const direct = normState(latin);
  if (direct) return direct;
  const k = phon(latin);
  if (k.length < 4) return null;
  let best: [string, number] | null = null;
  for (const n of load().states) {
    const sim = similarity(k, phon(n));
    if (sim >= 0.8 && (!best || sim > best[1])) best = [n, sim];
  }
  return best?.[0] ?? null;
}

function geocodeIndic(q: string, stateHint: string | null, strict: boolean): GeocodeResult {
  const d = load();
  const parts = q.split(/[,،]/).map((s) => s.trim()).filter(Boolean);
  const name = parts[0];
  let st = stateHint ? normState(stateHint) ?? indicState(stateHint) : null;
  for (const p of parts.slice(1)) st = indicState(p) ?? st;

  const en = nativePlace(name);
  if (en) return geocode(en, st);

  if (!strict && parts.length === 1) {
    const sOnly = indicState(name);
    if (sOnly && d.stateCentroid[sOnly]) {
      const c = d.stateCentroid[sOnly];
      return ok(c[0], c[1], "state", sOnly, sOnly, null, 0.5, "only the state centre is known; give a city, district or PIN for a better answer");
    }
  }

  const key = phon(toLatin(name));
  if (key.length < 4) return { status: "not_found", message: `could not find '${name}'` };
  let keys = phonIndex().get(key) ?? [];
  let how = "exact";
  if (!keys.length && !strict) {
    // only the closest spelling(s): a looser net would turn one town into an "ambiguous" list of unrelated ones
    const scored = [...phonIndex().keys()].map((k) => [k, similarity(key, k)] as const).filter(([, s]) => s >= 0.8);
    const top = Math.max(0, ...scored.map(([, s]) => s));
    keys = scored.filter(([, s]) => s === top).flatMap(([k]) => phonIndex().get(k) ?? []);
    how = "fuzzy";
  }
  let cands = keys.flatMap((k) => d.places[k]);
  if (strict) cands = cands.filter((c) => c[4] === "c" || c[4] === "d");
  return resolve(cands, how, st, name);
}

function resolve(candsIn: PlaceRow[], how: string, st: string | null, name: string): GeocodeResult {
  const d = load();
  let cands = candsIn;
  if (st) cands = cands.filter((c) => d.states[c[0]] === st);
  if (!cands.length) return { status: "not_found", message: `could not find '${name}'${st ? ` in ${st}` : ""}` };

  const best = new Map<string, PlaceRow>();
  for (const c of cands) {
    const k = `${c[0]}|${c[1]}`, cur = best.get(k);
    if (!cur || LEVEL_ORDER[c[4]] < LEVEL_ORDER[cur[4]] || (LEVEL_ORDER[c[4]] === LEVEL_ORDER[cur[4]] && c[6] > cur[6])) best.set(k, c);
  }
  const list = [...best.values()].sort((a, b) => LEVEL_ORDER[a[4]] - LEVEL_ORDER[b[4]] || b[6] - a[6]);
  const conf = how === "exact" ? 0.95 : 0.75;
  const toOk = (c: PlaceRow, cf: number, note: string | null = null) => ok(c[2], c[3], LEVEL_NAME[c[4]], c[5], d.states[c[0]] ?? null, c[1], cf, note);
  if (list.length === 1) return toOk(list[0], conf);
  const states = new Set(list.map((c) => c[0]));
  if (states.size === 1) return toOk(list[0], conf * 0.9, `${list.length} places share this name in ${d.states[list[0][0]]}; showing the main one`);
  return {
    status: "ambiguous", query: name, message: `'${name}' exists in ${states.size} states; please add the state.`,
    candidates: list.slice(0, 6).map((c) => ({ label: c[5], state: d.states[c[0]], district: c[1], lat: c[2], lon: c[3] })),
  };
}

/** Nearest PIN to a coordinate: state and district for coverage messages. */
export function reverse(lat: number, lon: number): { pin: string; state: string | null; district: string; km: number } | null {
  const d = load();
  let best: [string, number] | null = null;
  for (const [pin, p] of Object.entries(d.pins)) {
    const dl = p[0] - lat, dn = (p[1] - lon) * Math.cos((lat * Math.PI) / 180);
    const dd = dl * dl + dn * dn;
    if (!best || dd < best[1]) best = [pin, dd];
  }
  if (!best) return null;
  const p = d.pins[best[0]];
  return { pin: best[0], state: d.states[p[2]] ?? null, district: p[3], km: Math.round(haversineKm(lat, lon, p[0], p[1]) * 10) / 10 };
}
