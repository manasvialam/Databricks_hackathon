# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Next.js (App Router, TypeScript) in `web/`. Deployed twice from the same code: on Vercel for the public link and as a Databricks App so the submission runs on Databricks. Databricks supplies the data, the model endpoint and evaluation. The interface is plain React and CSS (no UI library), styled as a calm, Apple-like phone app. The challenge requires the core to run on Databricks Free Edition (no GPUs); anything heavier is an optional switch.

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
- Home is voice first: a large central mic orb is the main control, with a roomy type bar and a quick-needs row (Emergency, Pregnancy, Dialysis, Heart, Cancer, ICU). Location is a compact header like Uber Eats or Instacart that opens a picker (search a town, PIN or full address, current location, suggested and recent places). Back, swipe-back and an in-app back arrow behave like a native app.
- The home screen has personality without turning into a chat: a navy hero card with a simple **hospital block with an ambulance** (a cream multi-storey building with a window grid, an orange rooftop signboard with a cross, an entrance canopy, and a white ambulance with an orange stripe parked beside it) beside an obvious **Speak** button. It responds: windows light up and sound arcs swell with your voice when listening, the windows light in turn while it thinks, the signboard pulses with each spoken word, the building hops when it finds a hospital, and the signboard turns red while the ambulance beacon flashes in an emergency. Keep it simple: no 3D, no pixel art, no animals, no doctors, no avatar portraits, speech bubbles or chat input bar. One palette across the whole app: navy (text, hero, dock), orange (the main action and highlights), teal (routes, links, verified), warm sand page with white cards; red only for emergencies. Buttons and calls to action are solid; gradients are for backgrounds and the character only. **Show at the door** is a bold navy card on every result: it previews the sentence to say and opens a hold-up-to-the-desk view with that sentence in large English (what staff read), the same in the person's language, and what to bring (photo ID, PM-JAY card, medical papers, charged phone). A **What matters to you** row sits under the quick needs on the home screen (and in results) and opens the preferences sheet: an Ayushman Bharat (PM-JAY) card Yes / No / Not sure choice plus sliders for getting there fast, trust in the evidence, lower cost and comfort, with an **Update results** button; the choices re-rank the hospitals. The six quick needs are tiles with the label inside, placed low on the screen for thumb reach.
- Talk mode: the mic orb animates with the voice (live bars from the microphone level while listening, a spinner while thinking, coral word-synced bars while speaking) and, when the question was spoken, the best result is read back. Voice is never required: every flow works by typing.
- Chat with a voice mode (browser speech recognition and speech synthesis; server speech only as an optional extra), plus a read-along that reads any screen aloud with word highlighting.
- Visual identity: pearl background with soft blue and peach light, white glass surfaces, azure actions, coral highlights, teal for verified, no dominant green. Travel time shows as a traffic gauge and a typical-day chart for the area (calibrated for Indian cities, labelled typical, not live), plus an inline route map on every hospital card. "Show at the door" is only Say and Bring.
- Distances and times are by road (OpenStreetMap routing), shown on an in-app map with the route; Directions opens the map first and can hand off to a maps app. Live traffic is not included unless a provider key is configured.
- A need that maps to no service we hold evidence for is matched to the specialties hospitals list (bones, skin, heart, teeth, ...) so different needs return different hospitals; each hospital shows what it "Specialises in". Keep cards short for phones: specialties, one quoted line with its source, confidence, then fold-outs.
- Results are hospitals first, with specialties as tags; when a need maps to no service we hold evidence for (leg pain, fever) the nearest hospital is shown as a full card and the app says plainly that the list is nearest first. Do not group results by service type.
- A Databricks-hosted language model (optional) reads the person's own words in any of the five languages to decide the care needed, scores each shortlisted hospital's fit from its own records (a capped nudge that can never lift weak or contradicted evidence), and translates server messages that have no reviewed translation. Without it the app falls back to rules and evidence-only ranking. The emergency gate never depends on it.
- Triage into urgency (emergency, urgent, routine) and the type of care needed, plus "possible conditions to discuss with a clinician". Never a definitive diagnosis, never treatment or dosing advice.
- A deterministic emergency gate that runs without any model and without a network; it can only escalate. Emergency numbers: 108 (ambulance), 112 (emergency), Tele-MANAS 14416 for thoughts of self-harm.
- Languages for the first release: English, Hindi, Tamil, Telugu, Malayalam. All interface text exists in all five (draft translations in `web/lib/i18n/`), and every string, including all emergency wording, needs review by a native speaker and a clinician before launch. The emergency gate covers English and Hindi, plus draft phrase stems for Tamil, Telugu and Malayalam (`web/lib/triage/redflags.indic.ts`) that have not been reviewed by native speakers or a clinician and are not complete coverage.
- Recommendations are probabilistic and labelled "evidence-weighted estimate", not calibrated, until manual verification exists. Cost and comfort are proxies and labelled as such; there is no price, rating or live bed data.
- A registry badge appears only for confident matches to the PM-JAY empanelment list, in plain words and with the app's own mark; the State Emblem of India and the PM-JAY / Ayushman Bharat logos are not used. The app states it is not affiliated with the Government of India or the NHA.
- Privacy: location used per request only; no raw transcripts stored by default; voice consent notice.
- Open decisions: product name; traffic provider; whether the registry list may be used beyond validation; Whisper fallback; the source and terms of the registry list.

## Brand Commitments
Binding choices made by the user: a very clean, smooth, Apple-like phone UI in cool tones (no green or rainbow colours, no decorative gradients or glow, no sparkle icons or phrases that read as AI-generated), and it must not look vibecoded. Reference images the user supplied: a frosted-glass mic orb, a Maps-style search bar, a food-delivery category row, and compact health apps. No name, logo or voice has been chosen. The government emblem and scheme logos are off limits.

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

## Demo dashboard
A 4-page Databricks AI/BI dashboard explains the data work for judges: whether raw data can be trusted, one question traced end to end, whether the evidence is right, and a reference page with every cleaning step and its source. See `HANDOFF.md` section 26.

## Handoff
Full project handoff (repository map, data, ranking, status, to-do list): see `HANDOFF.md`.
