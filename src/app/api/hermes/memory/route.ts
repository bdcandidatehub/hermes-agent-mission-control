import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEFAULT_WIKI_CONFIG, resolveLinkGraph, type WikiConfig } from "@/lib/wiki-links";
import { initialStatus, MAX_PROMPT_CHARS, safeWikiPath, slugify } from "@/lib/hermes-policy";

// GET ?q=&type=&status= → list/search wiki entries (mirrored by the bridge), with resolved [[links]] and backlinks.
//   status=active (default) hides archived/superseded notes; status=all shows everything; anything else matches exactly.
//   Vault notes use their own statuses (seed, growing, mature, archived), so "active" means "not archived".
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status") || "active";
  const statusWhere = status === "all" ? {} : status === "active" ? { status: { notIn: ["archived", "superseded"] } } : { status };

  const where: Record<string, unknown> = { ...statusWhere };
  if (type && type !== "all") where.type = type;
  if (q) where.OR = [
    { title: { contains: q, mode: "insensitive" } },
    { body: { contains: q, mode: "insensitive" } },
    { tags: { has: q.toLowerCase() } },
  ];
  const [entries, counted, graphRows, cfgRow] = await Promise.all([
    prisma.hermesMemory.findMany({ where, orderBy: { updatedAt: "desc" }, take: 300 }),
    prisma.hermesMemory.findMany({ select: { type: true }, where: statusWhere }),
    // links/backlinks are computed over ALL notes so filtering never hides a connection
    prisma.hermesMemory.findMany({ select: { id: true, title: true, path: true, links: true } }),
    prisma.dataStore.findUnique({ where: { key: "wiki-config" } }),
  ]);
  const typeCounts: Record<string, number> = {};
  for (const e of counted) typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  const graph = resolveLinkGraph(graphRows);
  const config = { ...DEFAULT_WIKI_CONFIG, ...((cfgRow?.data as Partial<WikiConfig> | null) ?? {}) };
  return NextResponse.json({
    entries: entries.map((e) => ({ ...e, resolvedLinks: graph.get(e.id)?.links ?? [], backlinks: graph.get(e.id)?.backlinks ?? [] })),
    typeCounts, total: counted.length, lastSync: entries[0]?.syncedAt ?? null, config,
  });
}

// POST { path?, id?, type, title, body, tags?, links?, status?, confidence? }
// → queue a wiki write for the bridge (writes the .md file + git commit on the mini).
export async function POST(req: Request) {
  const cfg = (await prisma.dataStore.findUnique({ where: { key: "wiki-config" } }))?.data as Partial<WikiConfig> | null;
  if (cfg?.mode && cfg.mode !== "edit")
    return NextResponse.json({ error: "This wiki is read-only from the dashboard. Add a source instead.", mode: cfg.mode }, { status: 409 });
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
