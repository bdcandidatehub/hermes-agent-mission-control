import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.trends || !Array.isArray(body.trends)) {
      return NextResponse.json({ error: "Invalid payload — expected { trends, lastUpdated, nextUpdate }" }, { status: 400 });
    }

    await prisma.dataStore.upsert({
      where: { key: "trend-radar" },
      update: { data: body },
      create: { key: "trend-radar", data: body },
    });

    return NextResponse.json({ ok: true, count: body.trends.length });
  } catch (error) {
    console.error("[trends/update] error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
