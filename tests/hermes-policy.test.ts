import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DISPATCHABLE_KINDS, initialStatus, safeCliArg, safeWikiPath, tierFor } from "../src/lib/hermes-policy";

describe("approval policy", () => {
  it("cron.create/edit/run/remove always need approval, even if the client says sideEffecting:false", () => {
    for (const k of ["cron.create", "cron.edit", "cron.run", "cron.remove"]) assert.equal(initialStatus(k, false), "awaiting_approval", k);
  });
  it("safe kinds are queued, and a client can escalate but not relax", () => {
    assert.equal(initialStatus("oneshot", false), "queued");
    assert.equal(initialStatus("oneshot", true), "awaiting_approval");
  });
  it("rejects unknown kinds and prototype keys", () => {
    assert.equal(initialStatus("rm.rf", false), null);
    assert.equal(tierFor("constructor"), null);
    assert.equal(tierFor("__proto__"), null);
  });
  it("generic dispatch can't create structured kinds", () => {
    assert.ok(!DISPATCHABLE_KINDS.has("cron.create"));
    assert.ok(!DISPATCHABLE_KINDS.has("memory.write"));
    assert.ok(DISPATCHABLE_KINDS.has("oneshot"));
  });
});

describe("input guards", () => {
  it("wiki paths must be relative .md inside the wiki", () => {
    for (const bad of ["../x.md", "/etc/x.md", ".git/x.md", "a/../../x.md", "x.sh", "..\\x.md"]) assert.equal(safeWikiPath(bad), null, bad);
    assert.equal(safeWikiPath("facts/acme.md"), "facts/acme.md");
  });
  it("CLI args can't start with a dash", () => {
    assert.equal(safeCliArg("--delete-all"), null);
    assert.equal(safeCliArg("0 8 * * *"), "0 8 * * *");
  });
});
