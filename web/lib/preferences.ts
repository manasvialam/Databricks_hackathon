import type { Preferences, Urgency } from "./types";

export type PersonaId = "everyone" | "ambulance" | "simple" | "health_worker" | "clinician";

export interface Persona {
  id: PersonaId;
  label: string;
  hint: string;
  weights: Preferences;     // prior weights; normalised before use
}

// Starting points only. Anything the person moves a slider on replaces these.
export const PERSONAS: Persona[] = [
  { id: "everyone", label: "Balanced", hint: "A mix of speed, trust and cost", weights: { speed: 0.3, trust: 0.3, cost: 0.2, comfort: 0.1, government: 0.1 } },
  { id: "ambulance", label: "Ambulance or emergency", hint: "Fastest route to a hospital that can treat this now", weights: { speed: 0.6, trust: 0.3, cost: 0.0, comfort: 0.0, government: 0.1 } },
  { id: "simple", label: "Keep it simple", hint: "Few results, close by, easy to call", weights: { speed: 0.4, trust: 0.3, cost: 0.2, comfort: 0.0, government: 0.1 } },
  { id: "health_worker", label: "Health worker or NGO", hint: "Reliable, low cost, referral-friendly", weights: { speed: 0.2, trust: 0.35, cost: 0.25, comfort: 0.0, government: 0.2 } },
  { id: "clinician", label: "Doctor", hint: "Capability depth and evidence first", weights: { speed: 0.2, trust: 0.45, cost: 0.05, comfort: 0.1, government: 0.0 } },
];

export const PERSONA_BY_ID: Record<PersonaId, Persona> = Object.fromEntries(PERSONAS.map((p) => [p.id, p])) as Record<PersonaId, Persona>;

export function normalise(w: Preferences): Preferences {
  const sum = w.speed + w.trust + w.cost + w.comfort + w.government;
  if (sum <= 0) return { speed: 0.3, trust: 0.3, cost: 0.2, comfort: 0.1, government: 0.1 };
  return { speed: w.speed / sum, trust: w.trust / sum, cost: w.cost / sum, comfort: w.comfort / sum, government: w.government / sum };
}

// Emergencies override whatever was chosen: nobody should wait for a cheaper option with a heart attack.
export function effectivePreferences(base: Preferences, urgency: Urgency): Preferences {
  if (urgency === "emergency") {
    return normalise({ speed: Math.max(base.speed, 0.6), trust: Math.max(base.trust, 0.3), cost: base.cost * 0.2, comfort: 0, government: base.government * 0.3 });
  }
  if (urgency === "urgent") {
    return normalise({ ...base, speed: Math.max(base.speed, 0.4), comfort: base.comfort * 0.5 });
  }
  return normalise(base);
}

// Time scale (minutes) of the travel-time penalty: exp(-eta / tau).
export const TAU_MINUTES: Record<Urgency, number> = { emergency: 25, urgent: 45, routine: 90 };

export type CardStatus = "yes" | "no" | "unknown";
