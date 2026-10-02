import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseInsights } from "../src/lib/hermes-insights";

const SAMPLE = `
  📋 Overview
  ────────────────────────────────
  Sessions:          14            Messages:        242
  Input tokens:      1,136,973     Output tokens:   46,992
  Total tokens:      4,081,367
  Avg msgs/session:  17.3

  💰 Cost
  ────────────────────────────────
  Estimated:          ~$0.02
  Unknown:            9 session(s) (no pricing data)

  🤖 Models Used
  ────────────────────────────────
  Model                          Sessions       Tokens
  nemotron-3-super-120b-a12b:f          1    2,880,845
  claude-haiku-4-5-20251001             4      938,069

  📱 Platforms
  ────────────────────────────────
  Platform       Sessions   Messages         Tokens
  cron                  8         91        995,750
`;

describe("parseInsights", () => {
  it("extracts total tokens, estimated cost, and the per-model table", () => {
    const p = parseInsights(SAMPLE);
    assert.equal(p.totalTokens, 4081367);
    assert.equal(p.totalCost, 0.02);
    assert.deepEqual(p.byModel, [
      { model: "nemotron-3-super-120b-a12b:f", calls: 1, tokens: 2880845 },
      { model: "claude-haiku-4-5-20251001", calls: 4, tokens: 938069 },
    ]);
  });
  it("stops at the end of the model table (doesn't swallow the platform table)", () => assert.equal(parseInsights(SAMPLE).byModel.length, 2));
  it("returns nulls and an empty list for missing or garbage input", () => {
    for (const bad of [null, undefined, "", "nothing useful here"]) assert.deepEqual(parseInsights(bad), { totalCost: null, totalTokens: null, byModel: [] });
  });
  it("strips ANSI colour codes", () => assert.equal(parseInsights("\x1b[1mTotal tokens:\x1b[0m 1,234").totalTokens, 1234));
});
