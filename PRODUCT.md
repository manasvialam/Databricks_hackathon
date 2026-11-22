# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Next.js (App Router, TypeScript) in `web/`. Deployed twice from the same code: on Vercel for the public link and as a Databricks App so the submission runs on Databricks. Databricks supplies the data, the model endpoint and evaluation. The interface uses the Glisse library (Apple's Liquid Glass for the web). The challenge requires the core to run on Databricks Free Edition (no GPUs); anything heavier is an optional switch.

## Users
Primary: the patient themselves, on their own phone, often low-literacy, possibly unwell or frightened, usually outdoors or in transit, with patchy mobile data. They are looking for care for themselves or someone with them, and need to know where to go, how long it takes, and how sure we are.
Secondary audiences named in the approved plan (not yet interviewed): a relative or community health worker acting for a patient, an ambulance driver, a clinician, and a district planner or NGO coordinator.

## Product Purpose
Take what a person says or types about how they feel, decide how urgent it is and what kind of care is needed, and recommend nearby hospitals and clinics with the evidence for each. It makes uncertainty visible: every recommendation quotes the facility's own text with its source, says what could not be verified, and gives a probability that it is the best choice for this person's situation and preferences. Success is a person reaching a facility that can actually treat them, faster, and never being misled by weak evidence presented as fact.
Context: the CMU/Databricks datathon, where every recommendation must answer "why this facility" and "how did you decide".

## Positioning
Most facility finders return a confident list from unverified directory data. This one cross-checks each facility (location against postal data and OpenStreetMap, claims against the facility's own text, identity against the government PM-JAY empanelment list), then shows how sure it is and why. A neighbouring product could not truthfully copy the cross-checking, the evidence quotes, or the honest abstention ("no reliable option within 50 km").

## Operating Context
Used on a phone, often one-handed, in bright light, on slow or intermittent data, sometimes in an emergency. Spoken input and spoken answers matter. Location comes from the phone, with typed place or PIN code as a fallback. Live traffic changes the ranking ("not the nearest if it is jammed"). A person can say whether they hold an Ayushman Bharat (PM-JAY) card, which changes how cost is weighed. Facility data covers 9,988 facilities in India with uneven quality (many records are merged or have approximate locations).

## Capabilities and Constraints
- Chat with a voice mode (browser speech recognition and speech synthesis; server speech only as an optional extra).
- Triage into urgency (emergency, urgent, routine) and the type of care needed, plus "possible conditions to discuss with a clinician". Never a definitive diagnosis, never treatment or dosing advice.
- A deterministic emergency gate that runs without any model and without a network; it can only escalate. Emergency numbers: 108 (ambulance), 112 (emergency), Tele-MANAS 14416 for thoughts of self-harm.
- Languages for the first release: English, Hindi, Tamil, Telugu, Malayalam. All interface text exists in all five (draft translations in `web/lib/i18n/`), and every string, including all emergency wording, needs review by a native speaker and a clinician before launch. The emergency gate covers English and Hindi, plus draft phrase stems for Tamil, Telugu and Malayalam (`web/lib/triage/redflags.indic.ts`) that have not been reviewed by native speakers or a clinician and are not complete coverage.
- Recommendations are probabilistic and labelled "evidence-weighted estimate", not calibrated, until manual verification exists. Cost and comfort are proxies and labelled as such; there is no price, rating or live bed data.
- A registry badge appears only for confident matches to the PM-JAY empanelment list, in plain words and with the app's own mark; the State Emblem of India and the PM-JAY / Ayushman Bharat logos are not used. The app states it is not affiliated with the Government of India or the NHA.
- Privacy: location used per request only; no raw transcripts stored by default; voice consent notice.
- Open decisions: product name; traffic provider; whether the registry list may be used beyond validation; Whisper fallback; the source and terms of the registry list.

## Brand Commitments
Binding choices made by the user: the interface uses the Glisse library (Apple Liquid Glass for the web), and it must not look vibecoded. No name, logo or voice has been chosen. The government emblem and scheme logos are off limits.

## Evidence on Hand
- `facilities_final.parquet`: 9,989 facilities with claims, quoted snippets, source links and trust scores (`web/data/facilities.snapshot.json` is the slim copy the app serves).
- `hem_hospitals.csv`: 39,737 PM-JAY empanelled hospitals; 1,452 matched with high confidence, 531 possible (`scripts/out/registry_match.parquet`). Precision of the match has not yet been hand-checked.
- Person 2's location pipeline and OpenStreetMap match (87,469 places).
- No real user research, no clinical review, no testimonials, no ratings, no prices, no live-traffic key tested. None of these may be invented.

## Product Principles
1. Say how sure we are, every time. Weak evidence is never presented as fact; "we could not verify this" is a normal, visible state.
2. In an emergency the app gets out of the way: the gate runs first, works offline, and offers one action.
3. Show the evidence. Every recommendation quotes the facility's own words and where they came from.
4. Speak the person's language and meet their situation: voice first, plain words, five languages, no jargon, one clear next step.
5. Never pretend to know what we do not (price, quality, beds, opening hours). Proxies are labelled as proxies.

## Accessibility & Inclusion
Built for low-literacy and frightened users: voice in and out, icons beside words, short sentences, large touch targets. Five scripts (Latin, Devanagari, Tamil, Telugu, Malayalam) must render correctly on low-end Android and iOS using system fonts where possible. Text on glass must keep WCAG AA contrast; honour reduced-motion and reduced-transparency; work on slow data and low-end phones; keyboard and screen-reader operable.

## Handoff
Full project handoff (repository map, data, ranking, status, to-do list): see `HANDOFF.md`.
