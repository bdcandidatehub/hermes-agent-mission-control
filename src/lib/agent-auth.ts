// Agent API keys. Each agent (mason, friday, ...) gets its own key so one can be revoked without touching the others.
//
//   AGENT_API_KEYS="mason:<key>,friday:<key>"
//
// A key authorizes ONLY /api/agent/* (src/middleware.ts); it is not a login session and not INTERNAL_API_SECRET.

export const MIN_KEY_LENGTH = 32;
const AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export interface AgentKey { id: string; key: string }

/** Parse "mason:abc,friday:def". Malformed entries and keys shorter than MIN_KEY_LENGTH are ignored, never accepted. */
export function parseAgentKeys(raw: string | undefined | null): AgentKey[] {
  const out: AgentKey[] = [];
  for (const part of String(raw ?? "").split(",")) {
    const i = part.indexOf(":");
    if (i < 1) continue;
    const id = part.slice(0, i).trim().toLowerCase();
    const key = part.slice(i + 1).trim();
    if (!AGENT_ID.test(id) || key.length < MIN_KEY_LENGTH) continue;
    out.push({ id, key });
  }
  return out;
}

// Compare without bailing out at the first difference.
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** The agent id the presented key belongs to, or null. Checks every configured key (no early exit). */
export function agentForKey(raw: string | undefined | null, presented: string | null | undefined): string | null {
  if (!presented) return null;
  let found: string | null = null;
  for (const k of parseAgentKeys(raw)) if (safeEqual(k.key, presented)) found = k.id;
  return found;
}

/** Pull the key from "Authorization: Bearer <key>" or "x-agent-key". */
export function presentedKey(headers: { get(name: string): string | null }): string | null {
  const auth = headers.get("authorization");
  const m = auth?.match(/^Bearer\s+(\S+)$/i);
  return m?.[1] ?? headers.get("x-agent-key") ?? null;
}

/** Route-side: the verified agent id the middleware stamped on the request (never trust a client-supplied one outside dev). */
export function agentIdFromHeaders(headers: { get(name: string): string | null }): string | null {
  const id = headers.get("x-agent-id");
  return id && AGENT_ID.test(id) ? id : null;
}
