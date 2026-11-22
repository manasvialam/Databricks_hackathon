import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { DistrictInfo, Facility } from "./types";
import { GridIndex } from "./geo";
import { sqlQueryLong, warehouseConfigured } from "./databricks";

interface Loaded {
  facilities: Facility[];
  byId: Map<string, Facility>;
  index: GridIndex<Facility>;
  districts: Record<string, DistrictInfo>;
  meta: { built: string; facilities: number; registry_list_as_of: string | null; registry_verified: number; claims: number };
}

// Shared on globalThis: the server's startup hook (instrumentation.ts) and the route handlers are bundled separately,
// so plain module variables would not be the same object in both.
const G = globalThis as unknown as { __facilityStore?: { cache: Loaded | null; timer: ReturnType<typeof setInterval> | null } };
const store = (G.__facilityStore ??= { cache: null, timer: null });
export interface SourceInfo { source: "warehouse" | "snapshot"; loadedAt: string | null; warehouseError: string | null; warehouseLoading: boolean }
const GI = globalThis as unknown as { __facilityInfo?: SourceInfo };
const info: SourceInfo = (GI.__facilityInfo ??= { source: "snapshot", loadedAt: null, warehouseError: null, warehouseLoading: false });
export const sourceInfo = (): SourceInfo => ({ ...info });

const dataDir = () => process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "data");
const readJson = <T,>(name: string): T => JSON.parse(fs.readFileSync(path.join(/*turbopackIgnore: true*/ dataDir(), name), "utf-8")) as T;

function build(all: Facility[], districts: Record<string, DistrictInfo>, meta: Loaded["meta"]): Loaded {
  const facilities = all.filter((f) => f.pri);
  return { facilities, byId: new Map(facilities.map((f) => [f.id, f])), index: new GridIndex(facilities), districts, meta };
}

/** The bundled file answers immediately; read once per server process, never sent to the browser. */
export function snapshot(): Loaded {
  if (store.cache) return store.cache;
  store.cache = build(readJson<Facility[]>("facilities.snapshot.json"), readJson("districts.snapshot.json"), readJson("snapshot.meta.json"));
  info.loadedAt = new Date().toISOString();
  return store.cache;
}

const BUCKETS = 5, REFRESH_MS = 60 * 60_000;
const TABLE = process.env.APP_SNAPSHOT_TABLE ?? "workspace.facility_finder.app_snapshot";

/**
 * Load the facilities from the SQL warehouse (Delta table app_snapshot) and swap them in. Until that finishes, and whenever
 * it fails, the bundled file keeps serving, so a stopped warehouse never takes the app down.
 */
export async function loadFromWarehouse(): Promise<boolean> {
  if (!warehouseConfigured() || info.warehouseLoading) return false;
  info.warehouseLoading = true;
  try {
    const facilities: Facility[] = [];
    for (let b = 0; b < BUCKETS; b++) {
      const rows = await sqlQueryLong(`SELECT payload FROM ${TABLE} WHERE kind = 'facility' AND bucket = ${b}`);
      for (const r of rows) if (r.payload) facilities.push(JSON.parse(r.payload) as Facility);
    }
    const districts: Record<string, DistrictInfo> = {};
    for (const r of await sqlQueryLong(`SELECT k, payload FROM ${TABLE} WHERE kind = 'district'`)) if (r.k && r.payload) districts[r.k] = JSON.parse(r.payload);
    const meta = JSON.parse((await sqlQueryLong(`SELECT payload FROM ${TABLE} WHERE kind = 'meta'`))[0]?.payload ?? "null") as Loaded["meta"] | null;
    if (facilities.length < 1000 || !meta) throw new Error(`warehouse returned too little data (${facilities.length} facilities)`);
    // the warehouse table predates the specialty categories: take them from the bundled file by id until app_snapshot is reloaded with `sc`
    if (!facilities.some((f) => f.sc?.length)) {
      const bundled = new Map(readJson<Facility[]>("facilities.snapshot.json").map((f) => [f.id, f.sc]));
      for (const f of facilities) f.sc = bundled.get(f.id) ?? f.sc;
    }
    store.cache = build(facilities, districts, meta);
    Object.assign(info, { source: "warehouse", loadedAt: new Date().toISOString(), warehouseError: null });
    return true;
  } catch (e) {
    info.warehouseError = e instanceof Error ? e.message.slice(0, 200) : "failed";
    console.error("warehouse load failed, serving the bundled snapshot:", info.warehouseError);
    return false;
  } finally { info.warehouseLoading = false; }
}

/** Called once when the server starts: wake the warehouse, load, and refresh every hour. */
export function startWarehouseSync() {
  if (store.timer || !warehouseConfigured()) return;
  void loadFromWarehouse();
  store.timer = setInterval(() => void loadFromWarehouse(), REFRESH_MS);
  store.timer.unref?.();
}

/** Test hook. */
export function _setSnapshotForTests(l: Loaded | null) { store.cache = l; }
