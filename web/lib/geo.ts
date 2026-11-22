export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const INDIA_BBOX = { lat: [6, 37.6] as const, lon: [68, 97.5] as const };
export const inIndia = (lat: number, lon: number) =>
  lat >= INDIA_BBOX.lat[0] && lat <= INDIA_BBOX.lat[1] && lon >= INDIA_BBOX.lon[0] && lon <= INDIA_BBOX.lon[1];

/** Simple 0.1 degree grid (about 11 km) for radius queries over ~10k points. */
export class GridIndex<T extends { la: number; lo: number }> {
  private cells = new Map<string, T[]>();
  constructor(items: T[], private cell = 0.1) {
    for (const it of items) {
      const k = this.key(it.la, it.lo);
      const arr = this.cells.get(k);
      if (arr) arr.push(it); else this.cells.set(k, [it]);
    }
  }
  private key(la: number, lo: number) { return `${Math.floor(la / this.cell)}:${Math.floor(lo / this.cell)}`; }
  within(la: number, lo: number, km: number): { item: T; km: number }[] {
    const dLat = km / 111, dLon = km / (111 * Math.max(0.2, Math.cos((la * Math.PI) / 180)));
    const out: { item: T; km: number }[] = [];
    for (let a = Math.floor((la - dLat) / this.cell); a <= Math.floor((la + dLat) / this.cell); a++) {
      for (let b = Math.floor((lo - dLon) / this.cell); b <= Math.floor((lo + dLon) / this.cell); b++) {
        for (const it of this.cells.get(`${a}:${b}`) ?? []) {
          const d = haversineKm(la, lo, it.la, it.lo);
          if (d <= km) out.push({ item: it, km: d });
        }
      }
    }
    return out.sort((x, y) => x.km - y.km);
  }
}
