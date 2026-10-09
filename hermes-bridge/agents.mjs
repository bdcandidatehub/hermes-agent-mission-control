// Agent helpers for the bridge (pure, unit-tested): read the roster from `hermes profile list`, pull each
// profile's full model name from its config.yaml, and compose a direct-chat prompt.

const ANSI = /\x1b\[[0-9;]*m/g;

// A profile id is passed to `hermes -p <id>`; keep it to plain slug characters so it can never read as a flag.
/** @param {unknown} id @returns {boolean} */
export function validProfileId(id) {
  return typeof id === "string" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(id);
}

// `hermes profile list` prints a table:
//   Profile           Model                  Gateway   Alias   Distribution
//   ◆Friday (default) nvidia/nemotron-3-s…   running   —       —
//   mason             openai/gpt-5.6-sol     stopped   —       —
// followed by optional "⚠ …" warning lines. The model column is truncated, so callers should prefer config.yaml.
/** @param {string} raw @returns {{ id: string, name: string, isDefault: boolean, model: string, gateway: string }[]} */
export function parseProfileList(raw) {
  const lines = String(raw ?? "").replace(ANSI, "").split("\n");
  const header = lines.findIndex((l) => /^\s*Profile\s+Model\s+Gateway/i.test(l));
  if (header < 0) return [];
  const out = [];
  for (const line of lines.slice(header + 1)) {
    if (/^[\s─-]+$/.test(line) && line.trim()) continue; // the divider under the header
    if (!line.trim() || /^\s*⚠/.test(line)) break;
    const m = line.trim().match(/^(◆)?\s*([A-Za-z0-9_-]+)(\s+\(default\))?\s+(\S+)\s+(\S+)/);
    if (!m) continue;
    const isDefault = !!m[1] || !!m[3];
    out.push({ id: isDefault ? "default" : m[2].toLowerCase(), name: m[2], isDefault, model: m[4], gateway: m[5] });
  }
  return out;
}

// config.yaml has a block like:
//   model:
//     default: openai/gpt-5.6-sol
//     provider: openrouter
/** @param {string} yaml @returns {string | null} */
export function modelFromConfig(yaml) {
  const lines = String(yaml ?? "").split("\n");
  const start = lines.findIndex((l) => /^model:\s*(#.*)?$/.test(l));
  if (start < 0) return null;
  for (const l of lines.slice(start + 1)) {
    if (l.trim() && !/^\s/.test(l)) break; // left the model block
    const m = l.match(/^\s+default:\s*['"]?([^'"\s#]+)/);
    if (m) return m[1];
  }
  return null;
}

// One direct text turn with a named agent. Unlike Friday's spoken lane this is a typed chat, so normal formatting is fine.
/** @param {{ message: string }} t @returns {string} */
export function composeAgentQuery({ message }) {
  return (
    "[Channel: direct text chat with the operator on the Hermy HQ Agents page. Reply conversationally and concisely. " +
    "If the request needs real work, do it with your tools and say what you did; never claim an action you did not take.]\n\n" +
    String(message).trim()
  );
}

// Is an agent in the middle of a turn? Judged from the newest message in its session database:
//   a user message or tool result is waiting for the model, and an assistant message with tool calls is waiting for the tools,
//   so the agent is working; a plain assistant reply means the turn is finished. A turn that has shown no sign of life for
//   `windowSec` is treated as abandoned (a crash shouldn't leave an agent "working" forever).
/** @param {{ role?: string, tool_calls?: unknown, timestamp?: number|string|null, source?: string|null } | null | undefined} m
 *  @param {number} nowSec @param {number} [windowSec] @returns {{ working: boolean, source?: string }} */
export function classifyTurn(m, nowSec, windowSec = 600) {
  if (!m || m.timestamp == null) return { working: false };
  const age = nowSec - Number(m.timestamp);
  if (!Number.isFinite(age) || age < -5 || age > windowSec) return { working: false };
  const calls = typeof m.tool_calls === "string" ? m.tool_calls.trim() : m.tool_calls;
  const hasCalls = !!calls && calls !== "[]" && calls !== "null" && !(Array.isArray(calls) && calls.length === 0);
  const waiting = m.role === "user" || m.role === "tool" || (m.role === "assistant" && hasCalls);
  return waiting ? { working: true, source: m.source || undefined } : { working: false };
}

// A turn holds a lease in the profile's session_turn_leases table while the model is working (it expires on its own after
// about five minutes, and a crashed process leaves an expired row behind). A lease that hasn't expired means working.
// Hermes only writes a turn's messages once the turn finishes, so the leases are the primary signal and the newest message
// (classifyTurn) is a fallback for turns that haven't taken a lease yet.
/** @param {{ expires_at?: number|string|null }[] | null | undefined} leases @param {number} nowSec @returns {boolean} */
export function hasLiveLease(leases, nowSec) {
  return Array.isArray(leases) && leases.some((l) => l && l.expires_at != null && Number(l.expires_at) > nowSec);
}

/** @param {{ leases?: { expires_at?: number|string|null }[] | null, last?: Parameters<typeof classifyTurn>[0] }} s
 *  @param {number} nowSec @returns {{ working: boolean, source?: string }} */
export function classifyActivity({ leases, last }, nowSec) {
  const t = classifyTurn(last, nowSec);
  if (t.working) return t;
  return hasLiveLease(leases, nowSec) ? { working: true, source: last?.source || undefined } : { working: false };
}
