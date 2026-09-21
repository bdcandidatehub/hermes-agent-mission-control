import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTodaySummary } from "@/lib/today";
import { buildSnapshot, FRIDAY_KIND, MAX_MESSAGE_CHARS } from "@/lib/friday";

export const dynamic = "force-dynamic";

const LIVE = ["queued", "approved", "running"];

interface StoredPrompt { message?: string; context?: string }
const parse = (p: string | null): StoredPrompt => { try { return JSON.parse(p ?? "{}") as StoredPrompt; } catch { return {}; } };

// GET → the recent conversation with Friday, oldest first. A turn is one request: message in, reply out.
export async function GET() {
  const rows = await prisma.agentRequest.findMany({ where: { kind: FRIDAY_KIND }, orderBy: { createdAt: "desc" }, take: 30 });
  return NextResponse.json({
    turns: rows.reverse().map((r) => ({
      id: r.id, status: r.status, message: parse(r.prompt).message ?? r.title, reply: r.result, error: r.error,
      createdAt: r.createdAt, finishedAt: r.finishedAt,
    })),
  });
}

// POST { message } → queue a turn for Friday. The bridge runs it on its own fast lane (not behind cron or other work),
// in one persistent Hermes session, so she remembers the conversation.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (!message) return NextResponse.json({ error: "Say something first." }, { status: 400 });
  if (message.length > MAX_MESSAGE_CHARS) return NextResponse.json({ error: `That's too long (${MAX_MESSAGE_CHARS} characters max).` }, { status: 413 });
  if ((await prisma.agentRequest.count({ where: { kind: FRIDAY_KIND, status: { in: LIVE } } })) >= 3)
    return NextResponse.json({ error: "Friday is still working on your earlier messages." }, { status: 429 });

  let context = "";
  try {
    const t = await getTodaySummary(7);
    context = buildSnapshot({ mrrCents: t.mrrCents, openPipelineCents: t.openPipelineCents, pendingApprovals: t.pendingApprovals, due: t.due });
  } catch { /* a missing snapshot shouldn't stop a conversation */ }

  const request = await prisma.agentRequest.create({
    data: {
      origin: "web", kind: FRIDAY_KIND, title: message.slice(0, 200), status: "queued", sideEffecting: false,
      prompt: JSON.stringify({ message, context }),
    },
  });
  return NextResponse.json({ request: { id: request.id, status: request.status } });
}
