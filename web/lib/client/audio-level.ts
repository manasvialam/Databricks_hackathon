"use client";
import { useEffect, useRef } from "react";

/**
 * Live microphone loudness (0 to 1) for the listening animation. Speech recognition does not expose audio, so this opens the mic
 * separately with an analyser. If the browser refuses a second mic stream (phones do: Android and iOS give the microphone to one user at a time, so the meter is desktop only) it quietly reports nothing and the
 * orb falls back to a gentle synthetic wave. Nothing is recorded or sent: samples are read and dropped.
 */
export function useMicLevel(active: boolean): { current: number | null } {
  const level = useRef<number | null>(null);
  useEffect(() => {
    if (!active) { level.current = null; return; }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent)) return;   // phones give the mic to one user at a time: a second stream makes speech recognition hear nothing
    let stop = false, raf = 0, stream: MediaStream | null = null, ctx: AudioContext | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new AC();
        const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
        an.fftSize = 512; an.smoothingTimeConstant = 0.6;
        src.connect(an);
        const buf = new Uint8Array(an.fftSize);
        const tick = () => {
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          const rms = Math.sqrt(sum / buf.length);
          level.current = Math.min(1, rms * 5);                 // speech sits around 0.05 to 0.2 RMS
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch { level.current = null; }
    })();
    return () => { stop = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); void ctx?.close().catch(() => {}); level.current = null; };
  }, [active]);
  return level;
}
