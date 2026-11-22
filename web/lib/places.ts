/** Suggested places shown in the location picker, so the app is usable when device location is off or denied. Each is resolved by the geocoder from its full address (PIN anchored). */
export interface PresetPlace { label: string; sub: string; query: string }
export const PRESET_PLACES: PresetPlace[] = [
  { label: "Thamarai International School", sub: "Thanjavur, Tamil Nadu 613002", query: "thamarai international school, thanjavur, india 613002" },
  { label: "Madambakkam Main Road", sub: "Rajakilpakam, Chennai 600073", query: "madambakkam main road, rajakilpakam, chennai 600073" },
  { label: "Kallipadam PO", sub: "Shoranur, Palakkad, Kerala 679122", query: "kallipadam po, shoranur 2, palakkad, kerala 679122" },
];
