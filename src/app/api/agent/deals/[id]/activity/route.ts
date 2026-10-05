import { NextResponse } from "next/server";
import { agentIdFromHeaders } from "@/lib/agent-auth";
import { AGENT_ACTIVITY_TYPES, MAX_AGENT_NOTE_CHARS } from "@/lib/agent-api";
import { logDealActivity } from "@/lib/activity-log";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// POST { type: "note" | "reply", summary, occurredAt? } → log a note, or a reply the agent found in the inbox.
// A reply moves an early-stage lead to "replied" and sets "Reply to …" due today (same rules as logging it by hand).
// Agents can't log "email sent" / "LinkedIn sent": only the operator sends, so only the operator says it was sent.
export async function POST(req: Request, { params }: Ctx) {
  const agent = agentIdFromHeaders(req.headers);
  if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const b = await req.json().catch(() => ({}));

  if (!(AGENT_ACTIVITY_TYPES as readonly string[]).includes(b.type))
    return NextResponse.json({ error: `type must be one of: ${AGENT_ACTIVITY_TYPES.join(", ")}` }, { status: 400 });
  if (typeof b.summary !== "string" || !b.summary.trim())
    return NextResponse.json({ error: "summary is required" }, { status: 400 });
  if (b.summary.length > MAX_AGENT_NOTE_CHARS)
    return NextResponse.json({ error: `summary is too long (${MAX_AGENT_NOTE_CHARS} characters max)` }, { status: 413 });

  const r = await logDealActivity(id, { type: b.type, summary: b.summary, occurredAt: b.occurredAt, by: agent });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, advancedTo: r.advancedTo });
}
