import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseStatus } from "../hermes-bridge/status.mjs";

describe("parseStatus", () => {
  it("reads the sectioned form (status on the line under the heading)", () => {
    assert.equal(parseStatus("◆ Gateway Service\n  Status:       ✓ running\n  Manager:      s6\n").gateway, "running");
  });
  it("reads the one-line form", () => assert.equal(parseStatus("Gateway: running\nAgent: online").gateway, "running"));
  it("detects a stopped gateway, including 'not running'", () => {
    assert.equal(parseStatus("◆ Gateway Service\n  Status:  ✗ stopped\n").gateway, "stopped");
    assert.equal(parseStatus("Gateway service is not running").gateway, "stopped");
  });
  it("doesn't let a later section's 'running' leak into the gateway verdict", () => {
    assert.equal(parseStatus("◆ Gateway Service\n  Status:  ✗ stopped\n◆ Cron\n  Status: running\n").gateway, "stopped");
  });
  it("strips ANSI colour codes", () => assert.equal(parseStatus("\x1b[32m◆ Gateway Service\x1b[0m\n  Status: \x1b[32m✓ running\x1b[0m").gateway, "running"));
  it("is 'unknown' when there is no gateway section", () => assert.equal(parseStatus("Agent: online").gateway, "unknown"));
});
