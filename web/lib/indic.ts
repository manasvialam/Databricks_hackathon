/**
 * Indian scripts -> Latin letters, so a place typed or spoken in Hindi, Tamil, Telugu or Malayalam can be matched to
 * the English place names the geocoder holds. Approximate on purpose: the output is only ever compared through the
 * loose phonetic key below, never shown to anyone.
 *
 * Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada and Malayalam share one Unicode layout
 * (each block is 0x80 wide and letters sit at the same offsets), so one table covers all of them.
 */

const ZERO_WIDTH = /[​-‍﻿]/g;
export const INDIC = /[ऀ-ൿ]/;
export const hasIndic = (s: string) => INDIC.test(s);

/** Digits written in an Indian script (८००००१, ௬௦௦, ౫౦౦, ൬൮൨) as ASCII, so a PIN code still parses. */
export const asciiDigits = (s: string) =>
  s.replace(/[०-९௦-௯౦-౯൦-൯]/g, (c) => String((c.codePointAt(0)! & 0x7f) - 0x66));

const CONS: Record<number, string> = {
  0x15: "k", 0x16: "kh", 0x17: "g", 0x18: "gh", 0x19: "ng", 0x1a: "ch", 0x1b: "chh", 0x1c: "j", 0x1d: "jh", 0x1e: "ny",
  0x1f: "t", 0x20: "th", 0x21: "d", 0x22: "dh", 0x23: "n", 0x24: "t", 0x25: "th", 0x26: "d", 0x27: "dh", 0x28: "n", 0x29: "n",
  0x2a: "p", 0x2b: "ph", 0x2c: "b", 0x2d: "bh", 0x2e: "m", 0x2f: "y", 0x30: "r", 0x31: "r", 0x32: "l", 0x33: "l", 0x34: "zh",
  0x35: "v", 0x36: "sh", 0x37: "sh", 0x38: "s", 0x39: "h",
};
const DEVANAGARI_NUKTA: Record<number, string> = { 0x58: "k", 0x59: "kh", 0x5a: "g", 0x5b: "z", 0x5c: "r", 0x5d: "rh", 0x5e: "f", 0x5f: "y" };
const MALAYALAM_CHILLU: Record<number, string> = { 0x7a: "n", 0x7b: "n", 0x7c: "r", 0x7d: "l", 0x7e: "l", 0x7f: "k", 0x4e: "r" };
const VOWEL: Record<number, string> = {
  0x05: "a", 0x06: "aa", 0x07: "i", 0x08: "ii", 0x09: "u", 0x0a: "uu", 0x0b: "ri", 0x0c: "li", 0x0d: "e", 0x0e: "e", 0x0f: "e",
  0x10: "ai", 0x11: "o", 0x12: "o", 0x13: "o", 0x14: "au",
};
const SIGN: Record<number, string> = {
  0x3e: "aa", 0x3f: "i", 0x40: "ii", 0x41: "u", 0x42: "uu", 0x43: "ri", 0x44: "ri", 0x45: "e", 0x46: "e", 0x47: "e", 0x48: "ai",
  0x49: "o", 0x4a: "o", 0x4b: "o", 0x4c: "au", 0x56: "ai", 0x57: "u",
};
const NUKTA_SHIFT: Record<string, string> = { j: "z", ph: "f", d: "r", dh: "rh" };

interface Unit { c: string; v: string; inherent: boolean; coda: string }

function word(cps: number[]): string {
  const base = cps[0] & ~0x7f;
  const units: Unit[] = [];
  const last = () => units[units.length - 1];
  for (const cp of cps) {
    const off = cp - (cp & ~0x7f);
    if (base === 0x0900 && DEVANAGARI_NUKTA[off]) units.push({ c: DEVANAGARI_NUKTA[off], v: "a", inherent: true, coda: "" });
    else if (base === 0x0d00 && MALAYALAM_CHILLU[off]) units.push({ c: MALAYALAM_CHILLU[off], v: "", inherent: false, coda: "" });
    else if (CONS[off]) units.push({ c: CONS[off], v: "a", inherent: true, coda: "" });
    else if (VOWEL[off]) units.push({ c: "", v: VOWEL[off], inherent: false, coda: "" });
    else if (SIGN[off] && last()) { last().v = SIGN[off]; last().inherent = false; }
    else if (off === 0x4d && last()) { last().v = ""; last().inherent = false; }                       // virama
    else if (off === 0x3c && last()) last().c = NUKTA_SHIFT[last().c] ?? last().c;                    // nukta
    else if ((off === 0x01 || off === 0x02) && last()) last().coda = "N";                            // anusvara, candrabindu
    else if (off === 0x03 && last()) last().coda = "h";                                              // visarga
    else if (off >= 0x66 && off <= 0x6f) units.push({ c: String(off - 0x66), v: "", inherent: false, coda: "" });
  }
  // Hindi drops the inherent vowel at the end of a word and in V C _ C V positions (पटना is "patna", not "patana").
  // A syllable closed by a nasal (रं in औरंगाबाद) keeps its vowel.
  if (base === 0x0900 && units.length > 1) {
    if (last().inherent && !last().coda) last().v = "";
    for (let i = units.length - 2; i >= 1; i--) {
      const u = units[i], prev = units[i - 1], next = units[i + 1];
      if (u.inherent && !u.coda && u.c && prev.v && !prev.coda && next.c && next.v) u.v = "";
    }
  }
  return units.map((u, i) => {
    let coda = u.coda;
    if (coda === "N") coda = !units[i + 1] || /^[pbm]/.test(units[i + 1].c) ? "m" : "n";
    return u.c + u.v + coda;
  }).join("");
}

/** Lower-case Latin approximation of any text; Latin letters pass through unchanged. */
export function toLatin(s: string): string {
  const t = (s ?? "").normalize("NFC").replace(ZERO_WIDTH, "");
  let out = "", run: number[] = [];
  const flush = () => { if (run.length) { out += word(run); run = []; } };
  for (const ch of t) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x0900 && cp <= 0x0d7f && cp !== 0x0964 && cp !== 0x0965) {
      if (run.length && (run[0] & ~0x7f) !== (cp & ~0x7f)) flush();
      run.push(cp);
    } else { flush(); out += ch.toLowerCase(); }
  }
  flush();
  return out;
}

/**
 * Loose phonetic key: drops aspiration, voicing (Tamil script does not mark it), vowel length, o/u, doubled letters,
 * and the silent endings of anglicised names (Indore, Nellore, Guntur/Gunturu). Used on both sides of a comparison.
 */
export function phon(latin: string): string {
  let x = latin.toLowerCase().replace(/[^a-z]/g, "");
  x = x.replace(/oo/g, "u").replace(/ee/g, "i");
  x = x.replace(/([kgcjtdpb])h/g, "$1").replace(/sh/g, "s").replace(/zh/g, "l");
  x = x.replace(/w/g, "v").replace(/q/g, "k").replace(/f/g, "p").replace(/z/g, "j").replace(/x/g, "ks");
  x = x.replace(/ngng/g, "ng").replace(/ny/g, "n").replace(/y(?=[^aeiou]|$)/g, "i").replace(/o/g, "u");
  x = x.replace(/g/g, "k").replace(/j/g, "c").replace(/d/g, "t").replace(/b/g, "p");
  x = x.replace(/(.)\1+/g, "$1");
  if (x.length > 4) x = x.replace(/([^aeiou])[eu]$/, "$1");
  return x;
}

/**
 * Place names whose spelling in an Indian script does not transliterate to the English name in the data
 * (சேலம் is "chelam", not "Salem"), plus the large cities people are most likely to say. Keys are matched through
 * toLatin + phon, so spelling variants (nukta, anusvara or not, zero-width joiners) collapse to one entry.
 * DRAFT: add names from real usage; native speakers should check the spellings.
 */
const NATIVE_PLACE_NAMES: [string, string][] = [
  // Hindi / Devanagari
  ["दिल्ली", "Delhi"], ["नई दिल्ली", "Delhi"], ["मुंबई", "Mumbai"], ["बम्बई", "Mumbai"], ["कोलकाता", "Kolkata"], ["कलकत्ता", "Kolkata"],
  ["चेन्नई", "Chennai"], ["बेंगलुरु", "Bengaluru"], ["बंगलौर", "Bengaluru"], ["बैंगलोर", "Bengaluru"], ["हैदराबाद", "Hyderabad"],
  ["पुणे", "Pune"], ["अहमदाबाद", "Ahmedabad"], ["लखनऊ", "Lucknow"], ["पटना", "Patna"], ["जयपुर", "Jaipur"], ["भोपाल", "Bhopal"],
  ["इंदौर", "Indore"], ["कानपुर", "Kanpur"], ["वाराणसी", "Varanasi"], ["बनारस", "Varanasi"], ["प्रयागराज", "Prayagraj"],
  ["इलाहाबाद", "Prayagraj"], ["आगरा", "Agra"], ["गुरुग्राम", "Gurugram"], ["गुड़गांव", "Gurugram"], ["नोएडा", "Noida"],
  ["गाज़ियाबाद", "Ghaziabad"], ["चंडीगढ़", "Chandigarh"], ["देहरादून", "Dehradun"], ["रांची", "Ranchi"], ["रायपुर", "Raipur"],
  ["नागपुर", "Nagpur"], ["गया", "Gaya"], ["मुज़फ़्फ़रपुर", "Muzaffarpur"], ["दरभंगा", "Darbhanga"], ["भागलपुर", "Bhagalpur"],
  ["गोरखपुर", "Gorakhpur"], ["मेरठ", "Meerut"], ["ग्वालियर", "Gwalior"], ["जबलपुर", "Jabalpur"], ["उदयपुर", "Udaipur"],
  ["जोधपुर", "Jodhpur"], ["कोटा", "Kota"], ["अजमेर", "Ajmer"], ["अमृतसर", "Amritsar"], ["लुधियाना", "Ludhiana"], ["शिमला", "Shimla"],
  ["भुवनेश्वर", "Bhubaneswar"], ["गुवाहाटी", "Guwahati"], ["सूरत", "Surat"], ["वडोदरा", "Vadodara"], ["बरेली", "Bareilly"],
  ["अलीगढ़", "Aligarh"], ["झांसी", "Jhansi"], ["जम्मू", "Jammu"], ["श्रीनगर", "Srinagar"],
  // Tamil
  ["சென்னை", "Chennai"], ["மதுரை", "Madurai"], ["கோயம்புத்தூர்", "Coimbatore"], ["கோவை", "Coimbatore"], ["திருச்சி", "Tiruchirappalli"],
  ["திருச்சிராப்பள்ளி", "Tiruchirappalli"], ["சேலம்", "Salem"], ["திருநெல்வேலி", "Tirunelveli"], ["நெல்லை", "Tirunelveli"],
  ["வேலூர்", "Vellore"], ["தஞ்சாவூர்", "Thanjavur"], ["தஞ்சை", "Thanjavur"], ["ஈரோடு", "Erode"], ["திருப்பூர்", "Tiruppur"],
  ["தூத்துக்குடி", "Tuticorin"], ["நாகர்கோவில்", "Nagercoil"], ["கன்னியாகுமரி", "Kanniyakumari"], ["காஞ்சிபுரம்", "Kanchipuram"],
  ["கடலூர்", "Cuddalore"], ["திண்டுக்கல்", "Dindigul"], ["கரூர்", "Karur"], ["ராமநாதபுரம்", "Ramanathapuram"],
  ["விழுப்புரம்", "Villupuram"], ["புதுச்சேரி", "Puducherry"], ["பாண்டிச்சேரி", "Puducherry"], ["ஓசூர்", "Hosur"],
  ["கும்பகோணம்", "Kumbakonam"], ["நாகப்பட்டினம்", "Nagapattinam"], ["டெல்லி", "Delhi"], ["தில்லி", "Delhi"], ["மும்பை", "Mumbai"],
  ["கொல்கத்தா", "Kolkata"], ["பெங்களூரு", "Bengaluru"], ["பெங்களூர்", "Bengaluru"], ["ஹைதராபாத்", "Hyderabad"], ["கொச்சி", "Kochi"],
  ["திருவனந்தபுரம்", "Thiruvananthapuram"],
  // Telugu
  ["హైదరాబాద్", "Hyderabad"], ["సికింద్రాబాద్", "Hyderabad"], ["విజయవాడ", "Vijayawada"], ["విశాఖపట్నం", "Visakhapatnam"],
  ["వైజాగ్", "Visakhapatnam"], ["గుంటూరు", "Guntur"], ["వరంగల్", "Warangal"], ["తిరుపతి", "Tirupati"], ["నెల్లూరు", "Nellore"],
  ["కర్నూలు", "Kurnool"], ["కాకినాడ", "Kakinada"], ["రాజమండ్రి", "Rajahmundry"], ["రాజమహేంద్రవరం", "Rajahmundry"],
  ["అనంతపురం", "Anantapur"], ["కడప", "Cuddapah"], ["ఒంగోలు", "Ongole"], ["ఖమ్మం", "Khammam"], ["కరీంనగర్", "Karimnagar"],
  ["నిజామాబాద్", "Nizamabad"], ["ఏలూరు", "Eluru"], ["శ్రీకాకుళం", "Srikakulam"], ["విజయనగరం", "Vizianagaram"],
  ["మహబూబ్‌నగర్", "Mahabubnagar"], ["నల్గొండ", "Nalgonda"], ["చిత్తూరు", "Chittoor"], ["ఢిల్లీ", "Delhi"], ["ముంబై", "Mumbai"],
  ["కోల్‌కతా", "Kolkata"], ["చెన్నై", "Chennai"], ["బెంగళూరు", "Bengaluru"],
  // Malayalam
  ["കൊച്ചി", "Kochi"], ["എറണാകുളം", "Ernakulam"], ["തിരുവനന്തപുരം", "Thiruvananthapuram"], ["കോഴിക്കോട്", "Kozhikode"],
  ["തൃശ്ശൂർ", "Thrissur"], ["തൃശൂർ", "Thrissur"], ["കൊല്ലം", "Kollam"], ["കണ്ണൂർ", "Kannur"], ["ആലപ്പുഴ", "Alappuzha"],
  ["പാലക്കാട്", "Palakkad"], ["കോട്ടയം", "Kottayam"], ["മലപ്പുറം", "Malappuram"], ["പത്തനംതിട്ട", "Pathanamthitta"],
  ["ഇടുക്കി", "Idukki"], ["വയനാട്", "Wayanad"], ["കാസർഗോഡ്", "Kasaragod"], ["കാസർകോട്", "Kasaragod"], ["ഡൽഹി", "Delhi"],
  ["മുംബൈ", "Mumbai"], ["ചെന്നൈ", "Chennai"], ["ബെംഗളൂരു", "Bengaluru"], ["ബാംഗ്ലൂർ", "Bengaluru"], ["ഹൈദരാബാദ്", "Hyderabad"],
  ["മംഗലാപുരം", "Mangaluru"], ["കോയമ്പത്തൂർ", "Coimbatore"],
];

let nativeIndex: Map<string, string> | null = null;
/** English place name for a name written in an Indian script, if it is one we know. */
export function nativePlace(s: string): string | null {
  nativeIndex ??= new Map(NATIVE_PLACE_NAMES.map(([n, en]) => [phon(toLatin(n)), en]));
  return nativeIndex.get(phon(toLatin(s.trim()))) ?? null;
}
export const NATIVE_PLACE_TARGETS = [...new Set(NATIVE_PLACE_NAMES.map(([, en]) => en))];

// ---------- place phrases inside a sentence -------------------------------------------------------------------------
// Hindi puts the place before a postposition ("पटना में", "पटना के पास"). Tamil, Telugu and Malayalam attach a case
// ending to the place ("சென்னையில்", "హైదరాబాద్‌లో", "കൊച്ചിയിൽ") or follow it with a word for "near".
const NEAR_AFTER = [
  "के पास", "के नज़दीक", "के नजदीक", "के करीब", "में", "से",
  "அருகில்", "அருகே", "பக்கத்தில்", "பக்கம்",
  "దగ్గర", "దగ్గరలో", "సమీపంలో",
  "അടുത്ത്", "സമീപം", "അടുത്തുള്ള",
];
// [ending, replacement]; longest first. A replacement of "்"/"്" restores the vowel-less final consonant.
const ENDINGS: [string, string][] = [
  // Tamil
  ["த்திலிருந்து", "ம்"], ["த்துக்கு", "ம்"], ["த்தில்", "ம்"], ["யிலிருந்து", ""], ["விலிருந்து", ""], ["ிலிருந்து", "்"],
  ["யில்", ""], ["வில்", ""], ["ில்", "்"], ["ுக்கு", "்"], ["க்கு", ""],
  // Telugu
  ["నుండి", ""], ["లోని", ""], ["లో", ""], ["కి", ""], ["కు", ""],
  // Malayalam
  ["ത്തിലേക്ക്", "ം"], ["ത്തിൽ", "ം"], ["ത്ത്", "ം"], ["യിലേക്ക്", ""], ["ിലേക്ക്", "്"], ["യിൽ", ""], ["ിൽ", "്"],
  ["യ്ക്ക്", ""], ["ക്ക്", ""],
];

const clean = (s: string) => s.normalize("NFC").replace(ZERO_WIDTH, "");
const strip = (w: string): string | null => {
  for (const [end, rep] of ENDINGS) if (w.length > end.length + 1 && w.endsWith(end)) return w.slice(0, -end.length) + rep;
  return null;
};

/** Place phrases in an Indian-script sentence, most specific first. Callers must match these strictly. */
export function indicPlaceCandidates(text: string): string[] {
  const t = clean(text);
  const words = t.split(/[\s,.;:!?।]+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!hasIndic(w)) continue;
    const rest = words.slice(i + 1, i + 3).join(" ");
    const nearNext = NEAR_AFTER.some((n) => rest === n || rest.startsWith(`${n} `));
    const stripped = strip(w);
    // the whole word goes first: some place names end like a case ending (நாகர்கோவில், Nagercoil)
    if (nearNext) {
      out.push(w);
      if (stripped) out.push(stripped);
      if (i > 0 && hasIndic(words[i - 1])) out.push(`${words[i - 1]} ${w}`);
    } else if (stripped) out.push(w, stripped);
  }
  return [...new Set(out)];
}
