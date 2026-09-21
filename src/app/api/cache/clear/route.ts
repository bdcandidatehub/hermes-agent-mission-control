import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

// Keys in DataStore that hold cached third-party data. Add your own here.
const CACHE_KEYS = ["trend-radar", "watchlist-radar"];

function authorized(req: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  const got = req.headers.get("x-internal-secret");
  if (!expected || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// POST with the `x-internal-secret` header. (No GET / query-string secret: URLs end up in logs.)
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const results = await Promise.all(
    CACHE_KEYS.map((key) =>
      prisma.dataStore.delete({ where: { key } }).then(() => ({ key, cleared: true })).catch(() => ({ key, cleared: false }))
    )
  );
  return NextResponse.json({ results });
}
