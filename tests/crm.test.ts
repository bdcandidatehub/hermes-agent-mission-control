import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dueBucket, fmtMoney, isValidStage, parseDollarsToCents, renderTemplate, summarizeVenture } from "../src/lib/crm";

const venture = { key: "c", name: "C", stages: ["a", "b"], wonStage: "won", lostStage: "lost", recurring: true };

describe("dueBucket (America/Halifax)", () => {
  it("a deal due today stays 'today' in the evening (UTC has already rolled over)", () => {
    assert.equal(dueBucket("2026-09-21", new Date("2026-09-22T00:30:00Z")), "today");
  });
  it("buckets by calendar day", () => {
    const now = new Date("2026-09-21T16:00:00Z");
    assert.equal(dueBucket("2026-09-20", now), "overdue");
    assert.equal(dueBucket("2026-09-23", now), "soon");
    assert.equal(dueBucket("2026-09-24", now), "later");
    assert.equal(dueBucket(null), "none");
    assert.equal(dueBucket("nope"), "none");
  });
});

describe("renderTemplate", () => {
  it("fills nested placeholders and blanks missing ones", () => {
    assert.equal(renderTemplate("{{company.name}}|{{contact.title}}|{{x.y.z}}|{{ input }}", { company: { name: "A" }, contact: {}, input: "i" }), "A|||i");
  });
  it("doesn't read prototype properties", () => {
    assert.equal(renderTemplate("{{constructor.name}}{{__proto__.x}}", {}), "");
  });
});

describe("money", () => {
  it("parses dollars to cents and rejects junk", () => {
    assert.equal(parseDollarsToCents("1,249.50"), 124950);
    assert.equal(parseDollarsToCents("$99"), 9900);
    assert.equal(parseDollarsToCents(249), 24900);
    assert.equal(parseDollarsToCents("-5"), null);
    assert.equal(parseDollarsToCents("abc"), null);
  });
  it("formats", () => {
    assert.match(fmtMoney(24900), /249/);
    assert.match(fmtMoney(24950), /249\.50/);
  });
});

describe("summarizeVenture", () => {
  it("counts open/won, excludes lost and other ventures, and derives MRR from won+recurring deals", () => {
    const s = summarizeVenture(venture, [
      { ventureKey: "c", stage: "a", valueCents: 100, recurring: true },
      { ventureKey: "c", stage: "won", valueCents: 900, recurring: true },
      { ventureKey: "c", stage: "lost", valueCents: 5000, recurring: true },
      { ventureKey: "z", stage: "a", valueCents: 7, recurring: true },
    ]);
    assert.deepEqual([s.openDeals, s.openValueCents, s.wonDeals, s.wonValueCents, s.mrrCents], [1, 100, 1, 900, 900]);
  });
  it("a won one-time deal counts toward wonValueCents but not MRR", () => {
    const s = summarizeVenture(venture, [
      { ventureKey: "c", stage: "won", valueCents: 900, recurring: true },
      { ventureKey: "c", stage: "won", valueCents: 5000, recurring: false },
    ]);
    assert.deepEqual([s.wonDeals, s.wonValueCents, s.mrrCents], [2, 5900, 900]);
  });
  it("MRR is per-deal, independent of the venture's own recurring hint", () => {
    const s = summarizeVenture({ ...venture, recurring: false }, [{ ventureKey: "c", stage: "won", valueCents: 900, recurring: true }]);
    assert.equal(s.mrrCents, 900);
  });
  it("validates stages", () => {
    assert.ok(isValidStage(venture, "won"));
    assert.ok(!isValidStage(venture, "x"));
  });
});
