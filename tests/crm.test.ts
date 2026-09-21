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
  it("counts open/won, excludes lost and other ventures, and derives MRR", () => {
    const s = summarizeVenture(venture, [
      { ventureKey: "c", stage: "a", valueCents: 100 },
      { ventureKey: "c", stage: "won", valueCents: 900 },
      { ventureKey: "c", stage: "lost", valueCents: 5000 },
      { ventureKey: "z", stage: "a", valueCents: 7 },
    ]);
    assert.deepEqual([s.openDeals, s.openValueCents, s.wonDeals, s.mrrCents], [1, 100, 1, 900]);
  });
  it("non-recurring ventures report no MRR", () => {
    assert.equal(summarizeVenture({ ...venture, recurring: false }, [{ ventureKey: "c", stage: "won", valueCents: 900 }]).mrrCents, 0);
  });
  it("validates stages", () => {
    assert.ok(isValidStage(venture, "won"));
    assert.ok(!isValidStage(venture, "x"));
  });
});
