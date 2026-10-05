// Server-side approval policy for work dispatched to Hermes.
//
// The approval tier is decided HERE, by request kind, never by the client.
// A client may only escalate a request (`sideEffecting: true`), not relax it.
// hermes-bridge/bridge.mjs carries the same table and re-checks it before running anything.
//
//   auto     runs as soon as the bridge picks it up (read-only or internal, reversible)
//   approve  waits in the approval inbox until a human approves it
//
// Kinds not listed here are rejected.

export type Tier = "auto" | "approve";

export const KIND_TIERS: Record<string, Tier> = {
  oneshot: "auto",
  chat: "auto",
  kanban: "auto",
  "briefing.generate": "auto",
  "memory.write": "auto", // path-confined to the wiki dir by the bridge
  "friday.chat": "auto", // a message the operator typed or spoke to Friday; created only by /api/friday/chat
  "agent.chat": "auto", // a message the operator typed to a named agent; created only by /api/agents/chat
  "source.add": "auto", // creates a NEW note in the vault's sources folder; never overwrites
  "cron.create": "approve",
  "cron.edit": "approve",
  "cron.run": "approve",
  "cron.pause": "auto", // reversible
  "cron.resume": "auto",
  "cron.remove": "approve",
};

// Kinds the generic /api/hermes/dispatch endpoint may create. Structured kinds (cron.*, memory.write)
// carry JSON args and are created only by their own validating routes (/api/hermes/crons, /api/hermes/memory).
export const DISPATCHABLE_KINDS = new Set(["oneshot", "chat", "kanban"]);

export const MAX_PROMPT_CHARS = 20_000;

export function tierFor(kind: string): Tier | null {
  return Object.prototype.hasOwnProperty.call(KIND_TIERS, kind) ? KIND_TIERS[kind] : null;
}

export function initialStatus(kind: string, clientSideEffecting: boolean): "queued" | "awaiting_approval" | null {
  const tier = tierFor(kind);
  if (!tier) return null;
  return tier === "approve" || clientSideEffecting ? "awaiting_approval" : "queued";
}

// Wiki entry paths must stay inside the wiki dir: relative, no "..", .md only.
export function safeWikiPath(p: string): string | null {
  const norm = p.replace(/\\/g, "/");
  if (!norm || norm.startsWith("/") || norm.includes("\0")) return null;
  if (norm.split("/").some((seg) => seg === ".." || seg === "." || seg === "" || seg === ".git")) return null;
  if (!norm.endsWith(".md") || norm.length > 200) return null;
  return norm;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

// Cron args go to `hermes cron ...` as argv (no shell), but a value starting with "-" would still be
// parsed as a flag, so reject those and cap lengths.
export function safeCliArg(v: unknown, max = 500): string | null {
  if (v == null || v === "") return null;
  const s = String(v);
  if (s.length > max || s.startsWith("-") || s.includes("\0")) return null;
  return s;
}
