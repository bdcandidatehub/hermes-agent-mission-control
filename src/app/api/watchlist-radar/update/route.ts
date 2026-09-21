import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json();
  if (!Array.isArray(body.signals))
    return NextResponse.json({ error: "Expected { signals: [] }" }, { status: 400 });

  await prisma.dataStore.upsert({
    where: { key: "watchlist-radar" },
    update: { data: body },
    create: { key: "watchlist-radar", data: body },
  });

  return NextResponse.json({ ok: true, count: body.signals.length });
}
