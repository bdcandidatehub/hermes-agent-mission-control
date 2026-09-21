// When should the bridge auto-generate the daily brief? Pure so it can be unit-tested.
const pad = (n) => String(n).padStart(2, "0");
/** Calendar date in the machine's LOCAL timezone, "YYYY-MM-DD". */
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const BRIEF_RETRY_MS = 30 * 60_000;

/**
 * @param {{ now: Date, briefHour: number, lastGeneratedAt: string | null, lastAttemptMs: number | null, inFlight: boolean }} s
 * Generate at most once per local day, only after `briefHour`, never concurrently, and not again within
 * 30 minutes of a failed attempt (so a broken Hermes doesn't get hammered with real model calls).
 */
export function shouldGenerateBrief({ now, briefHour, lastGeneratedAt, lastAttemptMs, inFlight }) {
  if (inFlight) return false;
  if (now.getHours() < briefHour) return false;
  if (lastGeneratedAt) {
    const g = new Date(lastGeneratedAt);
    if (!Number.isNaN(g.getTime()) && localDate(g) === localDate(now)) return false;
  }
  if (lastAttemptMs != null && now.getTime() - lastAttemptMs < BRIEF_RETRY_MS) return false;
  return true;
}
