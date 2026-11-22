"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Ambulance, ArrowUp, Baby, BadgeCheck, BedDouble, ChevronDown, ChevronLeft, ChevronRight, Droplets, Globe, HeartPulse, Info, MapPin, Mic, Pause, Phone, Play, Ribbon, Search, SkipBack, SkipForward, SlidersHorizontal, Square, Volume2, X } from "lucide-react";
import { LANGS, hasKey, isLang, say, speechLang, svcPlain, t, type Lang } from "@/lib/i18n";
import { checkRedFlags, type RedFlagResult } from "@/lib/triage/redflags";
import { PERSONA_BY_ID } from "@/lib/preferences";
import type { Preferences, ServiceId, Urgency } from "@/lib/types";
import type { RecommendResponse } from "@/lib/recommend";
import type { NearbyHospital, NearbyService } from "@/lib/nearby";
import { SERVICES } from "@/lib/services";
import { canListen, listen, onTalking, speak, stopSpeaking, type Listener } from "@/lib/client/speech";
import { LiveBars, MicButton, VoicePill, type VoiceState } from "./Voice";
import { HelperFace, type Mood } from "./Helper";
import { useReadAlong } from "@/lib/client/readalong";
import { useHistorySync, type NavEntry } from "@/lib/client/nav";
import { ASSISTANT_PREFIX } from "@/lib/triage/history";
import { Slip, svcLabel } from "./Slip";
import { EmergencyCard, HospitalWhySheet, LangSheet, LocSheet, PrefSheet, WhySheet, type CardAnswer, type PlaceChoice } from "./Sheets";
import { HospitalCard, HospitalList } from "./Hospitals";
import { Tx } from "./Tx";
import { Name } from "./Name";
import { MOCK_CURRENT_LOCATION, MOCK_LOCATION_ON } from "@/lib/places";
import { MapSheet, type MapTarget } from "./MapSheet";
import { Shade } from "./Shade";
import { specLabel } from "@/lib/specialty";

interface Loc { lat: number; lon: number; label: string | null; current?: boolean }
interface Candidate { label: string; state: string; district: string; lat: number; lon: number }
type View = "idle" | "loading" | "result" | "pickcare" | "needplace" | "error" | "chat";

async function api<T>(url: string, body?: unknown): Promise<T> {
  let res: Response;
  try { res = await send(url, body); } catch { await new Promise((r) => setTimeout(r, 500)); res = await send(url, body); }   // a dropped connection is retried once
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error ?? "error"), { data, status: res.status });
  return data as T;
}
function send(url: string, body?: unknown): Promise<Response> {
  return fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

}

const safeGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

export function App() {
  const [lang, setLang] = useState<Lang>("en");
  const ra = useReadAlong(lang);
  const [slow, setSlow] = useState(false);
  const [loc, setLoc] = useState<Loc | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [, setNearby] = useState<NearbyService[]>([]);
  const [hospitals, setHospitals] = useState<NearbyHospital[]>([]);
  const hospitalsRef = useRef(hospitals); hospitalsRef.current = hospitals;
  const shownRef = useRef<NearbyHospital[]>([]);                  // the list on screen: the nearby list, or the specialty-ranked one for a typed need
  const [text, setText] = useState("");
  const [thread, setThread] = useState<{ role: "user" | "assistant"; text: string; note?: boolean }[]>([]);
  const [thinking, setThinking] = useState(false);
  const [view, setView] = useState<View>("idle");
  const [gate, setGate] = useState<RedFlagResult | null>(null);
  const [rec, setRec] = useState<RecommendResponse | null>(null);
  const [sel, setSel] = useState(0);
  const [online, setOnline] = useState(true);
  const [listening, setListening] = useState(false);
  const [talking, setTalking] = useState(false);              // speak() is talking (the read-along has its own state)
  const [voiceThinking, setVoiceThinking] = useState(false);   // a question asked by voice is being answered
  const viaVoice = useRef(false);                              // the current question was spoken, so the answer is spoken back
  const [caption, setCaption] = useState("");
  const [sheet, setSheet] = useState<null | "why" | "prefs" | "lang" | "loc" | "hwhy" | "map">(null);
  const [mapTarget, setMapTarget] = useState<MapTarget | null>(null);
  const [needHospitals, setNeedHospitals] = useState<NearbyHospital[]>([]);
  const [needBusy, setNeedBusy] = useState(false);
  const [needQuery, setNeedQuery] = useState<{ sp: string[]; n: number } | null>(null);   // a new search every time: n changes, so nothing is reused from an earlier one
  const [hMode, setHMode] = useState<"browse" | "need">("need");   // "browse": a hospital opened from the nearby list; "need": the person described a problem
  const [recent, setRecent] = useState<PlaceChoice[]>([]);
  const [scrolled, setScrolled] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [careNote, setCareNote] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(PERSONA_BY_ID.everyone.weights);
  const [prefsTouched, setPrefsTouched] = useState(false);
  const [card, setCard] = useState<CardAnswer>("unknown");
  const [canMic, setCanMic] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const said = thread.find((m) => m.role === "user")?.text ?? null;      // the first thing the person said: used on the hospital card
  const history = useRef<string[]>([]);
  const stayNoted = useRef(false);               // "the emergency advice stays" is said once per conversation
  const asked = useRef(0);                      // follow-up questions asked in this conversation: at most 2
  const need = useRef<string | null>(null);
  const [confirm, setConfirm] = useState<{ loc: Loc; text: string; place: string } | null>(null);
  const [askText, setAskText] = useState<string | null>(null);
  const pending = useRef<{ services: ServiceId[]; urgency: Urgency } | null>(null);
  const last = useRef<{ services: ServiceId[]; urgency: Urgency } | null>(null);
  const listener = useRef<Listener | null>(null);
  const locRef = useRef<Loc | null>(null);
  locRef.current = loc;

  useEffect(() => {
    // a saved choice wins; otherwise start in the phone's own language when it is one of ours
    const saved = safeGet("lang");
    const phone = (navigator.languages ?? [navigator.language]).map((l) => l.toLowerCase().split("-")[0]).find(isLang);
    if (isLang(saved)) setLang(saved); else if (phone) setLang(phone);
    setCanMic(canListen());
    if (MOCK_LOCATION_ON) setLoc((l) => l ?? MOCK_CURRENT_LOCATION);      // the current location is assumed until the person picks another place
    try { const r = JSON.parse(safeGet("recentLocs") ?? "[]"); if (Array.isArray(r)) setRecent(r.filter((x) => x && typeof x.label === "string" && Number.isFinite(x.lat) && Number.isFinite(x.lon)).slice(0, 3)); } catch { /* no recent places */ }
    setOnline(navigator.onLine);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  useEffect(() => { document.documentElement.lang = lang; document.title = t(lang, "appTitle"); }, [lang]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const chooseLang = useCallback((l: Lang) => {
    listener.current?.stop(); stopSpeaking(); ra.stop(); setNotice(null);
    setLang(l); safeSet("lang", l);
  }, []);

  // services available near the person, before they say anything
  useEffect(() => {
    if (!loc) { setNearby([]); setHospitals([]); return; }
    let live = true;
    api<{ services: NearbyService[]; hospitals: NearbyHospital[] }>(`/api/nearby?lat=${loc.lat}&lon=${loc.lon}`)
      .then((d) => { if (live) { setNearby(d.services); setHospitals(d.hospitals ?? []); } })
      .catch(() => { if (live) { setNearby([]); setHospitals([]); } });
    return () => { live = false; };
  }, [loc]);

  const fitHospitalsRef = useRef<(t: string, b: NearbyHospital[]) => Promise<NearbyHospital[] | null>>(async () => null);
  // needs that map to no service (leg pain, fever, rash): hospitals ranked by the specialties the need points to
  useEffect(() => {
    if (!needQuery || !loc) return;
    let live = true;
    setNeedBusy(true);
    api<{ hospitals: NearbyHospital[] }>(`/api/nearby?lat=${loc.lat}&lon=${loc.lon}&sp=${needQuery.sp.join(",")}&n=${needQuery.n}`)
      .then(async (d) => {
        const list = d.hospitals ?? [];
        if (!live) return;
        setNeedHospitals(list);
        const fitted = await fitHospitalsRef.current(need.current ?? "", list);       // model refinement; nothing changes when it is off or fails
        if (live && fitted) { setNeedHospitals(fitted); setSel(0); }
      })
      .catch(() => { if (live) setNeedHospitals([]); })
      .finally(() => { if (live) setNeedBusy(false); });
    return () => { live = false; };
  }, [needQuery, loc]);

  const fetchRec = useCallback(async (services: ServiceId[], urgency: Urgency, at: Loc, p = prefs, c = card, touched = prefsTouched) => {
    last.current = { services, urgency };
    setView("loading"); setErrMsg(null);
    try {
      const body: Record<string, unknown> = { services, urgency, location: at, card: c };
      if (touched) body.preferences = p;
      if (need.current) body.need = need.current;
      const data = await api<RecommendResponse>("/api/recommend", body);
      setRec(data); setSel(0); setView("result"); window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      // server messages are English; show our own sentence in the person's language
      setErrMsg(t(lang, (e as { status?: number }).status === 422 ? "outsideIndia" : "error"));
      setView("error");
    }
  }, [prefs, card, prefsTouched, lang]);

  const applyLocation = useCallback((l: Loc) => {
    setLoc(l); setLocMsg(null); setCandidates([]); setConfirm(null); setSheet((s) => (s === "loc" ? null : s));
    if (l.label && !l.current) setRecent((r) => { const n = [{ label: l.label as string, lat: l.lat, lon: l.lon }, ...r.filter((x) => x.label !== l.label)].slice(0, 3); safeSet("recentLocs", JSON.stringify(n)); return n; });
    if (pending.current) { const p = pending.current; pending.current = null; void fetchRec(p.services, p.urgency, l); }
  }, [fetchRec]);

  /** Every place goes through a confirmation: the model asks "is this where you are?" in the person's language (a reviewed sentence
   *  shows first and is replaced when the model answers), and the place itself is always shown exactly as the geocoder found it. */
  const askConfirm = useCallback(async (l: Loc) => {
    const place = l.label ?? t(lang, "currentLocation");
    setConfirm({ loc: l, text: t(lang, "confirmQ"), place });
    setSheet("loc");
    try {
      const r = await api<{ text: string }>("/api/assist", { kind: "confirm", lang, place });
      setConfirm((c) => (c && c.loc === l ? { ...c, text: r.text } : c));
    } catch { /* the reviewed sentence stays */ }
  }, [lang]);
  const setLocation = useCallback((l: Loc) => { setLocMsg(null); setCandidates([]); void askConfirm(l); }, [askConfirm]);

  /** The model asks where the person is, mentioning the care they need. */
  const loadAsk = useCallback(() => {
    setAskText(t(lang, "chooseWhereHint"));
    const say = (text: string) => { setAskText(text); if (viaVoice.current) speak(text, speechLang(lang), true); };
    api<{ text: string }>("/api/assist", { kind: "ask", lang, need: need.current }).then((r) => say(r.text)).catch(() => say(t(lang, "chooseWhereHint")));
  }, [lang]);

  const useDevice = useCallback(() => {
    if (MOCK_LOCATION_ON) { applyLocation(MOCK_CURRENT_LOCATION); return; }       // the mock current location needs no question
    if (!navigator.geolocation) { setLocMsg(t(lang, "locDenied")); return; }
    setLocBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        let label: string | null = null;
        try { const g = await api<{ status: string; label?: string }>(`/api/geocode?lat=${lat}&lon=${lon}`); if (g.status === "ok") label = g.label ?? null; } catch { /* confirm without a name */ }
        setLocBusy(false); setLocation({ lat, lon, label });
      },
      () => { setLocBusy(false); setLocMsg(t(lang, "locDenied")); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }, [lang, setLocation, applyLocation]);

  const lookupPlace = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLocBusy(true); setLocMsg(null);
    try {
      const g = await api<{ status: string; lat?: number; lon?: number; matched?: string; message?: string; candidates?: Candidate[] }>(`/api/geocode?q=${encodeURIComponent(q.trim())}`);
      if (g.status === "ok" && g.lat != null && g.lon != null) setLocation({ lat: g.lat, lon: g.lon, label: g.matched ?? q });
      else if (g.status === "ambiguous") { setCandidates(g.candidates ?? []); setLocMsg(t(lang, "whichState")); }
      else setLocMsg(t(lang, "placeNotFound"));
    } catch { setLocMsg(t(lang, "error")); }
    setLocBusy(false);
  }, [lang, setLocation]);

  /** The model scores the nearest of these hospitals against what the person described and refines the order. Specialty matches always stay
   *  ahead of non-matches (the specialty search is the evidence-based part); the model only reorders inside each group. */
  const fitHospitals = useCallback(async (needText: string, base: NearbyHospital[]): Promise<NearbyHospital[] | null> => {
    if (!needText || base.length < 2) return null;
    try {
      const r = await api<{ fits: Record<string, { fit: number; why: string }> }>("/api/hospital-fit", { need: needText, ids: base.slice(0, 8).map((h) => h.id) });
      if (!Object.keys(r.fits).length) return null;
      const head = base.slice(0, 8).map((h, i) => ({ h: { ...h, fit: r.fits[h.id]?.fit, fitWhy: r.fits[h.id]?.why ? { k: "whyFitGeneric" as const, text: r.fits[h.id].why } : undefined }, i }));
      head.sort((a, b) => (Number(b.h.matched.length > 0) - Number(a.h.matched.length > 0)) || (Math.round((b.h.fit ?? 0) * 5) - Math.round((a.h.fit ?? 0) * 5)) || a.i - b.i);   // fit in steps of 0.2, nearest first within a step
      return [...head.map((x) => x.h), ...base.slice(8)];
    } catch { return null; }
  }, []);

  const viewRef = useRef<View>("idle"); viewRef.current = view;
  const selRef = useRef(0); selRef.current = sel;

  /** The hospital on screen right now, with the care it was chosen for (null on the home screen). */
  const currentChoice = () => {
    const r = recRef.current, i = selRef.current;
    if (viewRef.current === "result" && r?.results[i]) return { id: r.results[i].id, services: r.services.map((s) => s.id) as ServiceId[] };
    if (viewRef.current === "pickcare" && shownRef.current[i]) return { id: shownRef.current[i].id, services: shownRef.current[i].services };
    return null;
  };
  /** When the person spoke, every reply is spoken back as well as shown (in order, after anything already being said). */
  const speakReply = (text: string) => { if (viaVoice.current && !speak(text, speechLang(lang), true)) setNotice(t(lang, "ttsUnavailable")); };
  const endVoiceTurn = () => { viaVoice.current = false; setVoiceThinking(false); };
  const addAssistant = (text: string, note = false) => {
    setThread((th) => [...th, { role: "assistant", text, note }]);
    history.current = [...history.current, ASSISTANT_PREFIX + text].slice(-8);
    speakReply(text);
  };

  fitHospitalsRef.current = fitHospitals;

  const run = useCallback(async (raw: string, voice = false) => {
    const msg = raw.trim();
    if (!msg) return;
    viaVoice.current = voice; setVoiceThinking(voice);
    stopSpeaking(); ra.stop();
    if (viewRef.current === "idle" && !gateRef.current) newConversation();       // a message sent from the home screen starts a new conversation
    const cur = currentChoice();                       // a hospital is already on screen: this message continues the conversation
    setThread((th) => [...th, { role: "user", text: msg }]);
    setText(""); setCaption(""); setCareNote(null); setErrMsg(null); setNotice(null);
    need.current = msg;
    const g = checkRedFlags(msg);              // runs in the browser: works with no network
    if (g) setGate(g);
    history.current = [...history.current, msg].slice(-8);
    if (cur && !g) setThinking(true); else { setRec(null); setView("loading"); }
    try {
      const r = await api<{
        triage: { emergency: RedFlagResult | null; urgency: Urgency; services: ServiceId[]; understood: boolean; followUps: string[]; note: string | null; need: string | null; specialties?: string[]; chat?: boolean; advice?: boolean };
        location: { lat: number; lon: number; matched: string } | null;
      }>("/api/triage", { message: msg, history: history.current.slice(0, -1), lang });
      const tr = r.triage;
      setThinking(false);
      need.current = tr.need ?? msg;
      if (tr.emergency) setGate(tr.emergency); else if (!g) setGate(null);
      let at = locRef.current;
      const detected: Loc | null = !at && r.location ? { lat: r.location.lat, lon: r.location.lon, label: r.location.matched } : null;
      let services = tr.emergency && !tr.services.length ? tr.emergency.services.slice(0, 2) : tr.services;
      const urgency: Urgency = tr.emergency ? "emergency" : tr.urgency;
      if (tr.emergency && !g && !stayNoted.current) { stayNoted.current = true; addAssistant(t(lang, "emergencyStays"), true); }   // an emergency mentioned earlier stays on screen; say so instead of staying silent
      const follow = tr.emergency || asked.current >= 2 ? null : tr.followUps[0] ?? null;

      // Small talk (hello, thanks): no symptom and no request for care, so answer it and ask what is wrong; show no hospitals.
      if (tr.chat && !tr.emergency && !g) {
        setThinking(false);
        addAssistant(t(lang, tr.advice ? "adviceNote" : "chatAsk"));
        endVoiceTurn();
        if (!cur) setView("chat");
        return;
      }

      // Asked for medicine, a dose or a diagnosis: say plainly that the app gives none of these, then carry on helping to find care.
      if (tr.advice && !tr.emergency && !g) addAssistant(t(lang, "adviceNote"), true);

      // Keep the hospital unless what was added needs a kind of care it does not have.
      if (cur && !tr.emergency && !g) {
        setThinking(false);
        let solid = [...shownRef.current, ...hospitalsRef.current].find((h) => h.id === cur.id)?.services ?? [];
        if (services.some((s) => !cur.services.includes(s) && !solid.includes(s))) {      // ask the server what this hospital really has evidence for
          try { solid = (await api<{ services: ServiceId[] }>("/api/covers", { id: cur.id })).services; } catch { /* decide with what we have */ }
        }
        const missing = services.filter((s) => !cur.services.includes(s) && !solid.includes(s));
        if (!missing.length) { if (follow) { addAssistant(follow); asked.current++; } else addAssistant(t(lang, "stillFits"), true); endVoiceTurn(); return; }
        addAssistant(t(lang, "switchedCare"), true);
        if (viewRef.current === "result") services = [...new Set([...services, ...cur.services])].slice(0, 4);   // the new search keeps the care already asked for
        setRec(null); setView("loading");
      }
      if (follow) { addAssistant(follow); asked.current++; }

      // a need that maps to no service: search hospitals by the specialties it points to (a fresh search each time: n changes)
      const startNeedSearch = () => { setHMode("need"); setNeedHospitals([]); setNeedQuery({ sp: tr.specialties ?? [], n: Date.now() }); };
      if (detected) {
        if (urgency === "emergency") { at = detected; setLoc(at); }
        else { pending.current = services.length ? { services, urgency } : null; if (!services.length) { setSel(0); startNeedSearch(); } setView(services.length ? "needplace" : "pickcare"); void askConfirm(detected); return; }
      }
      if (!services.length) { setSel(0); startNeedSearch(); setView(g || tr.emergency ? "idle" : "pickcare"); if (!at && !g && !tr.emergency) { loadAsk(); setSheet("loc"); } return; }
      if (!at) { pending.current = { services, urgency }; loadAsk(); setView("needplace"); setSheet("loc"); return; }
      await fetchRec(services, urgency, at);
    } catch {
      setThinking(false);
      speakReply(t(lang, online ? "error" : "offline")); endVoiceTurn();
      setErrMsg(online ? t(lang, "error") : t(lang, "offline"));
      setView(g ? "idle" : "error");
    }
  }, [fetchRec, online, lang, askConfirm, loadAsk]);

  const gateRef = useRef(gate); gateRef.current = gate;
  const newConversation = () => { setThread([]); setThinking(false); history.current = []; need.current = null; asked.current = 0; stayNoted.current = false; };

  const toggleMic = useCallback(() => {
    if (listening) { listener.current?.stop(); return; }
    stopSpeaking(); ra.stop();
    setCaption(""); setNotice(null);
    const l = listen(speechLang(lang), {
      interim: setCaption,
      final: (v) => { void run(v, true); },
      error: (code) => {
        if (code === "not-allowed" || code === "service-not-allowed" || code === "start-failed") setNotice(t(lang, "voiceUnavailable"));
        else if (code === "language-not-supported") setNotice(t(lang, "micLangUnavailable"));
        else if (code === "no-speech") setNotice(t(lang, "micNoSpeech"));
        else if (code === "network") setNotice(t(lang, online ? "error" : "offline"));
      },
      end: () => { setListening(false); listener.current = null; },
    });
    if (l) { listener.current = l; setListening(true); } else setNotice(t(lang, "voiceUnavailable"));
  }, [listening, lang, run, online]);

  // browser/phone back, swipe-back and the back arrow walk through screens, the chosen hospital and open sheets
  const lastScreen = useRef<View>("idle");
  if (view !== "loading") lastScreen.current = view;
  const recRef = useRef(rec); recRef.current = rec;

  const nav = useHistorySync(
    { v: ((view === "loading" ? lastScreen.current : view) === "needplace" ? "idle" : (view === "loading" ? lastScreen.current : view)), sel, ov: sheet, g: !!gate },
    (e: NavEntry) => {
      setSel(e.sel);
      setView(e.v === "result" && !recRef.current ? "idle" : (e.v as View));
      setSheet(e.ov === "why" || e.ov === "prefs" || e.ov === "lang" || e.ov === "loc" || e.ov === "hwhy" || e.ov === "map" ? e.ov : null);
      if (!e.g) setGate(null);
    },
  );
  useEffect(() => onTalking(setTalking), []);
  const speaking = talking || ra.state.status === "playing";
  const voiceState: VoiceState = listening ? "listening" : speaking ? "speaking" : voiceThinking && (view === "loading" || needBusy) ? "thinking" : "idle";
  // the helper's expression: what it is doing right now, or how it feels about the answer
  const [happy, setHappy] = useState(false);
  const arrived = view === "result" ? rec?.results[0]?.id : view === "pickcare" && !needBusy ? needHospitals[0]?.id : null;
  useEffect(() => { if (!arrived) return; setHappy(true); const id = setTimeout(() => setHappy(false), 3200); return () => clearTimeout(id); }, [arrived]);
  const mood: Mood = voiceState === "listening" ? "listening" : voiceState === "speaking" ? "speaking" : gate ? "concerned"
    : voiceState === "thinking" || view === "loading" || (view === "pickcare" && needBusy) ? "thinking" : happy ? "happy" : "idle";
  const stopVoice = () => { stopSpeaking(); ra.stop(); listener.current?.stop(); setVoiceThinking(false); viaVoice.current = false; };

  // talk mode: a question asked by voice gets the best answer spoken back
  const sayAnswer = useCallback((name: string, min: number, km: number, sure: string) => {
    viaVoice.current = false; setVoiceThinking(false);
    const ok = speak(t(lang, "readSlip", { name, min, km, sure }), hasKey(lang, "readSlip") ? speechLang(lang) : "en-IN", true);
    if (!ok) setNotice(t(lang, "ttsUnavailable"));
  }, [lang]);
  useEffect(() => {
    if (!viaVoice.current || view !== "result" || !rec?.results[0]) return;
    const r = rec.results[0];
    const level = t(lang, r.solid ? (r.pService >= 0.75 ? "sureHigh" : r.pService >= 0.55 ? "sureMid" : "sureLow") : "sureLow");
    sayAnswer(r.name, r.etaMinutes, r.distanceKm, `${t(lang, "howSure")}: ${level}.`);
  }, [rec, view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!viaVoice.current || view !== "pickcare" || hMode !== "need" || needBusy || !needHospitals[0]) return;
    const h = needHospitals[0];
    sayAnswer(h.name, h.minutes ?? Math.max(3, Math.round(h.km * 3.5)), h.roadKm ?? h.km, "");
  }, [needHospitals, needBusy, view, hMode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (gate) { viaVoice.current = false; setVoiceThinking(false); } }, [gate]);   // an emergency card reads itself aloud

  const picked = rec?.results[sel] ?? null;
  const showIdle = view === "idle" && !gate;

  const readSheet = () => {
    const ok = ra.start(document.querySelector('[role="dialog"]') ?? document);
    setNotice(ok ? null : t(lang, ra.available ? "readingNothing" : "ttsUnavailable"));
  };
  const readPage = () => {
    if (ra.state.status !== "idle") { ra.stop(); return; }
    const ok = ra.start(document.querySelector('[role="dialog"]') ?? document.querySelector("main") ?? document);
    setNotice(ok ? null : t(lang, ra.available ? "readingNothing" : "ttsUnavailable"));
  };
  // stop reading when the language, the chosen hospital or the open sheet changes; an emergency card is read out loud as soon as it appears
  useEffect(() => { ra.stop(); }, [lang, sel, sheet]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ra.state.skipped) setNotice(t(lang, "readingSkipped")); }, [ra.state.skipped]); // eslint-disable-line react-hooks/exhaustive-deps
  // The emergency card is read aloud once, when an emergency first appears in a conversation: not again for every later message.
  const emergencyRead = useRef(false);
  useEffect(() => {
    if (!gate) { emergencyRead.current = false; return; }
    if (emergencyRead.current) return;
    emergencyRead.current = true;
    setTimeout(() => { ra.start(document.querySelector(".emerg") ?? document); }, 350);   // no cleanup: a quick second gate object must not cancel the one reading
  }, [gate]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickPlace = (c: PlaceChoice) => setLocation({ lat: c.lat, lon: c.lon, label: c.state ? `${c.label}, ${c.state}` : c.label });
  const quick: { id: ServiceId; icon: typeof Ambulance; key: "quickEmergency" | "quickPregnancy" | "quickDialysis" | "quickHeart" | "quickCancer" | "quickICU" }[] = [
    { id: "trauma_emergency", icon: Ambulance, key: "quickEmergency" }, { id: "obstetrics", icon: Baby, key: "quickPregnancy" },
    { id: "dialysis", icon: Droplets, key: "quickDialysis" }, { id: "cath_lab", icon: HeartPulse, key: "quickHeart" },
    { id: "oncology", icon: Ribbon, key: "quickCancer" }, { id: "icu", icon: BedDouble, key: "quickICU" },
  ];
  const shownHospitals = hMode === "need" ? needHospitals : hospitals;
  shownRef.current = shownHospitals;
  const openHospital = (h: NearbyHospital, mode?: "browse" | "need") => {
    const m = mode ?? hMode;
    const i = (m === "need" ? needHospitals : hospitals).findIndex((x) => x.id === h.id);
    if (i < 0) return;
    if (mode) setHMode(mode);
    setSel(i); setView("pickcare"); window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const newSearch = () => {
    stopVoice(); setGate(null); setSel(0); setThread([]); setThinking(false); setRec(null); setErrMsg(null); setSheet(null); setView("idle");
    window.scrollTo({ top: 0 });
    setTimeout(() => document.getElementById("ask")?.focus(), 350);
  };
  const openMap = (t: MapTarget) => { setMapTarget(t); setSheet("map"); };
  const startService = (id: ServiceId, urgent: boolean) => {
    need.current = null; viaVoice.current = false;   // a tap is a new search: do not carry over what was typed before
    const urgency: Urgency = urgent ? "urgent" : "routine";
    if (loc) void fetchRec([id], urgency, loc); else { pending.current = { services: [id], urgency }; loadAsk(); setView("needplace"); setSheet("loc"); }
  };

  const composer = view !== "idle" || !!gate;

  return (
    // a <section>, not a <div>: browser extensions (incognito openers, translators) inject a <div> at the top of <body> before React
    // hydrates, and React only skips such stray nodes when their tag differs from ours
    <section className="shell" data-composer={composer}>
      <Shade />
      <header className="topbar" data-scrolled={scrolled}>
        {(view !== "idle" || gate) && <button type="button" className="icon-btn tap" aria-label={t(lang, "back")} onClick={nav.back}><ChevronLeft size={22} aria-hidden /></button>}
        <button type="button" className="locbtn tap" onClick={() => setSheet("loc")} aria-label={t(lang, "locSheetTitle")}>
          <span className="locbtn-k">{t(lang, loc?.current ? "currentLocation" : "yourLocation")}</span>
          <span className="locbtn-v">{loc ? (loc.label ? <Name text={loc.label} lang={lang} /> : t(lang, "currentLocation")) : t(lang, "setLocationLabel")}<ChevronDown size={16} aria-hidden /></span>
        </button>
        <span className="tb-group">
          {ra.available && <button type="button" className="icon-btn tap" aria-label={t(lang, "listen")} aria-pressed={ra.state.status !== "idle"} data-on={ra.state.status !== "idle"} onClick={readPage}><Volume2 size={19} aria-hidden /></button>}
          <button type="button" className="icon-btn tap" aria-label={t(lang, "language")} onClick={() => setSheet("lang")}><Globe size={19} aria-hidden /></button>
          <a className="sos tap" href="tel:108" aria-label={t(lang, "emergencyCall")}><Phone size={15} aria-hidden />108</a>
        </span>
      </header>

      <main className="col" id="main">
        <h1 className="sr-only" data-noread>{t(lang, "appTitle")}</h1>
        <div className={`stack enter${showIdle ? " home" : ""}`} key={gate ? `em-${sel}` : `${view}-${sel}`}>
          {!showIdle && thread.length > 0 && (
            <div className="thread">
              {thread.map((m, i) => m.role === "user"
                ? <p key={i} className="said" data-read>{m.text}</p>
                : <p key={i} className={`asst${m.note ? " asst-note" : ""}`} data-read>{m.text}</p>)}
              {thinking && <div className="thinking" role="status"><span className="dots" aria-hidden><i /><i /><i /></span>{t(lang, "thinking")}</div>}
            </div>
          )}
          {notice && <p className="callout callout-info" role="status" style={{ marginTop: 0 }}><Info size={18} aria-hidden /><span>{notice}</span></p>}

          {gate && <EmergencyCard gate={gate} lang={lang} online={online} />}

          {view === "loading" && (
            <>
              <div className="thinking" role="status"><span className="dots" aria-hidden><i /><i /><i /></span>{t(lang, "thinking")}</div>
              <div className="card skel" aria-hidden><i className="k1" /><i className="k2" /><i className="k3" /><i className="k4" /></div>
            </>
          )}

          {view === "error" && (
            <div className="card">
              <p>{errMsg ?? t(lang, "error")}</p>
              {last.current && loc && <button type="button" className="btn btn-primary tap" style={{ marginTop: 16, width: "100%" }} onClick={() => fetchRec(last.current!.services, last.current!.urgency, loc)}>{t(lang, "retry")}</button>}
            </div>
          )}
          {view === "idle" && errMsg && gate && <p className="notes">{errMsg}</p>}

          {view === "pickcare" && needBusy && hMode === "need" && !shownHospitals[sel] && (
            <>
              <div className="thinking" role="status"><span className="dots" aria-hidden><i /><i /><i /></span>{t(lang, "thinking")}</div>
              <div className="card skel" aria-hidden><i className="k1" /><i className="k2" /><i className="k3" /><i className="k4" /></div>
            </>
          )}
          {view === "pickcare" && shownHospitals[sel] && (
            <>
              {hMode === "need" && (needQuery?.sp.length ?? 0) > 0 && (
                <p className="matched-for" data-read>{t(lang, "bestFor2", { what: needQuery!.sp.map((id) => specLabel(id, lang)).join(" · ") })}</p>
              )}
              {careNote && hMode === "need" && <p className="muted" style={{ padding: "0 6px" }}>{careNote}</p>}
              <HospitalCard h={shownHospitals[sel]} lang={lang} origin={loc} need={hMode === "need" ? said : null} guidance={hMode === "need"} onWhy={() => setSheet("hwhy")}
                onDirections={() => openMap({ name: shownHospitals[sel].name, lat: shownHospitals[sel].lat, lon: shownHospitals[sel].lon, fallbackKm: shownHospitals[sel].km })} />
              <div style={{ padding: "6px 6px 0" }}><h2 className="section-label" style={{ padding: 0 }}>{t(lang, "hospitalsNear")}</h2></div>
              <HospitalList hospitals={shownHospitals.filter((_, i) => i !== sel)} lang={lang} onOpen={openHospital} />
              <p className="foot">{t(lang, "notAffiliated")}</p>
            </>
          )}
          {view === "pickcare" && !shownHospitals[sel] && !needBusy && (
            <>
              <div style={{ padding: "0 4px" }}>
                <h2 className="title">{t(lang, "pickCare")}</h2>
              </div>
              <div className="list">
                {SERVICES.map((s) => (
                  <button key={s.id} type="button" className="list-row" onClick={() => {
                    const urgency: Urgency = s.urgentByNature ? "urgent" : "routine";
                    if (loc) void fetchRec([s.id], urgency, loc); else { pending.current = { services: [s.id], urgency }; loadAsk(); setView("needplace"); setSheet("loc"); }
                  }}>
                    <span className="row-title">{svcLabel(s.id, lang)}</span><span /><ChevronRight size={16} className="chev" aria-hidden />
                    <span className="row-sub">{svcPlain(s.id, lang)}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {view === "needplace" && (
            <div className="card hint">
              <p data-read>{askText ?? t(lang, "chooseWhereHint")}</p>
              <button type="button" className="btn btn-primary tap" style={{ marginTop: 14, width: "100%" }} onClick={() => setSheet("loc")}><MapPin size={18} aria-hidden />{t(lang, "locSheetTitle")}</button>
            </div>
          )}

          {showIdle && (
            <>
              <section className="hero-card" data-mood={mood}>
                <div className="hero-copy">
                  <h2 className="hero-title" data-read>{t(lang, "describe")}</h2>
                  <p className="hero-caption" aria-live="polite">
                    {voiceState === "listening" ? (caption || t(lang, "listening")) : voiceState === "speaking" ? t(lang, "speakingNow") : mood === "thinking" ? t(lang, "thinking") : t(lang, "heroSub")}
                  </p>
                  <MicButton state={voiceState} label={voiceState === "idle" ? t(lang, "mic") : voiceState === "listening" ? t(lang, "listening") : voiceState === "speaking" ? t(lang, "stop") : t(lang, "thinking")}
                    onClick={() => (voiceState === "speaking" || voiceState === "thinking" ? stopVoice() : canMic ? toggleMic() : document.getElementById("ask")?.focus())} />
                </div>
                <div className="hero-figure" aria-hidden><HelperFace mood={mood} /></div>
              </section>

              <form className="typebar" onSubmit={(e) => { e.preventDefault(); void run(text); }}>
                <Search size={19} aria-hidden />
                <textarea id="ask" rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder={t(lang, "typeProblem")} aria-label={t(lang, "describe")} enterKeyHint="send"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void run(text); } }} />
                <button type="submit" className="cap-btn tap" data-kind="send" data-show={!!text.trim()} aria-label={t(lang, "send")} disabled={!text.trim()}><ArrowUp size={21} strokeWidth={2.4} aria-hidden /></button>
              </form>

              <div className="quick" role="group" aria-label={t(lang, "pickCare")}>
                {quick.map(({ id, icon: Icon, key }) => (
                  <button key={id} type="button" className="quick-item tap" onClick={() => startService(id, id === "trauma_emergency" || id === "obstetrics")}>
                    <span className="quick-ico"><Icon size={24} strokeWidth={1.7} aria-hidden /></span>
                    <span className="quick-k">{t(lang, key)}</span>
                  </button>
                ))}
              </div>

              <button type="button" className="matters tap" onClick={() => setSheet("prefs")}>
                <span className="quick-ico"><SlidersHorizontal size={20} strokeWidth={1.8} aria-hidden /></span>
                <span className="matters-t">{t(lang, "prefs")}<small>{t(lang, "prefsHint")}</small></span>
                <ChevronRight size={18} className="chev" aria-hidden />
              </button>

              {hospitals.length > 0 && (
                <>
                  <div style={{ padding: "6px 6px 0" }}>
                    <h2 className="section-label" style={{ padding: 0 }}>{t(lang, "hospitalsNear")}</h2>
                    <p className="tiny" style={{ marginTop: 2 }}>{t(lang, "hospitalsNote")}</p>
                  </div>
                  <HospitalList hospitals={hospitals} lang={lang} onOpen={(h) => openHospital(h, "browse")} />
                </>
              )}
              <p className="foot">{t(lang, "notAffiliated")}</p>
            </>
          )}

          {view === "result" && rec && picked && (
            <>
              {rec.notes.length > 0 && <div className="notes">{rec.notes.map((n) => <p key={n.text}><Tx m={n} lang={lang} /></p>)}</div>}
              <Slip r={picked} lang={lang} services={rec.services} origin={loc} onWhy={() => setSheet("why")} onDirections={() => openMap({ name: picked.name, lat: picked.lat, lon: picked.lon, fallbackKm: picked.distanceKm, fallbackMinutes: picked.etaMinutes })} />
              {rec.results.length <= 1 && (
                <button type="button" className="matters tap" onClick={() => setSheet("prefs")}>
                  <span className="quick-ico"><SlidersHorizontal size={20} strokeWidth={1.8} aria-hidden /></span>
                  <span className="matters-t">{t(lang, "prefs")}<small>{t(lang, "prefsHint")}</small></span>
                  <ChevronRight size={18} className="chev" aria-hidden />
                </button>
              )}
              {rec.results.length > 1 && (
                <>
                  <div className="list-head">
                    <h2 className="section-label" style={{ padding: 0 }}>{t(lang, "otherOptions")}</h2>
                    <button type="button" className="link" onClick={() => setSheet("prefs")}><SlidersHorizontal size={16} aria-hidden />{t(lang, "prefs")}</button>
                  </div>
                  <div className="list">
                    {rec.results.map((r, i) => i === sel ? null : (
                      <button key={r.id} type="button" className="list-row" onClick={() => { setSel(i); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                        <span className="row-title"><Name text={r.name} lang={lang} />{r.registry?.tier === "verified" && <BadgeCheck size={15} aria-label={t(lang, "registryListed")} />}</span>
                        <span className="row-meta">{r.etaMinutes} {t(lang, "min")}</span>
                        <ChevronRight size={16} className="chev" aria-hidden />
                        <span className="row-sub">{r.distanceKm} {t(lang, "km")}{!r.solid ? ` · ${t(lang, "sureLow")}` : ""}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              <p className="foot">{t(lang, "notAffiliated")}</p>
            </>
          )}
          {view === "result" && rec && !picked && (
            <div className="card"><p>{t(lang, "none")}</p>{rec.notes.map((n) => <p key={n.text} className="small" style={{ marginTop: 8 }}><Tx m={n} lang={lang} /></p>)}</div>
          )}
        </div>
      </main>

      {ra.state.status !== "idle" && (
        <div className="ra-bar" role="group" aria-label={t(lang, "listen")}>
          <LiveBars active={ra.state.status === "playing"} /><span className="ra-count" aria-live="polite">{t(lang, "readingProgress", { n: ra.state.index + 1, m: ra.state.total })}</span>
          <button type="button" className="ra-btn tap" onClick={ra.prev} aria-label={t(lang, "prevPart")}><SkipBack size={18} aria-hidden /></button>
          {ra.state.status === "playing"
            ? <button type="button" className="ra-btn ra-main tap" onClick={ra.pause} aria-label={t(lang, "pause")}><Pause size={20} aria-hidden /></button>
            : <button type="button" className="ra-btn ra-main tap" onClick={ra.resume} aria-label={t(lang, "resume")}><Play size={20} aria-hidden /></button>}
          <button type="button" className="ra-btn tap" onClick={ra.next} aria-label={t(lang, "nextPart")}><SkipForward size={18} aria-hidden /></button>
          <button type="button" className="ra-speed tap" onClick={() => setSlow((v) => { ra.setRate(v ? 1 : 0.7); return !v; })} aria-pressed={slow}>{slow ? t(lang, "speedSlow") : t(lang, "speedNormal")}</button>
          <button type="button" className="ra-btn tap" onClick={ra.stop} aria-label={t(lang, "stopReading")}><X size={18} aria-hidden /></button>
        </div>
      )}

      {!showIdle && voiceState !== "idle" && !(voiceState === "speaking" && ra.state.status === "playing") && (
        <VoicePill state={voiceState} stopLabel={t(lang, "stop")} onStop={stopVoice}
          label={voiceState === "listening" ? (caption || t(lang, "listening")) : voiceState === "speaking" ? t(lang, "speakingNow") : t(lang, "thinking")} />
      )}
      {composer && (
        <div className="dock glass">
          <button type="button" className="dock-btn dock-icon tap" onClick={newSearch} aria-label={t(lang, "newSearch")} title={t(lang, "newSearch")}><Search size={19} aria-hidden /></button>
          <form className="dock-form" onSubmit={(e) => { e.preventDefault(); void run(text); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t(lang, "followPh")} aria-label={t(lang, "followPh")} enterKeyHint="send" autoComplete="off" />
            {text.trim() && <button type="submit" className="dock-send tap" aria-label={t(lang, "send")}><ArrowUp size={18} strokeWidth={2.4} aria-hidden /></button>}
          </form>
          {canMic && <MicButton state={voiceState} label={voiceState === "idle" ? t(lang, "mic") : voiceState === "listening" ? t(lang, "listening") : voiceState === "speaking" ? t(lang, "stop") : t(lang, "thinking")}
            onClick={() => (voiceState === "speaking" || voiceState === "thinking" ? stopVoice() : toggleMic())} />}
        </div>
      )}

      {sheet === "hwhy" && shownHospitals[sel] && <HospitalWhySheet h={shownHospitals[sel]} lang={lang} onClose={() => setSheet(null)} onListen={readSheet} />}
      {sheet === "loc" && <LocSheet lang={lang} busy={locBusy} msg={locMsg} candidates={candidates} recent={recent} hint={view === "needplace" ? (askText ?? t(lang, "chooseWhereHint")) : null}
        confirm={confirm} onYes={() => confirm && applyLocation(confirm.loc)} onNo={() => setConfirm(null)}
        onDevice={useDevice} onLookup={lookupPlace} onPick={pickPlace} onClose={() => { setConfirm(null); setSheet(null); }} onListen={readSheet} />}
      {sheet === "map" && mapTarget && loc && <MapSheet origin={loc} dest={mapTarget} lang={lang} onClose={() => setSheet(null)} onListen={readSheet} />}
      {sheet === "lang" && <LangSheet lang={lang} onClose={() => setSheet(null)} onListen={readSheet} onPick={(l) => { chooseLang(l); setSheet(null); }} />}
      {sheet === "why" && picked && rec && <WhySheet r={picked} lang={lang} onClose={() => setSheet(null)} trafficNote={rec.traffic.note} context={rec.coverage.context} onListen={readSheet} />}
      {sheet === "prefs" && (
        <PrefSheet lang={lang} prefs={prefs} card={card} onClose={() => setSheet(null)} onListen={readSheet}
          onApply={(p, c) => { setPrefs(p); setCard(c); setPrefsTouched(true); setSheet(null); if (last.current && loc) void fetchRec(last.current.services, last.current.urgency, loc, p, c, true); }} />
      )}
    </section>
  );
}
