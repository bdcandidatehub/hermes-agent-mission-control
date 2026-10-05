// Pure helpers for /api/agent/*: what agents may write, how deals are shaped for them, and the context
// handed over for follow-up drafts. No DB, no React.
import { dueBucket, type DueBucket } from "./crm";
import { ACTIVITY_LABEL, OUTBOUND_TYPES, type ActivityType } from "./outreach";

// Agents may log a note or a reply they found. They never log "sent": the operator sends, so only they can say it was sent.
export const AGENT_ACTIVITY_TYPES = ["note", "reply"] as const;
export const MAX_AGENT_NOTE_CHARS = 2000;
export const STALE_DAYS = 7;

export interface DealRow {
  id: string; ventureKey: string; stage: string; valueCents: number; recurring: boolean;
  nextAction: string | null; nextActionDue: Date | null; stageChangedAt: Date; notes: string | null;
  company: { name: string; website: string | null };
  contact: { name: string; title: string | null; email: string | null; consentBasis: string; unsubscribedAt: Date | null } | null;
}
export interface ActivityRow { type: string; summary: string; occurredAt: Date }

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (a: Date, b: Date) => Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86_400_000));

export function shapeDeal(d: DealRow, last: ActivityRow | null, now = new Date(), tz?: string) {
  const c = d.contact;
  return {
    id: d.id,
    venture: d.ventureKey,
    company: { name: d.company.name, website: d.company.website },
    contact: c && {
      name: c.name, title: c.title, email: c.email,
      consentBasis: c.consentBasis, unsubscribed: !!c.unsubscribedAt,
    },
    stage: d.stage,
    daysInStage: daysBetween(d.stageChangedAt, now),
    valueCents: d.valueCents,
    recurring: d.recurring,
    nextAction: d.nextAction,
    nextActionDue: d.nextActionDue ? ymd(d.nextActionDue) : null,
    due: dueBucket(d.nextActionDue, now, tz) as DueBucket,
    lastActivity: last ? { type: last.type, label: ACTIVITY_LABEL[last.type] ?? last.type, at: last.occurredAt.toISOString(), summary: last.summary.slice(0, 300) } : null,
    notes: d.notes ? d.notes.slice(0, 500) : null,
  };
}

// Whether a drafted message to this deal's contact is allowed, and why not.
export function draftability(c: DealRow["contact"]): { canDraft: boolean; reason: string | null; warning: string | null } {
  if (!c) return { canDraft: false, reason: "No contact on this deal", warning: null };
  if (c.unsubscribedAt) return { canDraft: false, reason: `${c.name} has unsubscribed. Never contact them`, warning: null };
  if (!c.email) return { canDraft: true, reason: null, warning: "No email address on this contact" };
  return {
    canDraft: true, reason: null,
    warning: c.consentBasis === "none" ? "No CASL consent basis recorded. Confirm the operator may message them before sending" : null,
  };
}

type Patch = { ok: true; data: { nextAction?: string | null; nextActionDue?: Date | null } } | { ok: false; error: string };

// PATCH body: only nextAction and/or nextActionDue. Everything else (stage, value, notes) stays with the operator.
export function parseNextActionPatch(b: unknown, now = new Date()): Patch {
  const body = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  const extra = Object.keys(body).filter((k) => k !== "nextAction" && k !== "nextActionDue");
  if (extra.length) return { ok: false, error: `agents may only set nextAction and nextActionDue (not ${extra.join(", ")})` };
  if (!("nextAction" in body) && !("nextActionDue" in body)) return { ok: false, error: "nothing to change" };

  const data: { nextAction?: string | null; nextActionDue?: Date | null } = {};
  if ("nextAction" in body) {
    const v = body.nextAction;
    if (v == null || v === "") data.nextAction = null;
    else if (typeof v === "string") data.nextAction = v.trim().slice(0, 300) || null;
    else return { ok: false, error: "nextAction must be text" };
  }
  if ("nextActionDue" in body) {
    const v = body.nextActionDue;
    if (v == null || v === "") data.nextActionDue = null;
    else {
      const d = new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}/.test(String(v)) || Number.isNaN(d.getTime())) return { ok: false, error: "nextActionDue must be a date like 2026-10-12" };
      if (d.getTime() < now.getTime() - 2 * 86_400_000) return { ok: false, error: "nextActionDue can't be in the past" };
      if (d.getTime() > now.getTime() + 365 * 86_400_000) return { ok: false, error: "nextActionDue is more than a year out" };
      data.nextActionDue = d;
    }
  }
  return { ok: true, data };
}

// Plain-language history for a follow-up draft, newest first, plus whether the ball is in their court.
export function describeHistory(acts: ActivityRow[], now = new Date()): string {
  const real = acts.filter((a) => a.type !== "stage").slice(0, 4);
  if (!real.length) return "Nothing has been logged on this deal yet.";
  const lines = real.map((a) => {
    const when = `${daysBetween(a.occurredAt, now)}d ago`;
    const label = ACTIVITY_LABEL[a.type] ?? a.type;
    return `- ${label} (${when})${a.summary ? `: ${a.summary.slice(0, 200)}` : ""}`;
  });
  const newest = real[0];
  const quiet = OUTBOUND_TYPES.includes(newest.type as ActivityType)
    ? `No reply has been logged since the last message, ${daysBetween(newest.occurredAt, now)} days ago.`
    : "";
  return [...lines, quiet].filter(Boolean).join("\n");
}

// Used when a venture has no follow-up playbook of its own. Mirrors the voice rules of the CandidateHub playbooks.
export const FALLBACK_FOLLOWUP_RULES =
  "Voice: a calm, plainspoken operator. Consent-based, low pressure, specific to the recipient, no hype, no buzzwords, no exclamation marks. " +
  "Never invent facts about the recipient. Under 80 words; add something useful rather than 'just checking in'. " +
  "Sign as Brad DiPaolo with a one-line sender identification and a simple opt-out line (reply 'no thanks' and I won't follow up) to keep it CASL-compliant. " +
  "Output the subject line (or 'Re:' if replying) and the body only. Save it as a Gmail DRAFT. Do NOT send anything.";
