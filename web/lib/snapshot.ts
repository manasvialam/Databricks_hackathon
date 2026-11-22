import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { DistrictInfo, Facility } from "./types";
import { GridIndex } from "./geo";

interface Loaded {
  facilities: Facility[];
  byId: Map<string, Facility>;
  index: GridIndex<Facility>;
  districts: Record<string, DistrictInfo>;
  meta: { built: string; facilities: number; registry_list_as_of: string | null; registry_verified: number; claims: number };
}

let cache: Loaded | null = null;

const dataDir = () => process.env.SNAPSHOT_DIR ?? path.join(process.cwd(), "data");
const readJson = <T,>(name: string): T => JSON.parse(fs.readFileSync(path.join(/*turbopackIgnore: true*/ dataDir(), name), "utf-8")) as T;

/** Read once per server process; the file is large, so it is never sent to the browser. */
export function snapshot(): Loaded {
  if (cache) return cache;
  const facilities = readJson<Facility[]>("facilities.snapshot.json").filter((f) => f.pri);
  cache = {
    facilities,
    byId: new Map(facilities.map((f) => [f.id, f])),
    index: new GridIndex(facilities),
    districts: readJson<Record<string, DistrictInfo>>("districts.snapshot.json"),
    meta: readJson("snapshot.meta.json"),
  };
  return cache;
}

/** Test hook. */
export function _setSnapshotForTests(l: Loaded | null) { cache = l; }
