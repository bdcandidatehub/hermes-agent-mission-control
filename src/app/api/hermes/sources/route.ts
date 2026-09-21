import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { initialStatus } from "@/lib/hermes-policy";
import { DEFAULT_WIKI_CONFIG, type WikiConfig } from "@/lib/wiki-links";

// POST { title, body?, author?, reference? } → capture a new SOURCE note in the vault's sources folder.
// The dashboard never edits compiled notes in a schema'd vault; the vault's own ingest turns sources into notes.
// The bridge writes the file (new files only, never overwrites).
export async function POST(req: Request) {
  const cfg = { ...DEFAULT_WIKI_CONFIG, ...(((await prisma.dataStore.findUnique({ where: { key: "wiki-config" } }))?.data as Partial<WikiConfig> | null) ?? {}) };
  if (!cfg.canCapture) return NextResponse.json({ error: "Capturing sources isn't enabled for this wiki (see HERMES_WIKI_MODE and HERMES_RAW_DIR)." }, { status: 409 });

  const b = await req.json().catch(() => ({}));
  const one = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\r\n]+/g, " ").trim().slice(0, max) : "");
  const title = one(b.title, 200);
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  const body = typeof b.body === "string" ? b.body : "";
  if (body.length > 20_000) return NextResponse.json({ error: "body too long (20,000 characters max)" }, { status: 413 });

  const status = initialStatus("source.add", false)!;
  const request = await prisma.agentRequest.create({
    data: {
      origin: "web", kind: "source.add", title: `Source: ${title}`.slice(0, 200), status, sideEffecting: false,
      prompt: JSON.stringify({ title, author: one(b.author, 120), reference: one(b.reference, 300), body }),
    },
  });
  return NextResponse.json({ request });
}
