import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BRIEF_RETRY_MS, localDate, shouldGenerateBrief } from "../hermes-bridge/brief.mjs";

const at = (h: number, day = 21) => new Date(2026, 8, day, h, 30); // local time
const base = { briefHour: 7, lastGeneratedAt: null as string | null, lastAttemptMs: null as number | null, inFlight: false };

describe("shouldGenerateBrief", () => {
  it("waits until the configured local hour", () => {
    assert.equal(shouldGenerateBrief({ ...base, now: at(6) }), false);
    assert.equal(shouldGenerateBrief({ ...base, now: at(7) }), true);
  });
  it("generates at most once per local day, surviving restarts (uses the stored timestamp)", () => {
    const today = at(8).toISOString();
    assert.equal(shouldGenerateBrief({ ...base, now: at(16), lastGeneratedAt: today }), false);
    assert.equal(shouldGenerateBrief({ ...base, now: at(16, 22), lastGeneratedAt: today }), true); // next day
  });
  it("never runs two at once", () => assert.equal(shouldGenerateBrief({ ...base, now: at(9), inFlight: true }), false));
  it("backs off after a failed attempt", () => {
    const now = at(9);
    assert.equal(shouldGenerateBrief({ ...base, now, lastAttemptMs: now.getTime() - 60_000 }), false);
    assert.equal(shouldGenerateBrief({ ...base, now, lastAttemptMs: now.getTime() - BRIEF_RETRY_MS - 1 }), true);
  });
  it("uses the LOCAL date, not UTC (no second brief when the UTC day rolls over in the evening)", () => {
    const generated = new Date(2026, 8, 21, 8, 0).toISOString();
    assert.equal(localDate(new Date(generated)), "2026-09-21");
    assert.equal(shouldGenerateBrief({ ...base, now: new Date(2026, 8, 21, 22, 30), lastGeneratedAt: generated }), false);
  });
  it("ignores an unparseable stored timestamp", () => assert.equal(shouldGenerateBrief({ ...base, now: at(9), lastGeneratedAt: "garbage" }), true));
});
