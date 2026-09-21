"use client";

/* Friday: talk to your chief of staff from the top of the dashboard. A living brain on the left (it reacts to whether
   she's listening, thinking or speaking, and moves with her actual voice), the conversation on the right. Everything
   she says is also on screen; voice and motion are additions to a fully working text chat. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Loader2, Mic, RotateCcw, Square, Volume2, VolumeX } from "lucide-react";
import { BrainCanvas, type BrainState } from "@/components/friday/brain-canvas";
import { VoicePlayer, listenOnce, recognitionSupported, type Listener } from "@/lib/friday-voice";

interface Turn { id: string; status: string; message: string; reply: string | null; error: string | null; createdAt: string }

const LIVE = new Set(["queued", "approved", "running"]);
const SUGGESTIONS = ["What needs me today?", "Summarize the pipeline", "Who should I follow up with first?"];
const CYAN = "#5ee7ff";

const MIC_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it in your browser's site settings, or type instead.",
  "service-not-allowed": "This browser won't allow voice input here. You can type instead.",
  "no-speech": "I didn't catch that. Tap Talk and try again.",
  "audio-capture": "No microphone found.",
  network: "Voice input needs a network connection in this browser. You can type instead.",
};

const STATUS: Record<BrainState, { label: string; color: string }> = {
  idle: { label: "Ready", color: "var(--text-2)" },
  listening: { label: "Listening…", color: CYAN },
  thinking: { label: "Thinking…", color: "#b7a6ff" },
  speaking: { label: "Speaking", color: CYAN },
};

export function FridayPanel() {
  const [player] = useState(() => new VoicePlayer());
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [serverVoice, setServerVoice] = useState<boolean | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [micSupported, setMicSupported] = useState(false);
  const [waited, setWaited] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  const listener = useRef<Listener | null>(null);
  const spoken = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  const scroller = useRef<HTMLOListElement>(null);
  const voiceRef = useRef({ voiceOn, serverVoice });
  useEffect(() => { voiceRef.current = { voiceOn, serverVoice }; }, [voiceOn, serverVoice]);

  const pending = useMemo(() => turns.some((t) => LIVE.has(t.status)), [turns]);
  const brainState: BrainState = listening ? "listening" : pending || sending ? "thinking" : speaking ? "speaking" : "idle";
  const level = useCallback(() => player.level(), [player]);

  // ── setup: remembered voice preference, mic support, voice server status
  useEffect(() => {
    try { setVoiceOn(localStorage.getItem("friday.voice") !== "off"); } catch { /* storage blocked */ }
    setMicSupported(recognitionSupported());
    let alive = true;
    const check = () => fetch("/api/friday/voice").then((r) => r.json()).then((j) => alive && setServerVoice(!!j.available)).catch(() => alive && setServerVoice(false));
    check();
    const iv = setInterval(check, 30_000);
    return () => { alive = false; clearInterval(iv); player.stop(); listener.current?.abort(); };
  }, [player]);

  // ── conversation: load, then poll faster while she's working
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/friday/chat");
      if (!r.ok) throw new Error();
      const j = (await r.json()) as { turns: Turn[] };
      setTurns(j.turns);
    } catch { /* keep what we have */ }
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const iv = setInterval(load, pending ? 1000 : 15_000);
    return () => clearInterval(iv);
  }, [pending, load]);

  useEffect(() => {
    if (!pending) { setWaited(0); return; }
    const iv = setInterval(() => setWaited((w) => w + 1), 1000);
    return () => clearInterval(iv);
  }, [pending]);

  const speak = useCallback(async (text: string) => {
    setSpeaking(true);
    await player.unlock();
    const r = await player.speak(text, { serverVoice: voiceRef.current.serverVoice === true });
    setSpeaking(player.speaking);
    if (r === "blocked") setNote("Your browser blocked autoplay. Use the speaker icon next to a reply to hear it.");
  }, [player]);

  // ── speak each new reply once; replies already there on page load stay quiet
  useEffect(() => {
    if (!loaded) return;
    const done = turns.filter((t) => t.status === "done" && t.reply);
    if (firstLoad.current) { done.forEach((t) => spoken.current.add(t.id)); firstLoad.current = false; return; }
    for (const t of done) {
      if (spoken.current.has(t.id)) continue;
      spoken.current.add(t.id);
      if (voiceRef.current.voiceOn) void speak(t.reply!);
    }
  }, [turns, loaded, speak]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [turns.length, pending]);

  const send = useCallback(async (raw: string) => {
    const message = raw.trim();
    if (!message || sending) return;
    setError(null); setNote(null); setSending(true);
    void player.unlock(); // a click/keypress: the only moment the browser lets us start audio
    player.stop(); setSpeaking(false);
    try {
      const r = await fetch("/api/friday/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? "Couldn't reach Friday."); return; }
      setInput("");
      await load();
    } catch { setError("Couldn't reach Friday. Is the dashboard server running?"); }
    finally { setSending(false); }
  }, [load, player, sending]);

  const stopAll = useCallback(() => { player.stop(); setSpeaking(false); listener.current?.abort(); setListening(false); setInterim(""); }, [player]);

  const toggleMic = useCallback(async () => {
    if (listening) { listener.current?.stop(); return; }
    player.stop(); setSpeaking(false); setError(null);
    await player.unlock();
    setInterim(""); setListening(true);
    listener.current = listenOnce({
      onInterim: setInterim,
      onFinal: (t) => { void send(t); },
      onEnd: () => { setListening(false); setInterim(""); },
      onError: (code) => { setListening(false); setInterim(""); setError(MIC_ERRORS[code] ?? "Voice input stopped unexpectedly. You can type instead."); },
    });
    if (!listener.current) setListening(false);
  }, [listening, player, send]);

  const setVoice = (on: boolean) => { setVoiceOn(on); try { localStorage.setItem("friday.voice", on ? "on" : "off"); } catch { /* storage blocked */ } if (!on) stopAll(); };

  const status = STATUS[brainState];
  const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5ee7ff]";

  return (
    <section
      aria-label="Friday, your chief of staff"
      className="panel overflow-hidden"
      onKeyDown={(e) => { if (e.key === "Escape") stopAll(); }}
    >
      <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        {/* ── stage: the brain ── */}
        <div
          className="relative min-h-[390px] lg:min-h-[460px]"
          style={{ background: "radial-gradient(120% 90% at 50% 44%, rgba(22,112,162,0.34) 0%, rgba(9,32,50,0.62) 46%, #060b10 100%)" }}
        >
          <BrainCanvas state={brainState} level={level} className="absolute inset-0" />
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28" style={{ background: "linear-gradient(to bottom, rgba(6,11,16,0.78), rgba(6,11,16,0))" }} />
          <div className="relative z-10 flex h-full min-h-[390px] flex-col justify-between p-5 lg:min-h-[460px]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--text)]">Friday</h2>
                <p role="status" aria-live="polite" className="mt-1 flex items-center gap-2 text-[13px]" style={{ color: status.color }}>
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: status.color }} />
                  {status.label}
                </p>
                <p className="mt-1 text-[12px] text-[var(--text-2)]">
                  {serverVoice === null ? "" : serverVoice ? "Local voice ready" : "Using the browser's voice"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {speaking && (
                  <button type="button" onClick={stopAll} className={`inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-3 text-[12.5px] text-[var(--text)] hover:bg-white/[0.06] ${focusRing}`}>
                    <Square className="h-3 w-3" aria-hidden /> Stop
                  </button>
                )}
                <button
                  type="button" onClick={() => setVoice(!voiceOn)} aria-pressed={!voiceOn}
                  aria-label={voiceOn ? "Mute Friday's voice" : "Unmute Friday's voice"} title={voiceOn ? "Mute Friday's voice" : "Unmute Friday's voice"}
                  className={`grid h-9 w-9 place-items-center rounded-full border border-white/15 text-[var(--text)] hover:bg-white/[0.06] ${focusRing}`}
                >
                  {voiceOn ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
                </button>
              </div>
            </div>

            <div className="flex flex-col items-center gap-2">
              {interim && <p className="max-w-[90%] text-center text-[14px] text-[var(--text)]" aria-live="polite">&ldquo;{interim}&rdquo;</p>}
              <button
                type="button" onClick={toggleMic} disabled={!micSupported} aria-pressed={listening}
                title={micSupported ? undefined : "Voice input needs Safari or Chrome. You can type instead."}
                className={`inline-flex h-12 items-center gap-2.5 rounded-full border px-6 text-[14px] font-medium text-[var(--text)] transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
                style={{ borderColor: listening ? CYAN : "rgba(94,231,255,0.42)", background: listening ? "rgba(14,58,76,0.94)" : "rgba(8,27,41,0.9)" }}
              >
                <Mic className="h-4 w-4" aria-hidden style={{ color: CYAN }} />
                {listening ? "Listening. Tap when done" : "Talk to Friday"}
              </button>
              {!micSupported && <p className="text-[12px] text-[var(--text-2)]">Voice input isn&apos;t available in this browser. Type below.</p>}
            </div>
          </div>
        </div>

        {/* ── conversation ── */}
        <div className="flex min-h-[340px] flex-col border-t border-[var(--line)] lg:border-l lg:border-t-0">
          <ol ref={scroller} role="log" aria-live="polite" aria-label="Conversation with Friday" className="flex-1 space-y-5 overflow-y-auto p-5 lg:max-h-[404px]">
            {!loaded ? null : turns.length === 0 ? (
              <li className="flex h-full min-h-[200px] flex-col justify-center gap-4">
                <p className="text-[17px] font-medium leading-snug tracking-[-0.01em] text-[var(--text)]">Ask Friday what needs you today.</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} disabled={sending}
                      className={`rounded-full border border-white/12 px-3.5 py-2 text-[13px] text-[var(--text-2)] transition-colors hover:bg-white/[0.05] hover:text-[var(--text)] disabled:opacity-50 ${focusRing}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </li>
            ) : (
              turns.map((t) => (
                <li key={t.id} className="space-y-3">
                  <div className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-[12px] bg-white/[0.06] px-3.5 py-2.5 text-[14px] leading-relaxed text-[var(--text)]">{t.message}</p>
                  </div>
                  {t.status === "done" && t.reply ? (
                    <div className="group flex items-start gap-2">
                      <p className="max-w-[92%] whitespace-pre-wrap break-words text-[15px] leading-relaxed text-[var(--text)]">{t.reply}</p>
                      <button type="button" onClick={() => speak(t.reply!)} aria-label="Play this reply aloud" title="Play aloud"
                        className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[var(--text-2)] hover:bg-white/[0.06] hover:text-[var(--text)] ${focusRing}`}>
                        <Volume2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  ) : t.status === "failed" || t.status === "rejected" ? (
                    <div className="flex items-center gap-3 text-[13.5px] text-[var(--down)]" role="alert">
                      <span>{t.error ?? "Friday couldn't answer that."}</span>
                      <button type="button" onClick={() => send(t.message)} disabled={sending || pending}
                        className={`inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[12.5px] text-[var(--text)] hover:bg-white/[0.06] disabled:opacity-50 ${focusRing}`}>
                        <RotateCcw className="h-3 w-3" aria-hidden /> Try again
                      </button>
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 text-[14px] text-[var(--text-2)]">
                      <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
                      {waited > 45 ? "Still working. If this hangs, check that the bridge is running." : "Friday is thinking…"}
                    </p>
                  )}
                </li>
              ))
            )}
          </ol>

          <form
            className="border-t border-[var(--line)] p-4"
            onSubmit={(e) => { e.preventDefault(); void send(input); }}
          >
            {error && <p role="alert" className="mb-2.5 text-[13px] text-[var(--down)]">{error}</p>}
            {!error && note && <p role="status" className="mb-2.5 text-[13px] text-[var(--text-2)]">{note}</p>}
            <div className="flex items-center gap-2">
              <input
                value={input} onChange={(e) => setInput(e.target.value)} maxLength={2000} autoComplete="off"
                aria-label="Message Friday" placeholder="Ask Friday anything…"
                className={`h-11 min-w-0 flex-1 rounded-[12px] border border-white/12 bg-white/[0.03] px-3.5 text-[14px] text-[var(--text)] caret-[#5ee7ff] placeholder:text-[var(--text-2)] focus-visible:border-[#5ee7ff] focus-visible:outline-none`}
              />
              <button
                type="submit" disabled={!input.trim() || sending || pending} aria-label="Send message" title={pending ? "Friday is still answering" : "Send"}
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-[#04121a] transition-opacity disabled:opacity-40 ${focusRing}`}
                style={{ background: CYAN }}
              >
                {sending ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> : <ArrowUp className="h-4 w-4" aria-hidden />}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
