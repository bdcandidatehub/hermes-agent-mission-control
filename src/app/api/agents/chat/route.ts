import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AGENT_KIND, MAX_AGENT_MESSAGE_CHARS, type MirroredAgent } from "@/lib/agents";

export const dynamic = "force-dynamic";

const LIVE = ["queued", "approved", "running"];
const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

interface Stored { message?: string }
const parse = (p: string | null): Stored => { try { return JSON.parse(p ?? "{}") as Stored; } catch { return {}; } };

// An agent the operator can chat with: a mirrored profile other than the default (Friday talks on the Today page).
async function chattable(id: string): Promise<boolean> {
  if (!ID.test(id)) return false;
  const row = await prisma.dataStore.findUnique({ where: { key: "hermes-agents" } });
  const agents = ((row?.data ?? {}) as { agents?: MirroredAgent[] }).agents ?? [];
  return agents.some((a) => a.id === id && !a.isDefault);
}

// GET ?agent=mason → the recent conversation with that agent, oldest first.
export async function GET(req: Request) {
  const agent = new URL(req.url).searchParams.get("agent") ?? "";
  if (!ID.test(agent)) return NextResponse.json({ error: "unknown agent" }, { status: 400 });
  const rows = await prisma.agentRequest.findMany({
    where: { kind: AGENT_KIND, prompt: { contains: `"profile":${JSON.stringify(agent)}` } },
    orderBy: { createdAt: "desc" }, take: 30,
  });
  return NextResponse.json({
    turns: rows.reverse().map((r) => ({
      id: r.id, status: r.status, message: parse(r.prompt).message ?? r.title, reply: r.result, error: r.error,
      createdAt: r.createdAt, finishedAt: r.finishedAt,
    })),
  });
}

// POST { agent, message } → queue a turn. The bridge runs it with `hermes -p <agent> chat` in that agent's own session.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const agent = typeof b.agent === "string" ? b.agent : "";
  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (!(await chattable(agent))) return NextResponse.json({ error: "That agent isn't available to chat with." }, { status: 400 });
  if (!message) return NextResponse.json({ error: "Say something first." }, { status: 400 });
  if (message.length > MAX_AGENT_MESSAGE_CHARS) return NextResponse.json({ error: `That's too long (${MAX_AGENT_MESSAGE_CHARS} characters max).` }, { status: 413 });

  const mine = await prisma.agentRequest.count({ where: { kind: AGENT_KIND, status: { in: LIVE }, prompt: { contains: `"profile":${JSON.stringify(agent)}` } } });
  if (mine >= 2) return NextResponse.json({ error: "They're still working on your earlier messages." }, { status: 429 });
  if ((await prisma.agentRequest.count({ where: { kind: AGENT_KIND, status: { in: LIVE } } })) >= 6)
    return NextResponse.json({ error: "Too many agent chats in flight. Give it a moment." }, { status: 429 });

  const request = await prisma.agentRequest.create({
    data: {
      origin: "web", kind: AGENT_KIND, title: message.slice(0, 200), status: "queued", sideEffecting: false,
      prompt: JSON.stringify({ profile: agent, message }),
    },
  });
  return NextResponse.json({ request: { id: request.id, status: request.status } });
}
