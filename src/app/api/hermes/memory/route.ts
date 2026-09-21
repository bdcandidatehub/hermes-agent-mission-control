import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { initialStatus, MAX_PROMPT_CHARS, safeWikiPath, slugify } from "@/lib/hermes-policy";

// GET ?q=&type=&status= → list/search wiki entries (mirrored by the bridge)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status") || "active";
  const where: Record<string, unknown> = {};
  if (status !== "all") where.status = status;
  if (type && type !== "all") where.type = type;
  if (q) where.OR = [
    { title: { contains: q, mode: "insensitive" } },
    { body: { contains: q, mode: "insensitive" } },
    { tags: { has: q.toLowerCase() } },
  ];
  const entries = await prisma.hermesMemory.findMany({ where, orderBy: { updatedAt: "desc" }, take: 300 });
  const all = await prisma.hermesMemory.findMany({ select: { type: true }, where: status === "all" ? {} : { status } });
  const typeCounts: Record<string, number> = {};
  for (const e of all) typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  const lastSync = entries[0]?.syncedAt ?? null;
  return NextResponse.json({ entries, typeCounts, total: all.length, lastSync });
}

// POST { path?, id?, type, title, body, tags?, links?, status?, confidence? }
// → queue a wiki write for the bridge (writes the .md file + git commit on the mini).
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const title = (b.title || "").toString().trim();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  const slug = slugify((b.id || title).toString());
  if (!slug) return NextResponse.json({ error: "could not derive an id from the title" }, { status: 400 });
  const path = safeWikiPath((b.path || `${slugify((b.type || "note").toString()) || "note"}s/${slug}.md`).toString());
  if (!path) return NextResponse.json({ error: "invalid path (must be a relative .md path inside the wiki)" }, { status: 400 });
  const body = (b.body || "").toString();
  if (body.length > MAX_PROMPT_CHARS) return NextResponse.json({ error: "body too long" }, { status: 413 });
  const oneLine = (v: unknown) => String(v ?? "").replace(/[\r\n]+/g, " ").trim();
  const list = (v: unknown) => (Array.isArray(v) ? v.map(oneLine).filter(Boolean).slice(0, 50) : []);
  const entry = {
    id: slug,
    path,
    type: oneLine(b.type || "note"),
    title: oneLine(title),
    status: oneLine(b.status || "active"),
    confidence: b.confidence != null ? oneLine(b.confidence) : null,
    provenance: oneLine(b.provenance ?? "dashboard"),
    tags: list(b.tags),
    links: list(b.links),
    body,
  };
  const row = await prisma.agentRequest.create({
    data: {
      origin: "web",
      kind: "memory.write",
      title: `Memory: ${title}`.slice(0, 200),
      prompt: JSON.stringify(entry),
      sideEffecting: false,
      status: initialStatus("memory.write", false)!,
    },
  });
  return NextResponse.json({ request: row, entry });
}
