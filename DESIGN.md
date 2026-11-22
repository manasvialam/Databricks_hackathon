---
name: Hospital Referral Slip (name undecided)
description: A highway-board referral slip for patients on phones. Solid white sign panels on board green, yellow only for doubt, glass only on floating chrome.
colors:
  board: "#0b5d3b"
  board-deep: "#073f28"
  board-glow: "#0f7a4e"
  panel: "#ffffff"
  paper: "#f3f6f4"
  ink: "#13201a"
  ink-2: "#455750"
  line: "#d5dfd9"
  signal: "#ffc20e"
  signal-ink: "#4a3500"
  signal-bg: "#fff6d6"
  facility: "#0b63cc"
  facility-bg: "#e6f0fc"
  facility-ink: "#08458f"
  emergency: "#c8102e"
  emergency-ink: "#ffffff"
typography:
  display:
    fontFamily: "Atkinson Hyperlegible, Nirmala UI, Noto Sans Devanagari, Noto Sans Tamil, Noto Sans Telugu, Noto Sans Malayalam, system-ui, sans-serif"
    fontSize: "58px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Atkinson Hyperlegible, Nirmala UI, Noto Sans Devanagari, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Atkinson Hyperlegible, Nirmala UI, Noto Sans Devanagari, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Atkinson Hyperlegible, Nirmala UI, Noto Sans Devanagari, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Atkinson Hyperlegible, Nirmala UI, Noto Sans Devanagari, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.45
rounded:
  sheet: "24px"
  panel: "18px"
  button: "16px"
  row: "14px"
  quote: "12px"
  pill: "999px"
spacing:
  gutter: "16px"
  stack: "14px"
  tight: "8px"
  panel-pad: "22px 20px"
components:
  button-primary:
    backgroundColor: "{colors.board}"
    textColor: "{colors.panel}"
    rounded: "{rounded.button}"
    padding: "12px 18px"
    height: "56px"
  button-primary-hover:
    backgroundColor: "{colors.board-deep}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.board}"
    rounded: "{rounded.button}"
    padding: "12px 18px"
    height: "56px"
  button-secondary-hover:
    backgroundColor: "{colors.paper}"
  button-text:
    textColor: "{colors.facility}"
    height: "44px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "22px 20px"
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
  chip-registry:
    backgroundColor: "{colors.facility-bg}"
    textColor: "{colors.facility-ink}"
    rounded: "{rounded.pill}"
  chip-tag:
    backgroundColor: "{colors.board}"
    textColor: "{colors.panel}"
    rounded: "{rounded.pill}"
  chip-warn:
    backgroundColor: "{colors.signal-bg}"
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.pill}"
  caution:
    backgroundColor: "{colors.signal-bg}"
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.quote}"
    padding: "10px 12px"
  quote:
    backgroundColor: "{colors.facility-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.quote}"
    padding: "12px 14px"
  list-item:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.row}"
    padding: "12px 14px"
    height: "56px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.row}"
    padding: "10px 14px"
    height: "56px"
  emergency-card:
    backgroundColor: "{colors.emergency}"
    textColor: "{colors.emergency-ink}"
    rounded: "{rounded.panel}"
    padding: "22px 20px"
  emergency-call:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.emergency}"
    rounded: "{rounded.button}"
    padding: "14px 18px"
    height: "68px"
  sheet:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "22px 20px"
---

# Design System: Hospital Referral Slip (name undecided)

## Overview

**Creative North Star: "The Highway Board"**

The interface borrows India's highway wayfinding boards: a deep green ground, white sign panels that carry the real information, and a small set of signal colors that each mean one thing. A frightened person on a low-end phone should read it the way a driver reads a gantry sign, at a glance and from a distance. One answer, the referral slip, owns the screen; it is a solid white panel with a hospital name, two large numerals (kilometres, minutes), a road bar, and Call and Directions buttons.

Material is split on purpose. Clinical content (the slip, evidence quotes, the "why" sheet) sits on opaque white. Glisse glass, forced to `data-theme="dark"`, appears only on the floating top strip and the bottom composer with its mic. Density is generous: 18px body, 56px minimum touch targets, 600px single column.

Color carries meaning, not decoration. Yellow means doubt, blue means a facility or registry fact, red means emergency only, green is the board itself and the primary action.

**Key Characteristics:**
- Opaque white panels on a board-green ground, with a faint inset green keyline on each panel.
- Glass is reserved for floating chrome; panel buttons are solid and outlined.
- Single typeface family (Atkinson Hyperlegible) with system Indic fonts as the fallback chain; hierarchy by size and weight 700 only.
- Large tabular numerals for distance and time.
- The road bar is the one signature graphic.

## Colors

A saturated board green with white, one amber warning, one blue for facts, one red held back for emergencies. Neutrals are green-tinted.

### Primary
- **Board Green** (`#0b5d3b`): the page ground, primary buttons, button outlines, tag chips, the free-flow segment of the road bar, filled meter pips.
- **Board Deep** (`#073f28`): primary button hover, the opaque fallback behind glass when transparency is reduced or unsupported.
- **Board Glow** (`#0f7a4e`): only the radial highlight at the top of the page ground.

### Secondary
- **Signal Yellow** (`#ffc20e`): doubt and delay only: the hatched traffic-delay segment, the low-confidence meter pip, the focus ring, the live-mic pulse. Text on yellow surfaces uses Signal Ink (`#4a3500`) over Signal Wash (`#fff6d6`).
- **Facility Blue** (`#0b63cc`): links and text buttons. Facility Wash (`#e6f0fc`) backs the evidence quote and registry chips, with Facility Ink (`#08458f`) as chip text.

### Tertiary
- **Emergency Red** (`#c8102e`): the emergency card ground and the call-number text on its white buttons. Nothing else is red.

### Neutral
- **Panel White** (`#ffffff`): slip, sheet, input and secondary-button surfaces.
- **Paper** (`#f3f6f4`): list rows, chips, road track, bar track.
- **Ink** (`#13201a`) and **Ink 2** (`#455750`): primary and secondary text on white.
- **Line** (`#d5dfd9`): hairlines, input borders, dashed section dividers.

### Named Rules
**The One Meaning Rule.** Every signal color has a single job (yellow doubt, blue fact, red emergency). A color is never borrowed for emphasis.
**The Red Is Reserved Rule.** Emergency red appears only in the emergency card and its call buttons.
**The Contrast On Board Rule.** Text placed directly on the green ground is white (or the pale green `#d6efe3` for footers) and carries a faint text-shadow; clinical text never sits directly on green.

## Typography

**Display Font:** Atkinson Hyperlegible (weights 400 and 700, bundled via fontsource), falling back through Nirmala UI, Noto Sans Devanagari/Tamil/Telugu/Malayalam, Kohinoor and Sangam system fonts, then system-ui.
**Body Font:** same family.

**Character:** One legibility-first family for all roles; there is no display/body pairing. Indic scripts render in installed system fonts, so their metrics differ from Latin and get extra line height.

### Hierarchy
- **Display** (700, 58px, 1.0, -0.03em; 48px under 381px width): the kilometre and minute numerals, tabular figures, with a 20px unit in Ink 2.
- **Headline** (700, 30px, 1.12): page prompt and emergency heading (`.h1`, `.emerg h1`).
- **Title** (700, 28px, 1.12; 32px from 760px width): the hospital name on the slip.
- **Heading** (700, 21px, 1.2 for sheet titles; 17px for slip section headings): `.h2`, `.section h3`.
- **Body** (400, 18px, 1.45): default text. Secondary text 15 to 16px in Ink 2; captions and legends 14px.
- **Label** (700, 14px): chips only. Labels are sentence case, never uppercase, with no tracking.

### Named Rules
**The Script Safety Rule.** For `hi`, `ta`, `te`, `ml`, letter-spacing resets to 0 and line height rises (1.4 on headings; 1.55 to 1.6 on body). Negative tracking is Latin-only.
**The Weight Pair Rule.** Only 400 and 700 exist. Hierarchy comes from size and weight, not from additional fonts or weights.

## Layout

A single centered column, max 600px, 16px side gutters, 14px grid gap between stacked blocks. The shell reserves 84px at the top (104px from 760px width) for the glass strip and 150px at the bottom for the composer, plus safe-area insets, so content never hides under floating chrome. Actions sit in a two-column grid of 56px-tall buttons, with a full-width variant for single actions. Within the slip, sections are separated by dashed Line rules with 18px top padding. Sheets rise from the bottom, max 640px wide and 88dvh tall. Designed against a 390 by 844 phone; there is one breakpoint pair (under 381px shrinks numerals and headline; from 760px grows the name and top offset).

## Elevation & Depth

Depth is a hybrid. Floating chrome (strip, composer) is Glisse glass on a dark theme, over the green ground. Solid panels sit slightly lifted by a long soft shadow, and the sheet is separated from the page by a dark green scrim (`rgba(5,30,20,.62)`) instead of a shadow.

### Shadow Vocabulary
- **Panel lift** (`box-shadow: 0 14px 30px -14px rgba(0,0,0,.45)`): the soft, offset-down shadow under the slip and emergency card.
- **Live pulse** (`box-shadow: 0 0 0 14px rgba(255,194,14,0)` animating from `0 0 0 0 rgba(255,194,14,.7)`): the mic ring while listening only.

### Named Rules
**The Glass Is Chrome Rule.** Glass appears on the top strip, the composer and its mic only. Slips, quotes, cautions, panel buttons and sheets are opaque. When transparency is reduced or unsupported the chrome falls back to solid board green.

## Shapes

Generously rounded, nested radii: 24px sheet top corners, 18px panels, 16px buttons, 14px list rows and inputs, 12px quotes and cautions, 999px for chips and the strip, 32px for the composer. Panels carry a 2px inset green keyline at 16% opacity, 6px inside the edge, echoing the border line on a road sign. The road bar is a 14px-tall rounded track.

## Components

### Buttons
- **Shape:** 16px radius, 56px minimum height, 18px bold label, icons 20px from lucide.
- **Primary:** Board Green fill, white text, 2px Board Green border. Hover to Board Deep.
- **Secondary:** white fill, Board Green text and 2px Board Green border. Hover to Paper.
- **Text button:** no fill, Facility Blue underlined text, 44px minimum height (also the sheet close button).
- **Disabled:** 45 to 50% opacity; a missing phone number renders as a disabled-looking secondary with an explanatory line beneath.
- **Mic:** Glisse filled button, white tint, 64px square, board-green icon.

### Chips
- **Style:** pill, 14px bold, 1px border. Neutral (ownership, open 24h), board green (ranking tags), blue wash (registry listed, accreditation), yellow wash with warning icon (registry match only possible).

### Cards / Containers
- **Slip panel:** white, 18px radius, 22px/20px padding, green keyline, panel lift. Contents in order: chips, hospital name, place line, two numerals, road bar, confidence meter, actions, evidence, door script, why and read-aloud actions.
- **Evidence quote:** Facility Wash, 12px radius, quoted facility text with source host linked beneath.
- **Caution:** Signal Wash with Signal Ink text and a warning icon.
- **Alternative row:** white 14px-radius button on the green ground with name, minutes and a small sub-line.

### Inputs / Fields
- **Style:** 56px high, 2px Line border, white fill, 14px radius. **Focus:** border to Board Green. Global focus ring is a 3px Signal Yellow outline with 3px offset. Composer text input is white on glass.
- Preferences use Glisse SegmentedControl and Slider inside the sheet.

### Emergency card
Red 18px-radius card, 30px white heading, large white call buttons (68px high, 26px bold red numbers with a 16px descriptor), then step text. It replaces the slip entirely when the red-flag gate fires.

### Navigation
A glass top strip (pill, 580px max) holds the product title and language menu; there is no other navigation.

### The Road Bar (signature)
A 14px track in Paper. A solid Board Green segment is free-flow minutes; a 135-degree hatch of Signal Yellow and near-black marks traffic delay; a white-haloed ink bracket with a dotted white center line spans the likely range (low to high). A legend below names each in 14px text. The bar is exposed to assistive tech as an image labelled with minutes and range.

### Confidence meter
Three 18 by 8px pips, filled Board Green (high 3, mid 2), or a single Signal Yellow pip with a brown inset ring (low), always next to a bold plain-language "how sure" sentence.

## Do's and Don'ts

### Do:
- **Do** keep clinical content on opaque Panel White and reserve Glisse glass (`data-theme="dark"`) for the top strip, composer and mic.
- **Do** use Signal Yellow only for doubt or delay, Facility Blue only for facts about a facility, and Emergency Red only for emergencies.
- **Do** keep touch targets at 56px (44px minimum for text buttons and strip controls) and body text at 18px.
- **Do** show the road bar, confidence meter and quoted evidence with source on any recommendation.
- **Do** reset letter-spacing and raise line height for Indic scripts.
- **Do** pair every signal color with an icon or words; color is never the only carrier.

### Don't:
- **Don't** put text directly on the green ground unless it is white with the board text-shadow.
- **Don't** add decorative colors, extra typefaces or weights beyond 400 and 700.
- **Don't** use glass for panels, buttons inside panels, or sheets.
- **Don't** render government emblems or scheme logos.
- **Don't** let the slip become one of many identical chat cards; one slip owns the screen and alternatives stay compact.
