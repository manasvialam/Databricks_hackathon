// Shapes of the records in data/facilities.snapshot.json (written by scripts/export_snapshot.py).
// Keys are short on purpose: the snapshot is 18 MB raw.
import type { MsgKey, Vars } from "./i18n";

export type ServiceId =
  | "dialysis" | "c_section" | "obstetrics" | "nicu" | "icu" | "cardiac_surgery" | "cath_lab" | "mri"
  | "ct_scan" | "burn_care" | "trauma_emergency" | "blood_bank" | "oncology" | "ventilator" | "linear_accelerator";

export type ClaimLevel = "Strong" | "Moderate" | "Weak" | "Inferred" | "Contradicted";
export type Urgency = "emergency" | "urgent" | "routine";
export type LocationTrust =
  | "verified" | "verified_osm" | "probable" | "approximate_pin" | "approximate_district" | "unverified" | "unknown";

export interface Snippet { x: string; f: string }
export interface CiteUrl { u: string; c: string; n: boolean }

export interface Claim {
  s: ServiceId;
  l: ClaimLevel;
  st: number | null;      // claim_strength 0..1
  nf: number;             // number of fields that agree
  f: string[];            // which fields (specialties, procedure, equipment, capability)
  sp: boolean;            // specific evidence (counts, models)
  pm: boolean;            // prerequisites met
  ct: string[];           // contradictions
  cr: string[];           // claim reasons
  sn: Snippet[];          // quoted evidence
  u: CiteUrl[];           // citations
}

export interface Registry {
  t: "verified" | "possible";
  m: string;
  hfr: string | null;
  own: "government" | "private" | null;
  nabh: boolean;
  tb: boolean;
  sus: boolean;           // suspended / de-empanelled / blacklisted
  badge: boolean;         // verified and not suspended: only these may show the badge
  svc: string[];          // services the empanelled specialty packages map to
  sp: string[];           // empanelled specialty package names
  dt: string | null;      // empanelment date
  ns: number | null;
  km: number | null;
}

export interface Reason { k: "loc" | "contact" | "data" | "claims"; t: string }

export interface Facility {
  id: string;
  nm: string;
  ty: string | null;
  op: string | null;
  sz: "small" | "medium" | "large" | "xlarge" | null;
  ci: string | null;
  st: string | null;
  di: string | null;
  dk: string | null;
  la: number;
  lo: number;
  lp: string | null;      // location precision
  lt: LocationTrust | null;
  ls: number | null;      // location trust score 0..1
  ft: number | null;      // facility trust 0..100
  ms: number | null;      // merge suspect score 0..5
  h24: boolean;
  ph: string[];
  ws: string | null;
  rt: string | null;
  wd: boolean;
  gv: boolean;
  pri: boolean;           // primary row of its duplicate group
  ne: number | null;
  nsp: number | null;
  cl: Claim[];
  rs: Reason[];
  rg: Registry | null;
}

export interface DistrictInfo {
  name: string;
  state: string;
  n: number | null;
  density: string | null;
  msg: string | null;
  nfhs: Record<string, number>;
}

export interface Preferences {
  speed: number;          // how much ETA matters
  trust: number;
  cost: number;
  comfort: number;
  government: number;
}

export interface TrafficEta { minutes: number; freeFlowMinutes: number | null; live: boolean; congestion: number }

/**
 * One named signal in "How we decided". `label`/`detail` are English; `k`/`v` and `dk`/`dv` are the message keys the
 * interface translates (see lib/i18n). A detail without `dk` exists only in English.
 */
export interface Contribution { label: string; delta: number; detail?: string; k?: MsgKey; v?: Vars; dk?: MsgKey; dv?: Vars }

export interface RankedFacility {
  facility: Facility;
  pBest: number;
  rankMean: number;
  utility: number;
  utilityLow: number;
  utilityHigh: number;
  etaMinutes: number;
  etaLow: number;
  etaHigh: number;
  distanceKm: number;
  live: boolean;
  congestion: number;
  pService: Record<string, number>;
  primaryPService: number;
  solid: boolean;          // evidence is strong enough to recommend without a caution
  contributions: Record<string, Contribution[]>;
  claims: Record<string, Claim | null>;
}

export interface Picks {
  best: RankedFacility | null;
  fastest: RankedFacility | null;
  mostTrusted: RankedFacility | null;
  bestValue: RankedFacility | null;
  mostComfortable: RankedFacility | null;
}

export type Confidence = "clear" | "several_similar" | "none_reliable";
