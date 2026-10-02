// Where Friday's voice comes from. Any OpenAI-compatible /v1/audio/speech server works (Kokoro-FastAPI by default).
export function ttsConfig() {
  return {
    url: (process.env.FRIDAY_TTS_URL || "http://127.0.0.1:8880").replace(/\/+$/, ""),
    voice: process.env.FRIDAY_TTS_VOICE || "bf_emma", // Kokoro British female; see .env.example for others
    model: process.env.FRIDAY_TTS_MODEL || "kokoro",
    speed: Number(process.env.FRIDAY_TTS_SPEED) || 1,
    apiKey: process.env.FRIDAY_TTS_API_KEY || "",
  };
}
