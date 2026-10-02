import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DISPATCHABLE_KINDS, initialStatus, MAX_PROMPT_CHARS, tierFor } from "@/lib/hermes-policy";

// POST { kind?, title, prompt?, sideEffecting? } → queue work for Hermes.
// The approval tier is decided server-side from `kind` (see lib/hermes-policy.ts).
// `sideEffecting: true` can force approval; it can never skip it.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const title = (b.title || b.prompt || "").toString().trim();
  if (!title) return NextResponse.json({ error: "title or prompt required" }, { status: 400 });

  const kind = (b.kind || "oneshot").toString();
  if (!DISPATCHABLE_KINDS.has(kind) || !tierFor(kind)) return NextResponse.json({ error: `unsupported kind: ${kind}` }, { status: 400 });

  const prompt = (b.prompt ?? b.title ?? "").toString();
  if (prompt.length > MAX_PROMPT_CHARS) return NextResponse.json({ error: "prompt too long" }, { status: 413 });

  const status = initialStatus(kind, Boolean(b.sideEffecting))!;
  const row = await prisma.agentRequest.create({
    data: {
      origin: "web",
      kind,
      title: title.slice(0, 200),
      prompt: prompt || null,
      sideEffecting: status === "awaiting_approval",
      status,
    },
  });
  return NextResponse.json({ request: row });
}
