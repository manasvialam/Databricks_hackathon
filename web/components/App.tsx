"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUp, BadgeCheck, ChevronRight, Globe, Info, LocateFixed, MapPin, Mic, Pause, Phone, Play, Search, SkipBack, SkipForward, SlidersHorizontal, Square, Volume2, X } from "lucide-react";
import { LANGS, hasKey, isLang, say, speechLang, svcPlain, t, type Lang } from "@/lib/i18n";
import { checkRedFlags, type RedFlagResult } from "@/lib/triage/redflags";
import { PERSONA_BY_ID } from "@/lib/preferences";
import type { Preferences, ServiceId, Urgency } from "@/lib/types";
import type { RecommendResponse } from "@/lib/recommend";
import type { NearbyService } from "@/lib/nearby";
import { SERVICES } from "@/lib/services";
import { canListen, listen, stopSpeaking, type Listener } from "@/lib/client/speech";
import { useReadAlong } from "@/lib/client/readalong";
import { Slip, svcLabel } from "./Slip";
import { EmergencyCard, LangSheet, PrefSheet, WhySheet, type CardAnswer } from "./Sheets";

interface Loc { lat: number; lon: number; label: string | null }
interface Candidate { label: string; state: string; district: string; lat: number; lon: number }
type View = "idle" | "loading" | "result" | "pickcare" | "needplace" | "error";

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error ?? "error"), { data, status: res.status });
  return data as T;
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
  const [place, setPlace] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [nearby, setNearby] = useState<NearbyService[]>([]);
  const [text, setText] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const [view, setView] = useState<View>("idle");
  const [gate, setGate] = useState<RedFlagResult | null>(null);
  const [rec, setRec] = useState<RecommendResponse | null>(null);
  const [sel, setSel] = useState(0);
  const [online, setOnline] = useState(true);
  const [listening, setListening] = useState(false);
  const [caption, setCaption] = useState("");
  const [sheet, setSheet] = useState<null | "why" | "prefs" | "lang">(null);
  const [scrolled, setScrolled] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [careNote, setCareNote] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(PERSONA_BY_ID.everyone.weights);
  const [prefsTouched, setPrefsTouched] = useState(false);
  const [card, setCard] = useState<CardAnswer>("unknown");
  const [canMic, setCanMic] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const history = useRef<string[]>([]);
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
    if (!loc) { setNearby([]); return; }
    let live = true;
    api<{ services: NearbyService[] }>(`/api/nearby?lat=${loc.lat}&lon=${loc.lon}`).then((d) => live && setNearby(d.services)).catch(() => live && setNearby([]));
    return () => { live = false; };
  }, [loc]);

  const fetchRec = useCallback(async (services: ServiceId[], urgency: Urgency, at: Loc, p = prefs, c = card, touched = prefsTouched) => {
    last.current = { services, urgency };
    setView("loading"); setErrMsg(null);
    try {
      const body: Record<string, unknown> = { services, urgency, location: at, card: c };
      if (touched) body.preferences = p;
      const data = await api<RecommendResponse>("/api/recommend", body);
      setRec(data); setSel(0); setView("result"); window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      // server messages are English; show our own sentence in the person's language
      setErrMsg(t(lang, (e as { status?: number }).status === 422 ? "outsideIndia" : "error"));
      setView("error");
    }
  }, [prefs, card, prefsTouched, lang]);

  const setLocation = useCallback((l: Loc) => {
    setLoc(l); setLocMsg(null); setCandidates([]); setPlace("");
    if (pending.current) { const p = pending.current; pending.current = null; void fetchRec(p.services, p.urgency, l); }
  }, [fetchRec]);

  const useDevice = useCallback(() => {
    if (!navigator.geolocation) { setLocMsg(t(lang, "locDenied")); return; }
    setLocBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocBusy(false); setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: null }); },
      () => { setLocBusy(false); setLocMsg(t(lang, "locDenied")); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }, [lang, setLocation]);

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

  const run = useCallback(async (raw: string) => {
    const msg = raw.trim();
    if (!msg) return;
    stopSpeaking(); ra.stop();
    setSaid(msg); setText(""); setCaption(""); setCareNote(null); setErrMsg(null); setRec(null); setNotice(null);
    const g = checkRedFlags(msg);              // runs in the browser: works with no network
    setGate(g);
    history.current = [...history.current, msg].slice(-6);
    setView("loading");
    try {
      const r = await api<{
        triage: { emergency: RedFlagResult | null; urgency: Urgency; services: ServiceId[]; understood: boolean; followUps: string[]; note: string | null };
        location: { lat: number; lon: number; matched: string } | null;
      }>("/api/triage", { message: msg, history: history.current.slice(0, -1), lang });
      const tr = r.triage;
      if (tr.emergency) setGate(tr.emergency);
      let at = locRef.current;
      if (!at && r.location) { at = { lat: r.location.lat, lon: r.location.lon, label: r.location.matched }; setLoc(at); }
      const services = tr.emergency && !tr.services.length ? tr.emergency.services.slice(0, 2) : tr.services;
      const urgency: Urgency = tr.emergency ? "emergency" : tr.urgency;
      if (!services.length) { setCareNote(tr.followUps[0] ?? null); setView(g || tr.emergency ? "idle" : "pickcare"); return; }
      if (!at) { pending.current = { services, urgency }; setView("needplace"); return; }
      await fetchRec(services, urgency, at);
    } catch {
      setErrMsg(online ? t(lang, "error") : t(lang, "offline"));
      setView(g ? "idle" : "error");
    }
  }, [fetchRec, online, lang]);

  const toggleMic = useCallback(() => {
    if (listening) { listener.current?.stop(); return; }
    stopSpeaking(); ra.stop();
    setCaption(""); setNotice(null);
    const l = listen(speechLang(lang), {
      interim: setCaption,
      final: (v) => { void run(v); },
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

  const picked = rec?.results[sel] ?? null;
  const showIdle = view === "idle" && !gate;

  const readSlip = () => {
    const ok = ra.start((document.querySelector("main article.card") as ParentNode | null) ?? document);
    setNotice(ok ? null : t(lang, "ttsUnavailable"));
  };
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
  const emergencyRead = useRef<RedFlagResult | null>(null);
  useEffect(() => {
    if (!gate || emergencyRead.current === gate) return;
    emergencyRead.current = gate;
    const id = setTimeout(() => { ra.start(document.querySelector(".emerg") ?? document); }, 350);
    return () => clearTimeout(id);
  }, [gate]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickPlace = (c: Candidate) => setLocation({ lat: c.lat, lon: c.lon, label: `${c.district}, ${c.state}` });
  const placeForm = (
    <PlaceControls lang={lang} busy={locBusy} msg={locMsg} place={place} setPlace={setPlace} onDevice={useDevice} onLookup={lookupPlace}
      candidates={candidates} onPick={pickPlace} />
  );

  const composer = view !== "idle" || !!gate;

  return (
    <div className="shell" data-composer={composer}>
      <header className="topbar" data-scrolled={scrolled}>
        <span className="tb-group">
          <button type="button" className="icon-btn tap" aria-label={t(lang, "language")} onClick={() => setSheet("lang")}><Globe size={20} aria-hidden /></button>
          {ra.available && <button type="button" className="icon-btn tap" aria-label={t(lang, "listen")} aria-pressed={ra.state.status !== "idle"} data-on={ra.state.status !== "idle"} onClick={readPage}><Volume2 size={20} aria-hidden /></button>}
        </span>
        <span className="topbar-title" aria-hidden>{t(lang, "appTitle")}</span>
        <a className="sos tap" href="tel:108" aria-label={t(lang, "emergencyCall")}><Phone size={15} aria-hidden />108</a>
      </header>

      <main className="col" id="main">
        <h1 className="sr-only" data-noread>{t(lang, "appTitle")}</h1>
        <div className="stack enter" key={gate ? `em-${sel}` : `${view}-${sel}`}>
          {said && !showIdle && <p className="said" aria-label={t(lang, "said")}>{said}</p>}
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

          {view === "pickcare" && (
            <>
              <div style={{ padding: "0 4px" }}>
                <h2 className="title">{t(lang, "pickCare")}</h2>
                {careNote && <p className="muted" style={{ marginTop: 6 }}>{careNote}</p>}
              </div>
              <div className="list">
                {SERVICES.map((s) => (
                  <button key={s.id} type="button" className="list-row" onClick={() => {
                    const urgency: Urgency = s.urgentByNature ? "urgent" : "routine";
                    if (loc) void fetchRec([s.id], urgency, loc); else { pending.current = { services: [s.id], urgency }; setView("needplace"); }
                  }}>
                    <span className="row-title">{svcLabel(s.id, lang)}</span><span /><ChevronRight size={16} className="chev" aria-hidden />
                    <span className="row-sub">{svcPlain(s.id, lang)}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {view === "needplace" && <div className="card where"><p className="label"><MapPin size={17} aria-hidden />{t(lang, "whereLabel")}</p>{placeForm}</div>}

          {showIdle && (
            <>
              <div style={{ padding: "4px 4px 2px" }}>
                <p className="eyebrow">{t(lang, "appTitle")}</p>
                <h2 className="hero-title">{t(lang, "describe")}</h2>
                <p className="hero-sub">{t(lang, "sub")}</p>
              </div>

              <form className="card ask" onSubmit={(e) => { e.preventDefault(); void run(text); }}>
                <label htmlFor="ask" className="sr-only">{t(lang, "describe")}</label>
                <textarea id="ask" value={text} onChange={(e) => setText(e.target.value)} placeholder={t(lang, "describePh")} enterKeyHint="send" rows={3}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void run(text); } }} />
                {(listening || caption) && <p className="live" aria-live="polite">{listening && !caption ? t(lang, "listening") : caption}</p>}
                <div className="ask-bar">
                  {canMic
                    ? <button type="button" className="mic-btn tap" data-live={listening} aria-label={listening ? t(lang, "stop") : t(lang, "mic")} onClick={toggleMic}>{listening ? <Square size={18} aria-hidden /> : <Mic size={22} aria-hidden />}</button>
                    : <span />}
                  <button type="submit" className="btn btn-primary tap" disabled={!text.trim()}>{t(lang, "find")}<ArrowRight size={18} aria-hidden /></button>
                </div>
              </form>

              <div className="card where">
                <p className="label"><MapPin size={17} aria-hidden />{t(lang, "whereLabel")}</p>
                {loc ? (
                  <div className="loc" style={{ gridTemplateColumns: "1fr auto" }}>
                    <div className="loc-v">{loc.label ? <span lang="en">{loc.label}</span> : t(lang, "currentLocation")}</div>
                    <button type="button" className="link" onClick={() => { setLoc(null); setNearby([]); }}>{t(lang, "change")}</button>
                  </div>
                ) : placeForm}
              </div>

              {nearby.length > 0 && (
                <>
                  <h2 className="section-label" style={{ marginTop: 8 }}>{t(lang, "nearYou")}</h2>
                  <div className="tiles">
                    {nearby.slice(0, 4).map((s) => (
                      <button key={s.id} type="button" className="tile tap" onClick={() => loc && fetchRec([s.id], s.urgent ? "urgent" : "routine", loc)}>
                        <span className="tile-name">{svcLabel(s.id, lang)}</span>
                        <span className="tile-num">{s.nearestKm != null ? <>{Math.round(s.nearestKm)}<small>{t(lang, "km")}</small></> : "–"}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              <p className="foot">{t(lang, "notAffiliated")}</p>
            </>
          )}

          {view === "result" && rec && picked && (
            <>
              {rec.notes.length > 0 && <div className="notes">{rec.notes.map((n) => <p key={n.text}>{say(n, lang)}</p>)}</div>}
              <Slip r={picked} lang={lang} services={rec.services} onWhy={() => setSheet("why")} onSpeak={readSlip} />
              {rec.results.length > 1 && (
                <>
                  <div className="list-head">
                    <h2 className="section-label" style={{ padding: 0 }}>{t(lang, "otherOptions")}</h2>
                    <button type="button" className="link" onClick={() => setSheet("prefs")}><SlidersHorizontal size={16} aria-hidden />{t(lang, "prefs")}</button>
                  </div>
                  <div className="list">
                    {rec.results.map((r, i) => i === sel ? null : (
                      <button key={r.id} type="button" className="list-row" onClick={() => { setSel(i); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                        <span className="row-title"><span lang="en">{r.name}</span>{r.registry?.tier === "verified" && <BadgeCheck size={15} aria-label={t(lang, "registryListed")} />}</span>
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
            <div className="card"><p>{t(lang, "none")}</p>{rec.notes.map((n) => <p key={n.text} className="small" style={{ marginTop: 8 }}>{say(n, lang)}</p>)}</div>
          )}
        </div>
      </main>

      {ra.state.status !== "idle" && (
        <div className="ra-bar" role="group" aria-label={t(lang, "listen")}>
          <span className="ra-count" aria-live="polite">{t(lang, "readingProgress", { n: ra.state.index + 1, m: ra.state.total })}</span>
          <button type="button" className="ra-btn tap" onClick={ra.prev} aria-label={t(lang, "prevPart")}><SkipBack size={18} aria-hidden /></button>
          {ra.state.status === "playing"
            ? <button type="button" className="ra-btn ra-main tap" onClick={ra.pause} aria-label={t(lang, "pause")}><Pause size={20} aria-hidden /></button>
            : <button type="button" className="ra-btn ra-main tap" onClick={ra.resume} aria-label={t(lang, "resume")}><Play size={20} aria-hidden /></button>}
          <button type="button" className="ra-btn tap" onClick={ra.next} aria-label={t(lang, "nextPart")}><SkipForward size={18} aria-hidden /></button>
          <button type="button" className="ra-speed tap" onClick={() => setSlow((v) => { ra.setRate(v ? 0.95 : 0.7); return !v; })} aria-pressed={slow}>{slow ? t(lang, "speedSlow") : t(lang, "speedNormal")}</button>
          <button type="button" className="ra-btn tap" onClick={ra.stop} aria-label={t(lang, "stopReading")}><X size={18} aria-hidden /></button>
        </div>
      )}

      {composer && (
        <div className="composer">
          {(listening || caption) && <p className="caption" aria-live="polite">{listening && !caption ? t(lang, "listening") : caption}</p>}
          <form className="capsule" onSubmit={(e) => { e.preventDefault(); void run(text); }}>
            <Search size={19} aria-hidden />
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t(lang, "placeholder")} aria-label={t(lang, "placeholder")} enterKeyHint="send" autoComplete="off" />
            {text.trim()
              ? <button type="submit" className="cap-btn tap" data-kind="send" aria-label={t(lang, "send")}><ArrowUp size={21} strokeWidth={2.4} aria-hidden /></button>
              : canMic
                ? <button type="button" className="cap-btn tap" data-live={listening} aria-label={listening ? t(lang, "stop") : t(lang, "mic")} onClick={toggleMic}>{listening ? <Square size={18} aria-hidden /> : <Mic size={21} aria-hidden />}</button>
                : <button type="submit" className="cap-btn" data-kind="send" aria-label={t(lang, "send")} disabled style={{ opacity: .35 }}><ArrowUp size={21} aria-hidden /></button>}
          </form>
        </div>
      )}

      {sheet === "lang" && <LangSheet lang={lang} onClose={() => setSheet(null)} onListen={readSheet} onPick={(l) => { chooseLang(l); setSheet(null); }} />}
      {sheet === "why" && picked && rec && <WhySheet r={picked} lang={lang} onClose={() => setSheet(null)} trafficNote={rec.traffic.note} context={rec.coverage.context} onListen={readSheet} />}
      {sheet === "prefs" && (
        <PrefSheet lang={lang} prefs={prefs} card={card} onClose={() => setSheet(null)} onListen={readSheet}
          onApply={(p, c) => { setPrefs(p); setCard(c); setPrefsTouched(true); setSheet(null); if (last.current && loc) void fetchRec(last.current.services, last.current.urgency, loc, p, c, true); }} />
      )}
    </div>
  );
}

function PlaceControls({ lang, busy, msg, place, setPlace, onDevice, onLookup, candidates, onPick }: {
  lang: Lang; busy: boolean; msg: string | null; place: string; setPlace: (s: string) => void; onDevice: () => void; onLookup: (q: string) => void;
  candidates: Candidate[]; onPick: (c: Candidate) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); onLookup(place); }}>
        <input className="field-input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder={t(lang, "placeShort")} aria-label={t(lang, "placeInput")} inputMode="text" autoComplete="off" />
        <button type="submit" className="btn btn-soft tap" style={{ minHeight: 50, padding: "0 18px" }} disabled={busy || !place.trim()}>{t(lang, "go")}</button>
      </form>
      <button type="button" className="link" style={{ justifySelf: "start", display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 2px", minHeight: 40 }} onClick={onDevice} disabled={busy}>
        <LocateFixed size={16} aria-hidden />{busy ? t(lang, "locating") : t(lang, "useLocation")}
      </button>
      {msg && <p className="small" role="status">{msg}</p>}
      {candidates.length > 0 && (
        <div className="list" style={{ boxShadow: "none", background: "var(--surface-2)" }}>
          {candidates.map((c) => (
            <button key={`${c.label}${c.state}`} type="button" className="list-row" onClick={() => onPick(c)}>
              <span className="row-title">{c.label}</span><span /><ChevronRight size={16} className="chev" aria-hidden />
              <span className="row-sub">{c.district}, {c.state}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
