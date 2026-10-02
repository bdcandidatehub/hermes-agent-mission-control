"use client";

// Friday's voice in the browser: speaks a reply sentence by sentence through the local TTS server (via
// /api/friday/speak), exposes the live loudness (so the brain can move with her voice), and falls back to the
// browser's own voice if the server isn't running. Also wraps the browser's speech recognition for talking to her.
import { speakable } from "./speech";

export type SpeakResult = "played" | "fallback" | "stopped" | "silent" | "blocked";

export class VoicePlayer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private token = 0;
  private samples = new Uint8Array(512);
  private smooth = 0;
  private synth = false; // speaking through the browser voice
  private synthStart = 0;
  speaking = false;

  // Call from a click or key press: browsers only allow audio after a user gesture.
  async unlock(): Promise<void> {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.6;
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});
  }

  // 0..1 loudness right now (smoothed). Real audio when we have it; a gentle synthetic pulse for the browser voice.
  level(): number {
    let target = 0;
    if (this.analyser && this.sources.size > 0) {
      this.analyser.getByteTimeDomainData(this.samples);
      let sum = 0;
      for (let i = 0; i < this.samples.length; i++) { const v = (this.samples[i] - 128) / 128; sum += v * v; }
      target = Math.min(1, Math.sqrt(sum / this.samples.length) * 3.2);
    } else if (this.synth) {
      const t = (performance.now() - this.synthStart) / 1000;
      target = 0.35 + 0.25 * Math.abs(Math.sin(t * 9)) * (0.6 + 0.4 * Math.sin(t * 2.3));
    }
    this.smooth += (target - this.smooth) * 0.35;
    return this.smooth;
  }

  stop(): void {
    this.token++;
    for (const s of this.sources) { try { s.onended = null; s.stop(); } catch { /* already stopped */ } }
    this.sources.clear();
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    this.synth = false;
    this.speaking = false;
  }

  private async fetchChunk(text: string): Promise<AudioBuffer> {
    const r = await fetch("/api/friday/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (!r.ok) throw new Error("voice_unavailable");
    return this.ctx!.decodeAudioData(await r.arrayBuffer());
  }

  async speak(text: string, { serverVoice }: { serverVoice: boolean }): Promise<SpeakResult> {
    const { chunks } = speakable(text);
    if (chunks.length === 0) return "silent";
    this.stop();
    const mine = this.token;
    // Browsers only let audio start after a click/keypress. If we were never unlocked, say so instead of hanging.
    if (this.ctx && this.ctx.state !== "running") await this.ctx.resume().catch(() => {});
    if (serverVoice && (!this.ctx || this.ctx.state !== "running")) return "blocked";
    this.speaking = true;
    try {
      if (serverVoice && this.ctx && this.analyser) {
        let next: Promise<AudioBuffer> = this.fetchChunk(chunks[0]);
        let startAt = 0;
        let totalSeconds = 0;
        let lastSource: AudioBufferSourceNode | null = null;
        for (let i = 0; i < chunks.length; i++) {
          const buf = await next;
          if (this.token !== mine) return "stopped";
          if (i + 1 < chunks.length) next = this.fetchChunk(chunks[i + 1]); // prefetch the next sentence while this one plays
          const src = this.ctx.createBufferSource();
          src.buffer = buf;
          src.connect(this.analyser);
          startAt = Math.max(this.ctx.currentTime + 0.03, startAt);
          src.start(startAt);
          startAt += buf.duration;
          totalSeconds += buf.duration;
          this.sources.add(src);
          src.onended = () => this.sources.delete(src);
          lastSource = src;
        }
        // finished when the last sentence ends, when stop() is called, or (safety net) well after it should have
        await new Promise<void>((resolve) => {
          if (!lastSource) return resolve();
          const end = () => { clearInterval(poll); clearTimeout(cap); resolve(); };
          const poll = setInterval(() => { if (this.token !== mine) end(); }, 200);
          const cap = setTimeout(end, (totalSeconds + 8) * 1000);
          lastSource.addEventListener("ended", end, { once: true });
        });
        if (this.token !== mine) return "stopped";
        this.speaking = false;
        return "played";
      }
      throw new Error("no server voice");
    } catch {
      if (this.token !== mine) return "stopped";
      return this.speakWithBrowser(chunks.join(" "), mine);
    }
  }

  private speakWithBrowser(text: string, mine: number): Promise<SpeakResult> {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) { this.speaking = false; return Promise.resolve("silent"); }
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      u.voice = voices.find((v) => /en-GB/i.test(v.lang) && /female|serena|kate|martha|stephanie/i.test(v.name)) ?? voices.find((v) => /en-GB/i.test(v.lang)) ?? null;
      u.lang = u.voice?.lang ?? "en-GB";
      u.rate = 1;
      this.synth = true;
      this.synthStart = performance.now();
      const finish = (r: SpeakResult) => { this.synth = false; if (this.token === mine) this.speaking = false; resolve(r); };
      u.onend = () => finish("fallback");
      u.onerror = () => finish(this.token === mine ? "fallback" : "stopped");
      window.speechSynthesis.speak(u);
    });
  }
}

/* ───────────── speech recognition (talking TO Friday) ───────────── */

interface RecognitionEvent { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }
interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecognitionCtor = new () => Recognition;

export function recognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export interface Listener { stop(): void; abort(): void }

// How long to wait, after the last word detected, before treating a pause as "done talking".
// The Web Speech API has no such setting itself — with continuous:false the browser's own endpointer
// decides that, and on Chrome in particular it can cut you off after well under a second. So we run in
// continuous mode instead (it never auto-ends on a pause) and time the silence ourselves.
const SILENCE_MS = 3500;

// One turn: interim text as you speak, then a final transcript once you've been quiet for SILENCE_MS.
export function listenOnce(
  handlers: { onInterim: (t: string) => void; onFinal: (t: string) => void; onEnd: () => void; onError: (code: string) => void },
  silenceMs = SILENCE_MS
): Listener | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = navigator.language || "en-CA";
  rec.interimResults = true;
  rec.continuous = true; // keep listening through natural pauses; our own timer below decides when the turn ends
  rec.maxAlternatives = 1;
  let finalText = "";
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  const clearSilence = () => { if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; } };
  // Any activity (even an interim word) pushes the deadline out; stop() lets the engine flush a trailing
  // final result for whatever it just heard, rather than dropping it the way abort() would.
  const armSilence = () => { clearSilence(); silenceTimer = setTimeout(() => { try { rec.stop(); } catch { /* already stopping */ } }, silenceMs); };

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
    }
    handlers.onInterim((finalText + interim).trim());
    armSilence();
  };
  rec.onerror = (e) => { clearSilence(); handlers.onError(e.error); };
  rec.onend = () => { clearSilence(); if (finalText.trim()) handlers.onFinal(finalText.trim()); handlers.onEnd(); };
  try { rec.start(); armSilence(); } catch { handlers.onError("start-failed"); return null; }
  return {
    stop: () => { clearSilence(); rec.stop(); },
    abort: () => { clearSilence(); rec.abort(); },
  };
}
