"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Glass, Input, Menu } from "glisse";
import { Languages, LocateFixed, Mic, SendHorizontal, SlidersHorizontal, Square, Phone } from "lucide-react";
import { LANGS, hasKey, speechLang, t, type Lang } from "@/lib/i18n";
import { checkRedFlags, type RedFlagResult } from "@/lib/triage/redflags";
import { PERSONA_BY_ID } from "@/lib/preferences";
import type { Preferences, ServiceId, Urgency } from "@/lib/types";
import type { RecommendResponse } from "@/lib/recommend";
import type { NearbyService } from "@/lib/nearby";
import { SERVICES } from "@/lib/services";
import { canListen, listen, speak, stopSpeaking, type Listener } from "@/lib/client/speech";
import { Slip, svcLabel } from "./Slip";
import { EmergencyCard, PrefSheet, WhySheet, type CardAnswer } from "./Sheets";

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
  const [sheet, setSheet] = useState<null | "why" | "prefs">(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [careNote, setCareNote] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(PERSONA_BY_ID.everyone.weights);
  const [prefsTouched, setPrefsTouched] = useState(false);
  const [card, setCard] = useState<CardAnswer>("unknown");
  const [canMic, setCanMic] = useState(false);

  const history = useRef<string[]>([]);
  const pending = useRef<{ services: ServiceId[]; urgency: Urgency } | null>(null);
  const last = useRef<{ services: ServiceId[]; urgency: Urgency } | null>(null);
  const listener = useRef<Listener | null>(null);
  const locRef = useRef<Loc | null>(null);
  locRef.current = loc;

  useEffect(() => {
    const saved = safeGet("lang") as Lang | null;
    if (saved && LANGS.some((l) => l.id === saved)) setLang(saved);
    setCanMic(canListen());
    setOnline(navigator.onLine);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  useEffect(() => { document.documentElement.lang = lang; safeSet("lang", lang); }, [lang]);

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
      setRec(data); setSel(0); setView("result");
    } catch (e) {
      setErrMsg(e instanceof Error && e.message !== "error" ? e.message : t(lang, "error"));
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
      else setLocMsg(g.message ?? t(lang, "none"));
    } catch { setLocMsg(t(lang, "error")); }
    setLocBusy(false);
  }, [lang, setLocation]);

  const run = useCallback(async (raw: string) => {
    const msg = raw.trim();
    if (!msg) return;
    stopSpeaking();
    setSaid(msg); setText(""); setCaption(""); setCareNote(null); setErrMsg(null); setRec(null);
    const g = checkRedFlags(msg);              // runs in the browser: works with no network
    setGate(g);
    history.current = [...history.current, msg].slice(-6);
    setView("loading");
    try {
      const r = await api<{
        triage: { emergency: RedFlagResult | null; urgency: Urgency; services: ServiceId[]; understood: boolean; followUps: string[]; note: string | null };
        location: { lat: number; lon: number; matched: string } | null;
      }>("/api/triage", { message: msg, history: history.current.slice(0, -1) });
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
    stopSpeaking();
    setCaption("");
    const l = listen(speechLang(lang), {
      interim: setCaption,
      final: (v) => { void run(v); },
      error: (code) => { if (code === "not-allowed" || code === "service-not-allowed") setErrMsg(t(lang, "voiceUnavailable")); },
      end: () => { setListening(false); listener.current = null; },
    });
    if (l) { listener.current = l; setListening(true); } else setErrMsg(t(lang, "voiceUnavailable"));
  }, [listening, lang, run]);

  const picked = rec?.results[sel] ?? null;
  const scale = useMemo(() => Math.max(10, ...(rec?.results ?? []).map((r) => r.etaHigh)) * 1.1, [rec]);
  const showIdle = view === "idle" && !gate;

  const readSlip = () => {
    if (!picked) return;
    const level = t(lang, picked.solid ? (picked.pService >= 0.75 ? "sureHigh" : picked.pService >= 0.55 ? "sureMid" : "sureLow") : "sureLow");
    speak(t(lang, "readSlip", { name: picked.name, min: picked.etaMinutes, km: picked.distanceKm, sure: `${t(lang, "howSure")}: ${level}.` }), hasKey(lang, "readSlip") ? speechLang(lang) : "en-IN");
  };

  return (
    <div className="shell">
      <Glass className="strip" data-theme="dark">
        <Menu aria-label={t(lang, "language")} icon={<Languages size={22} />} align="start"
          items={LANGS.map((l) => ({ label: `${l.native}${l.id === lang ? "  ✓" : ""}`, onSelect: () => setLang(l.id) }))} />
        <span className="strip-title">{t(lang, "appTitle")}</span>
        <Button variant="filled" tint="#C8102E" icon={<Phone size={18} />} aria-label={t(lang, "emergencyCall")}
          onClick={() => { window.location.href = "tel:108"; }}>108</Button>
      </Glass>

      <main className="col stack" id="main">
        <h1 className="sr-only">{t(lang, "appTitle")}</h1>
        {said && <p className="you-said">{t(lang, "said")}: <q>{said}</q></p>}

        {gate && <EmergencyCard gate={gate} lang={lang} online={online} />}

        {view === "loading" && <div className="status" role="status"><span className="spinner" aria-hidden />{t(lang, "thinking")}</div>}

        {view === "error" && (
          <div className="panel"><p>{errMsg ?? t(lang, "error")}</p>
            {last.current && loc && <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => fetchRec(last.current!.services, last.current!.urgency, loc)}>{t(lang, "retry")}</button>}
          </div>
        )}
        {view === "idle" && errMsg && gate && <p className="notes">{errMsg}</p>}

        {view === "pickcare" && (
          <div className="panel">
            <h2 className="h2">{t(lang, "pickCare")}</h2>
            {careNote && <p className="sub">{careNote}</p>}
            <ul className="near-list">
              {SERVICES.map((s) => (
                <li key={s.id}><button type="button" className="near-item" onClick={() => {
                  const urgency: Urgency = s.urgentByNature ? "urgent" : "routine";
                  if (loc) void fetchRec([s.id], urgency, loc); else { pending.current = { services: [s.id], urgency }; setView("needplace"); }
                }}><span className="near-name">{svcLabel(s.id, lang)}</span><span className="near-plain">{s.plain}</span></button></li>
              ))}
            </ul>
          </div>
        )}

        {view === "needplace" && (
          <div className="panel">
            <PlaceControls lang={lang} busy={locBusy} msg={locMsg} place={place} setPlace={setPlace} onDevice={useDevice} onLookup={lookupPlace}
              candidates={candidates} onPick={(c) => setLocation({ lat: c.lat, lon: c.lon, label: `${c.district}, ${c.state}` })} />
          </div>
        )}

        {showIdle && (
          <div className="panel">
            <h1 className="h1">{t(lang, "headline")}</h1>
            <p className="sub">{t(lang, "sub")}</p>
            {!loc && (
              <div className="section">
                <PlaceControls lang={lang} busy={locBusy} msg={locMsg} place={place} setPlace={setPlace} onDevice={useDevice} onLookup={lookupPlace}
                  candidates={candidates} onPick={(c) => setLocation({ lat: c.lat, lon: c.lon, label: `${c.district}, ${c.state}` })} />
              </div>
            )}
            {loc && (
              <div className="locrow">
                <span className="chip"><LocateFixed size={16} aria-hidden />{loc.label ?? t(lang, "useLocation")}</span>
                <button type="button" className="btn btn-text" onClick={() => { setLoc(null); setNearby([]); }}>{t(lang, "placeInput")}</button>
              </div>
            )}
            {nearby.length > 0 && (
              <div className="section">
                <h2 className="h2">{t(lang, "nearYou")}</h2>
                <p className="small">{t(lang, "nearYouNote")}</p>
                <ul className="near-list">
                  {nearby.slice(0, 6).map((s) => (
                    <li key={s.id}><button type="button" className="near-item" onClick={() => loc && fetchRec([s.id], s.urgent ? "urgent" : "routine", loc)}>
                      <span className="near-name">{svcLabel(s.id, lang)}</span>
                      <span className="near-meta">{s.nearestKm != null ? `${Math.round(s.nearestKm)} ${t(lang, "km")}` : ""}</span>
                    </button></li>
                  ))}
                </ul>
              </div>
            )}
            <p className="small" style={{ marginTop: 18 }}>{canMic ? t(lang, "voiceNote") : t(lang, "voiceUnavailable")}</p>
          </div>
        )}

        {view === "result" && rec && picked && (
          <>
            {rec.notes.length > 0 && <div className="notes">{rec.notes.map((n) => <p key={n}>{n}</p>)}</div>}
            {rec.confidence === "several_similar" && <div className="notes"><p>{t(lang, "mixWarning")}</p></div>}
            <Slip r={picked} scale={scale} lang={lang} services={rec.services} onWhy={() => setSheet("why")} onSpeak={readSlip} />
            <div className="actions" style={{ marginTop: 0 }}>
              <button type="button" className="btn wide" onClick={() => setSheet("prefs")}><SlidersHorizontal size={20} aria-hidden />{t(lang, "prefs")}</button>
            </div>
            {rec.results.length > 1 && (
              <>
                <h2 className="on-board" style={{ margin: "6px 0 0" }}>{t(lang, "otherOptions")}</h2>
                <div className="alts">
                  {rec.results.map((r, i) => i === sel ? null : (
                    <button key={r.id} type="button" className="alt" onClick={() => { setSel(i); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                      <span className="alt-name">{r.name}</span>
                      <span className="alt-meta">{r.etaMinutes} {t(lang, "min")} · {r.distanceKm} {t(lang, "km")}</span>
                      <span className="alt-sub">{[r.tags.includes("fastest") && t(lang, "fastest"), r.tags.includes("most_trusted") && t(lang, "mostTrusted"), r.registry?.tier === "verified" && t(lang, "registryListed"), !r.solid && t(lang, "weakNote")].filter(Boolean).join(" · ")}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {rec.coverage.context.length > 0 && <div className="notes" style={{ marginTop: 10 }}>{rec.coverage.context.map((c) => <p key={c}>{c}</p>)}</div>}
            <p className="foot">{t(lang, "estimate")} {t(lang, "notAffiliated")}</p>
          </>
        )}
        {view === "result" && rec && !picked && (
          <div className="panel"><p>{t(lang, "none")}</p>{rec.notes.map((n) => <p key={n} className="small" style={{ marginTop: 8 }}>{n}</p>)}</div>
        )}
        {showIdle && <p className="foot">{t(lang, "notAffiliated")}</p>}
      </main>

      <Glass className="composer" data-theme="dark">
        {(listening || caption) && <p className="live-caption" aria-live="polite">{listening && !caption ? t(lang, "listening") : caption}</p>}
        <div className="composer-row">
          <Input value={text} onValueChange={setText} placeholder={t(lang, "placeholder")} aria-label={t(lang, "placeholder")} enterKeyHint="send"
            onKeyDown={(e) => { if (e.key === "Enter") void run(text); }} />
          {text.trim()
            ? <Button className="mic" variant="filled" tint="#ffffff" icon={<SendHorizontal size={26} />} aria-label={t(lang, "send")} onClick={() => run(text)} />
            : canMic
              ? <Button className="mic" data-live={listening} variant="filled" tint="#ffffff" icon={listening ? <Square size={24} /> : <Mic size={28} />} aria-label={listening ? t(lang, "stop") : t(lang, "mic")} onClick={toggleMic} />
              : <Button className="mic" variant="filled" tint="#ffffff" icon={<SendHorizontal size={26} />} aria-label={t(lang, "send")} disabled />}
        </div>
      </Glass>

      {sheet === "why" && picked && rec && <WhySheet r={picked} lang={lang} onClose={() => setSheet(null)} trafficNote={rec.traffic.note} />}
      {sheet === "prefs" && (
        <PrefSheet lang={lang} prefs={prefs} card={card} onClose={() => setSheet(null)}
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
    <div>
      <p className="sub" style={{ marginTop: 0 }}>{t(lang, "whereAreYou")}</p>
      <div className="locrow">
        <button type="button" className="btn btn-primary" onClick={onDevice} disabled={busy}><LocateFixed size={20} aria-hidden />{busy ? t(lang, "locating") : t(lang, "useLocation")}</button>
      </div>
      <form className="place" onSubmit={(e) => { e.preventDefault(); onLookup(place); }}>
        <input className="plain-input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder={t(lang, "placeInput")} aria-label={t(lang, "placeInput")} inputMode="text" autoComplete="off" />
        <button type="submit" className="btn" disabled={busy || !place.trim()}>{t(lang, "go")}</button>
      </form>
      {msg && <p className="small" style={{ marginTop: 10 }} role="status">{msg}</p>}
      {candidates.length > 0 && (
        <ul className="near-list">{candidates.map((c) => <li key={`${c.label}${c.state}`}><button type="button" className="near-item" onClick={() => onPick(c)}><span className="near-name">{c.label}</span><span className="near-meta">{c.district}, {c.state}</span></button></li>)}</ul>
      )}
    </div>
  );
}
