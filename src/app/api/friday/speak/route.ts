import { NextResponse } from "next/server";
import { ttsConfig } from "@/lib/friday-tts";

export const dynamic = "force-dynamic";
const MAX_CHARS = 1200;

// POST { text } → audio/mpeg from the local text-to-speech server (Kokoro by default, OpenAI-compatible API).
// Proxied through here so the browser stays same-origin (needed to analyse the audio) and the TTS port stays private.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  if (text.length > MAX_CHARS) return NextResponse.json({ error: "text too long" }, { status: 413 });

  const cfg = ttsConfig();
  try {
    const upstream = await fetch(`${cfg.url}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify({ model: cfg.model, voice: cfg.voice, input: text, response_format: "mp3", speed: cfg.speed }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!upstream.ok || !upstream.body) return NextResponse.json({ error: "voice_unavailable" }, { status: 503 });
    return new Response(upstream.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "voice_unavailable" }, { status: 503 });
  }
}
