"use client";
import { cleanNeed, isLatin, lcFirst } from "@/lib/need";
import { useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, Check, CircleCheck, Clock, ExternalLink, LocateFixed, MapPin, Minus, Navigation, Phone, Plus, Search, ShieldQuestion, Volume2, X } from "lucide-react";
import type { ResultDto } from "@/lib/recommend";
import type { RedFlagResult } from "@/lib/triage/redflags";
import type { Contribution, Preferences } from "@/lib/types";
import { chooseVoice, chosenVoice, speak, voiceChoices } from "@/lib/client/speech";
import { isNatural } from "@/lib/client/voices";
import { Name } from "./Name";
import { emergencyText, LANGS, say, svcLabel, t, termText, type Lang, type Msg } from "@/lib/i18n";
import type { NearbyHospital } from "@/lib/nearby";
import { placeLine } from "./Slip";
import { PRESET_PLACES } from "@/lib/places";
import { Tx, TxText } from "./Tx";

export type CardAnswer = "yes" | "no" | "unknown";

/** iOS-style bottom sheet: springs up, closes with a slide, and can be dragged down by its grabber. */
export function Sheet({ title, onClose, lang, onListen, children }: { title: string; onClose: () => void; lang: Lang; onListen?: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const drag = useRef<{ y: number; dy: number; t: number } | null>(null);

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(onClose, reduce ? 0 : 260);
  }, [closing, onClose]);

  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = overflow; prev?.focus?.({ preventScroll: true }); };
  }, []);

  const onDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, dy: 0, t: performance.now() };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (ref.current) ref.current.style.transition = "none";
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !ref.current) return;
    const dy = Math.max(0, e.clientY - drag.current.y);
    drag.current.dy = dy;
    ref.current.style.transform = `translateY(${dy}px)`;
  };
  const onUp = () => {
    const d = drag.current; drag.current = null;
    const el = ref.current;
    if (!d || !el) return;
    const v = d.dy / Math.max(1, performance.now() - d.t);
    if (d.dy > 110 || v > 0.6) { el.style.setProperty("--drag", `${d.dy}px`); el.style.transform = ""; el.style.transition = ""; close(); return; }
    el.style.transition = "transform .45s cubic-bezier(.32,.72,0,1)";
    el.style.transform = "";
  };

  return (
    <div className="scrim" data-closing={closing} onClick={close}>
      <div className="sheet" data-closing={closing} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="grabber" data-noread aria-label={t(lang, "close")} onClick={close}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        <div className="sheet-head">
          <h2 className="title">{title}</h2>
          {onListen && <button type="button" className="close tap" data-noread onClick={onListen} aria-label={t(lang, "listen")}><Volume2 size={16} strokeWidth={2.5} aria-hidden /></button>}
          <button type="button" className="close tap" data-noread onClick={close} aria-label={t(lang, "close")}><X size={16} strokeWidth={2.5} aria-hidden /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Term({ c, lang }: { c: Contribution; lang: Lang }) {
  const { label, detail } = termText(c, lang);
  // free text with no message key (the model's one-line reason, a data contradiction) is English: translate it
  const free = lang !== "en" && !c.dk && c.detail ? c.detail : null;
  return <span className="why-t">{label}{free ? <small className="why-d"><TxText text={free} lang={lang} /></small> : detail ? <small className="why-d">{detail}</small> : null}</span>;
}

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

/** Hold-up-to-the-desk view: the sentence to say, big and in English (what the staff read), the same in the person's language, and what to bring. */
export function DoorSheet({ r, lang, serviceId, need: said, onClose, onListen }: { r: ResultDto; lang: Lang; serviceId: string; need?: string | null; onClose: () => void; onListen?: () => void }) {
  const svcEn = svcLabel(serviceId, "en");
  const own = cleanNeed(said);                                    // what the person said, when they described a problem instead of tapping a tile
  const sayEn = own && isLatin(own) ? t("en", "sayNeedLine", { need: own }) : t("en", "sayLine", { service: lcFirst(svcEn) });
  return (
    <Sheet title={t(lang, "showAtDoor")} onClose={onClose} lang={lang} onListen={onListen}>
      <div className="door-big">
        <small lang="en">{r.name}</small>
        <p lang="en">{sayEn}</p>
        {own && isLatin(own) && <p className="door-own" lang="en">{t("en", "sayLine", { service: lcFirst(svcEn) })}</p>}
        {lang !== "en" && <p className="door-own" lang={lang}>{own ? t(lang, "sayNeedLine", { need: own }) : t(lang, "sayLine", { service: svcLabel(serviceId, lang) })}</p>}
      </div>
      <div className="block" style={{ marginTop: 20 }}>
        <h3 className="block-h">{t(lang, "carry")}</h3>
        <ul className="door-list">{t(lang, "carryItems").split("|").map((x) => <li key={x}><CircleCheck size={20} aria-hidden /><span>{x}</span></li>)}</ul>
      </div>
    </Sheet>
  );
}

export function WhySheet({ r, lang, onClose, trafficNote, context = [], onListen }: { r: ResultDto; lang: Lang; onClose: () => void; trafficNote: Msg; context?: Msg[]; onListen?: () => void }) {
  const pct = Math.round(r.pBest * 100);
  const ev = r.evidence.find((e) => e.snippets.length);
  const quote = ev?.snippets[0];
  const src = ev?.sources[0];
  return (
    <Sheet title={t(lang, "whyThis")} onClose={onClose} lang={lang} onListen={onListen}>
      <div className="why-hero">
        <p className="why-name"><Name text={r.name} lang={lang} /></p>
        <div className="why-row">
          <div className="why-pct">{pct}<small>%</small></div>
          <p className="why-intro">{t(lang, "whyIntro")}</p>
        </div>
        <div className="why-bar" aria-hidden><i style={{ width: `${pct}%` }} /></div>
      </div>
      {quote && (
        <section className="why-sec">
          <h3 className="why-h">{t(lang, "theySay")}</h3>
          {/* the facility's own text, cited verbatim, so it stays in the language it was written in */}
          <blockquote className="why-quote" lang="en">“{quote.text.length > 300 ? quote.text.slice(0, 297) + "…" : quote.text}”</blockquote>
          {src && (
            <p className="why-src">
              <a href={src.url} target="_blank" rel="noopener noreferrer">{t(lang, "source")}: <span lang="en">{host(src.url)}</span><ExternalLink size={13} aria-hidden /></a>
              {!src.namesFacility && <span> {t(lang, "srcNotNamed")}</span>}
            </p>
          )}
        </section>
      )}
      <section className="why-sec">
        <h3 className="why-h">{t(lang, "positives")}</h3>
        <ul className="why-list">
          <li><span className="why-ico pos"><Check size={18} strokeWidth={2.4} aria-hidden /></span><Term c={r.why.baseline} lang={lang} /></li>
          {r.why.positive.map((p) => <li key={p.label}><span className="why-ico pos"><Check size={18} strokeWidth={2.4} aria-hidden /></span><Term c={p} lang={lang} /></li>)}
        </ul>
      </section>
      {r.why.negative.length > 0 && (
        <section className="why-sec">
          <h3 className="why-h">{t(lang, "negatives")}</h3>
          <ul className="why-list neg">{r.why.negative.map((p) => <li key={p.label}><span className="why-ico neg"><Minus size={18} strokeWidth={2.4} aria-hidden /></span><Term c={p} lang={lang} /></li>)}</ul>
        </section>
      )}
    </Sheet>
  );
}

function Segmented<V extends string>({ value, onChange, items, labelledBy }: { value: V; onChange: (v: V) => void; items: { value: V; label: string }[]; labelledBy: string }) {
  const i = Math.max(0, items.findIndex((x) => x.value === value));
  return (
    <div className="seg" role="radiogroup" aria-labelledby={labelledBy}>
      <span className="seg-thumb" aria-hidden style={{ width: `calc((100% - 6px) / ${items.length})`, transform: `translateX(${i * 100}%)` }} />
      {items.map((x) => (
        <button key={x.value} type="button" role="radio" aria-checked={x.value === value} onClick={() => onChange(x.value)}>{x.label}</button>
      ))}
    </div>
  );
}

const SLIDERS: { k: keyof Preferences; label: "prefSpeed" | "prefTrust" | "prefCost" | "prefComfort" }[] = [
  { k: "speed", label: "prefSpeed" }, { k: "trust", label: "prefTrust" }, { k: "cost", label: "prefCost" }, { k: "comfort", label: "prefComfort" },
];

export function PrefSheet({ lang, prefs, card, onApply, onClose, onListen }: {
  lang: Lang; prefs: Preferences; card: CardAnswer; onApply: (p: Preferences, c: CardAnswer) => void; onClose: () => void; onListen?: () => void;
}) {
  const [p, setP] = useState(prefs);
  const [c, setC] = useState<CardAnswer>(card);
  return (
    <Sheet title={t(lang, "prefs")} onClose={onClose} lang={lang} onListen={onListen}>
      <div className="field" style={{ marginTop: 4 }}>
        <span className="field-label" id="card-q">{t(lang, "card")}</span>
        <Segmented labelledBy="card-q" value={c} onChange={setC}
          items={[{ value: "yes", label: t(lang, "yes") }, { value: "no", label: t(lang, "no") }, { value: "unknown", label: t(lang, "notSure") }]} />
      </div>
      {SLIDERS.map(({ k, label }) => (
        <div className="field" key={k}>
          <label className="field-label" htmlFor={`s-${k}`}>{t(lang, label)}<output htmlFor={`s-${k}`}>{Math.round(p[k] * 100)}</output></label>
          <input id={`s-${k}`} className="range" type="range" min={0} max={1} step={0.05} value={p[k]}
            style={{ ["--fill" as string]: `${p[k] * 100}%` }} onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} />
        </div>
      ))}
      <button type="button" className="btn btn-primary tap" style={{ width: "100%", marginTop: 28 }} onClick={() => onApply(p, c)}>{t(lang, "apply")}</button>
    </Sheet>
  );
}

export function LangSheet({ lang, onPick, onClose, onListen }: { lang: Lang; onPick: (l: Lang) => void; onClose: () => void; onListen?: () => void }) {
  const [, redraw] = useState(0);
  const code = LANGS.find((l) => l.id === lang)!.speech;
  const choices = voiceChoices(code).slice(0, 6), picked = chosenVoice(code), auto = choices[0];
  const hear = () => window.setTimeout(() => speak(t(lang, "voiceSample"), code), 50);
  return (
    <Sheet title={t(lang, "language")} onClose={onClose} lang={lang} onListen={onListen}>
      <div>
        {LANGS.map((l) => (
          <button key={l.id} type="button" className="check-row tap" lang={l.id} aria-pressed={l.id === lang} onClick={() => onPick(l.id)}>
            <span>{l.native}{l.native !== l.label && <small lang="en">{l.label}</small>}</span>
            {l.id === lang && <Check size={20} strokeWidth={2.5} aria-hidden />}
          </button>
        ))}
      </div>
      {choices.length > 0 && (
        <div className="block" style={{ marginTop: 18 }}>
          <h3 className="block-h">{t(lang, "voiceLabel")}</h3>
          <button type="button" className="check-row tap" aria-pressed={!picked} onClick={() => { chooseVoice(code, null); redraw((n) => n + 1); hear(); }}>
            <span>{t(lang, "voiceAuto")}<small lang="en">{auto.name.replace(/^Microsoft /, "")}</small></span>
            {!picked && <Check size={20} strokeWidth={2.5} aria-hidden />}
          </button>
          {choices.map((v) => (
            <button key={v.voiceURI || v.name} type="button" className="check-row tap" aria-pressed={picked?.name === v.name} onClick={() => { chooseVoice(code, v); redraw((n) => n + 1); hear(); }}>
              <span lang="en">{v.name.replace(/^Microsoft /, "")}<small>{isNatural(v) ? t(lang, "voiceNatural") : t(lang, "voiceBasic")}</small></span>
              {picked?.name === v.name && <Check size={20} strokeWidth={2.5} aria-hidden />}
            </button>
          ))}
          {!choices.some(isNatural) && <p className="small" style={{ padding: "8px 4px 0" }}>{t(lang, "voiceTip")}</p>}
        </div>
      )}
    </Sheet>
  );
}

export function EmergencyCard({ gate, lang, online }: { gate: RedFlagResult; lang: Lang; online: boolean }) {
  const cats = gate.categories.slice(0, 2);
  const helpline = gate.numbers.find((n) => n.number === "14416");
  return (
    <section className="emerg" role="alert" aria-labelledby="em-h">
      <h1 id="em-h" data-read>{t(lang, "emergencyTitle")}</h1>
      <p data-read>{t(lang, "emergencyNow")}</p>
      <div className="emerg-call" data-read="list">
        <a href="tel:108" className="tap"><span className="em-ring"><Phone size={22} aria-hidden /></span><div>{t(lang, "callNow", { n: 108 })}<span>{t(lang, "ambulance")}</span></div></a>
        <a href="tel:112" className="tap"><span className="em-ring"><Phone size={22} aria-hidden /></span><div>{t(lang, "callNow", { n: 112 })}<span>{t(lang, "emergencyAll")}</span></div></a>
        {helpline && <a href="tel:14416" className="tap"><span className="em-ring"><Phone size={22} aria-hidden /></span><div>{t(lang, "callNow", { n: 14416 })}<span>{t(lang, "teleManas")}</span></div></a>}
      </div>
      {cats.map((c) => {
        // the gate's own text is English; a translation replaces it whole, so a card never mixes two languages
        const tr = emergencyText(c.id, lang);
        const text = tr ?? { label: c.label, now: c.now, wait: c.whileWaiting };
        return (
          <div key={c.id} lang={tr ? lang : "en"} className="emerg-cat">
            <p data-read><b>{text.label}.</b> {text.now}</p>
            {text.wait && <p className="wait" data-read><span lang={lang}>{t(lang, "whileWaiting")}:</span> {text.wait}</p>}
          </div>
        );
      })}
      {!online && <p style={{ fontSize: 14 }}>{t(lang, "emergencyOffline")}</p>}
    </section>
  );
}

export function HospitalWhySheet({ h, lang, onClose, onListen }: { h: NearbyHospital; lang: Lang; onClose: () => void; onListen?: () => void }) {
  const pos: string[] = h.fitWhy ? [say(h.fitWhy, lang), t(lang, "whyNear", { km: h.km })] : [t(lang, "whyNear", { km: h.km })];
  if (h.registry === "verified") pos.push(t(lang, "pmjayListed"));
  if (h.nabh) pos.push(t(lang, "nabh"));
  if (h.open24h) pos.push(t(lang, "open24"));
  if (h.services.length) pos.push(t(lang, "whyServices", { n: h.services.length }));
  return (
    <Sheet title={t(lang, "whyThis")} onClose={onClose} lang={lang} onListen={onListen}>
      <p className="muted">{t(lang, h.fit !== undefined ? "whyGeneralFit" : "whyGeneral")}</p>
      <div className="block">
        <ul className="why-list">{pos.map((x) => <li key={x}><span className="why-ico pos"><Plus size={14} strokeWidth={2.5} aria-hidden /></span><span>{x}</span></li>)}</ul>
      </div>
      {h.warnings.length > 0 && (
        <div className="block">
          <h3 className="block-h">{t(lang, "negatives")}</h3>
          <ul className="why-list">{h.warnings.map((w) => <li key={w.text}><span className="why-ico neg"><Minus size={14} strokeWidth={2.5} aria-hidden /></span><span><Tx m={w} lang={lang} /></span></li>)}</ul>
        </div>
      )}
      <div className="block card-flat" style={{ display: "grid", gap: 8 }}>
        {h.registry && <p className="small">{t(lang, "registryNote")}</p>}
        <p className="small">{t(lang, "estimate")}</p>
        <p className="small">{t(lang, "notAffiliated")}</p>
      </div>
    </Sheet>
  );
}

export interface PlaceChoice { label: string; state?: string; district?: string; lat: number; lon: number }

/** Uber Eats-style location picker: search a town, PIN or full address, use the device location, or reuse a recent place. */
interface Suggestion { label: string; sub: string; lat: number; lon: number; kind: string }

export function LocSheet({ lang, busy, msg, candidates, recent, hint, confirm, near, onYes, onNo, onDevice, onLookup, onPick, onClose, onListen }: {
  near?: { lat: number; lon: number } | null;
  lang: Lang; busy: boolean; msg: string | null; candidates: PlaceChoice[]; recent: PlaceChoice[]; hint?: string | null;
  confirm?: { text: string; place: string } | null; onYes?: () => void; onNo?: () => void;
  onDevice: () => void; onLookup: (q: string) => void; onPick: (c: PlaceChoice) => void; onClose: () => void; onListen?: () => void;
}) {
  const [q, setQ] = useState("");
  const [sugg, setSugg] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = q.trim();
  // address suggestions as the person types: a short pause, then the server's own PIN and town data plus street-level OpenStreetMap results
  useEffect(() => {
    setActive(-1);
    if (typed.length < 2) { setSugg([]); setSearching(false); return; }
    setSearching(true);
    const ctl = new AbortController();
    const id = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/places?q=${encodeURIComponent(typed)}${near ? `&lat=${near.lat}&lon=${near.lon}` : ""}`, { signal: ctl.signal, cache: "no-store" });
        setSugg(r.ok ? ((await r.json()) as { places: Suggestion[] }).places : []);
      } catch { if (!ctl.signal.aborted) setSugg([]); }
      if (!ctl.signal.aborted) setSearching(false);
    }, 260);
    return () => { window.clearTimeout(id); ctl.abort(); };
  }, [typed, near?.lat, near?.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickSuggestion = (s: Suggestion) => onPick({ label: s.sub ? `${s.label}, ${s.sub}` : s.label, lat: s.lat, lon: s.lon });
  if (confirm) {
    return (
      <Sheet title={t(lang, "locSheetTitle")} onClose={onClose} lang={lang} onListen={onListen}>
        <div className="confirm">
          <p className="ask" data-read>{confirm.text}</p>
          <p className="place-chip" data-read><MapPin size={18} aria-hidden /><Name text={confirm.place} lang={lang} /></p>
          <div className="btn-row">
            <button type="button" className="btn btn-primary tap" onClick={onYes}>{t(lang, "confirmYes")}</button>
            <button type="button" className="btn tap" onClick={onNo}>{t(lang, "confirmNo")}</button>
          </div>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title={t(lang, "locSheetTitle")} onClose={onClose} lang={lang} onListen={onListen}>
      {hint && <p className="muted" style={{ marginBottom: 12 }}>{hint}</p>}
      <form className="searchbar" onSubmit={(e) => { e.preventDefault(); if (active >= 0 && sugg[active]) pickSuggestion(sugg[active]); else if (typed) onLookup(q); }}>
        <Search size={18} aria-hidden />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(lang, "locSearchPh2")} aria-label={t(lang, "locSearchPh2")} autoComplete="off" enterKeyHint="search"
          role="combobox" aria-expanded={typed.length >= 2} aria-controls="place-suggestions" aria-autocomplete="list" aria-activedescendant={active >= 0 ? `ps-${active}` : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && sugg.length) { e.preventDefault(); setActive((a) => (a + 1) % sugg.length); }
            else if (e.key === "ArrowUp" && sugg.length) { e.preventDefault(); setActive((a) => (a <= 0 ? sugg.length - 1 : a - 1)); }
          }} />
        {q.trim() && <button type="submit" className="cap-btn tap" data-kind="send" aria-label={t(lang, "go")} disabled={busy}><Search size={18} aria-hidden /></button>}
      </form>
      {typed.length >= 2 && (
        <div className="block" id="place-suggestions" role="listbox" style={{ marginTop: 10 }}>
          {sugg.map((s, i) => (
            <button key={`${s.label}${s.lat}${s.lon}`} id={`ps-${i}`} type="button" role="option" aria-selected={i === active} className={`loc-row tap${i === active ? " active" : ""}`} onClick={() => pickSuggestion(s)}>
              <span className="loc-ico"><MapPin size={18} aria-hidden /></span>
              <span><Name text={s.label} lang={lang} />{s.sub && <small><Name text={s.sub} lang={lang} /></small>}</span>
            </button>
          ))}
          {!sugg.length && <p className="small" role="status" style={{ padding: "10px 4px" }}>{searching ? t(lang, "searchingPlaces") : t(lang, "noPlaceMatch")}</p>}
          {sugg.length > 0 && searching && <p className="tiny" style={{ padding: "4px" }}>{t(lang, "searchingPlaces")}</p>}
        </div>
      )}
      {typed.length < 2 && <button type="button" className="loc-row tap" onClick={onDevice} disabled={busy}>
        <span className="loc-ico"><LocateFixed size={18} aria-hidden /></span>
        <span>{busy ? t(lang, "locating") : t(lang, "useCurrent")}</span>
      </button>}
      {msg && <p className="small" role="status" style={{ padding: "4px 4px 0" }}>{msg}</p>}
      {candidates.length > 0 && (
        <div className="block" style={{ marginTop: 14 }}>
          {candidates.map((c) => (
            <button key={`${c.label}${c.state}${c.lat}`} type="button" className="loc-row tap" onClick={() => onPick(c)}>
              <span className="loc-ico"><MapPin size={18} aria-hidden /></span>
              <span><Name text={c.label} lang={lang} />{c.district && <small><Name text={`${c.district}, ${c.state}`} lang={lang} /></small>}</span>
            </button>
          ))}
        </div>
      )}
      {!candidates.length && typed.length < 2 && (
        <div className="block" style={{ marginTop: 14 }}>
          <h3 className="block-h">{t(lang, "suggestedPlaces")}</h3>
          {PRESET_PLACES.map((c) => (
            <button key={c.query} type="button" className="loc-row tap" onClick={() => onLookup(c.query)} disabled={busy}>
              <span className="loc-ico"><MapPin size={18} aria-hidden /></span>
              <span><Name text={c.label} lang={lang} /><small><Name text={c.sub} lang={lang} /></small></span>
            </button>
          ))}
        </div>
      )}
      {recent.length > 0 && !candidates.length && typed.length < 2 && (
        <div className="block" style={{ marginTop: 14 }}>
          <h3 className="block-h">{t(lang, "recentPlaces")}</h3>
          {recent.map((c) => (
            <button key={`${c.label}${c.lat}`} type="button" className="loc-row tap" onClick={() => onPick(c)}>
              <span className="loc-ico"><Clock size={18} aria-hidden /></span>
              <Name text={c.label} lang={lang} />
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
