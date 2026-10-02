import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET ?venture=key → playbooks for that venture plus any venture-agnostic ones.
export async function GET(req: Request) {
  const venture = new URL(req.url).searchParams.get("venture");
  const playbooks = await prisma.playbook.findMany({
    where: venture ? { OR: [{ ventureKey: venture }, { ventureKey: null }] } : undefined,
    orderBy: { sortOrder: "asc" },
    select: { key: true, ventureKey: true, name: true, description: true, kind: true, needsInput: true },
  });
  return NextResponse.json({ playbooks });
}
