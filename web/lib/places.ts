/** Suggested places shown in the location picker, so the app is usable when device location is off or denied. Each is resolved by the geocoder from its full address (PIN anchored). */
export interface PresetPlace { label: string; sub: string; query: string }
export const PRESET_PLACES: PresetPlace[] = [
  { label: "Thamarai International School", sub: "Thanjavur, Tamil Nadu 613002", query: "thamarai international school, thanjavur, india 613002" },
  { label: "Madambakkam Main Road", sub: "Rajakilpakam, Chennai 600073", query: "madambakkam main road, rajakilpakam, chennai 600073" },
  { label: "Kallipadam PO", sub: "Shoranur, Palakkad, Kerala 679122", query: "kallipadam po, shoranur 2, palakkad, kerala 679122" },
];

/**
 * The person's "current location" until they pick another place. For now it is mocked: the Madambakkam address (the geocoder places it by
 * its PIN, 600073), so the app always starts with a place and never has to ask. Set NEXT_PUBLIC_MOCK_LOCATION=off at build time to use the
 * phone's own position instead ("Use current location" then asks the device).
 */
export const MOCK_CURRENT_LOCATION = { lat: 12.92, lon: 80.1474, label: "Madambakkam, Chennai 600073", current: true as const };
export const MOCK_LOCATION_ON = process.env.NEXT_PUBLIC_MOCK_LOCATION !== "off";
