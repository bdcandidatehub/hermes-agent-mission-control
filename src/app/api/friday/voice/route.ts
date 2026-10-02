import { NextResponse } from "next/server";
import { ttsConfig } from "@/lib/friday-tts";

export const dynamic = "force-dynamic";

// GET → is Friday's voice server reachable? The panel falls back to the browser's voice when it isn't.
export async function GET() {
  const cfg = ttsConfig();
  try {
    const r = await fetch(`${cfg.url}/health`, { signal: AbortSignal.timeout(1500) });
    return NextResponse.json({ available: r.ok, engine: "kokoro", voice: cfg.voice });
  } catch {
    return NextResponse.json({ available: false, engine: "kokoro", voice: cfg.voice });
  }
}
