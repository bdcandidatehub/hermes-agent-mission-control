import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeAgentQuery, modelFromConfig, parseProfileList, validProfileId } from "../hermes-bridge/agents.mjs";
import { buildRoster, AGENT_DIRECTORY } from "../src/lib/agents";

// Captured from `hermes profile list` on the VM.
const TABLE = `
 Profile          Model                        Gateway      Alias        Distribution
 ───────────────    ───────────────────────────    ───────────    ───────────    ────────────────────
 ◆Friday (default) nvidia/nemotron-3-super-12   running      —            —
  builder         qwen2.5:3b-64k               stopped      —            —
  email-calendar  anthropic/claude-haiku-4.5   stopped      —            —
  mason           openai/gpt-5.6-sol           stopped      —            —
  sarah           anthropic/claude-haiku-4-5   stopped      sarah        —

⚠ Profile 'sarah' shares its telegram credential with default: the bot can only belong to one profile.
`;

describe("parseProfileList", () => {
  const rows = parseProfileList(TABLE);
  it("reads every profile and stops at the warning", () => {
    assert.deepEqual(rows.map((r) => r.id), ["default", "builder", "email-calendar", "mason", "sarah"]);
  });
  it("marks the default profile and keeps its display name", () => {
    assert.equal(rows[0].isDefault, true);
    assert.equal(rows[0].name, "Friday");
    assert.equal(rows[0].gateway, "running");
    assert.equal(rows[1].isDefault, false);
  });
  it("captures model and gateway", () => {
    assert.deepEqual([rows[3].model, rows[3].gateway], ["openai/gpt-5.6-sol", "stopped"]);
  });
  it("returns nothing for unrelated output", () => {
    assert.deepEqual(parseProfileList("error: no such command"), []);
    assert.deepEqual(parseProfileList(""), []);
  });
});

describe("modelFromConfig", () => {
  it("reads model.default and ignores other default: keys", () => {
    const yaml = "database:\n  default: nope\nmodel:\n  default: openai/gpt-5.6-sol\n  provider: openrouter\nother:\n  default: nope2\n";
    assert.equal(modelFromConfig(yaml), "openai/gpt-5.6-sol");
  });
  it("copes with quotes and a missing block", () => {
    assert.equal(modelFromConfig("model:\n  default: 'a/b'\n"), "a/b");
    assert.equal(modelFromConfig("x: 1\n"), null);
    assert.equal(modelFromConfig("model:\nnext: 1\n  default: late\n"), null);
  });
});

describe("validProfileId", () => {
  it("accepts slugs and rejects anything that could read as a flag or path", () => {
    for (const ok of ["mason", "email-calendar", "a1_b"]) assert.ok(validProfileId(ok), ok);
    for (const bad of ["-p", "--help", "../x", "Mason", "a b", "", "x".repeat(40), null, 3]) assert.ok(!validProfileId(bad), String(bad));
  });
});

describe("composeAgentQuery", () => {
  it("wraps the operator's message and tells the agent not to invent actions", () => {
    const q = composeAgentQuery({ message: "  hello  " });
    assert.ok(q.endsWith("\n\nhello"));
    assert.match(q, /never claim an action you did not take/);
  });
});

describe("buildRoster", () => {
  const mirrored = [
    { id: "default", name: "Friday", isDefault: true, model: "nvidia/x", gateway: "running" },
    { id: "mason", name: "mason", isDefault: false, model: "openai/gpt-5.6-sol", gateway: "stopped" },
    { id: "builder", name: "builder", isDefault: false, model: "q", gateway: "stopped" },
    { id: "newbie", name: "newbie", isDefault: false, model: "z", gateway: "stopped" },
  ];
  const tasks = [
    { id: "1", title: "Check inbox", assignee: "mason", status: "done", result: "ok", updatedAt: new Date("2026-10-01T10:00:00Z") },
    { id: "2", title: "Scan deals", assignee: "mason", status: "running", result: null, updatedAt: new Date("2026-10-02T10:00:00Z") },
    { id: "3", title: "Fix bug", assignee: "tony", status: "done", result: null, updatedAt: new Date("2026-10-02T09:00:00Z") },
    { id: "4", title: "Stuck", assignee: "mason", status: "blocked", result: null, updatedAt: new Date("2026-10-02T08:00:00Z") },
  ];
  const roster = buildRoster(mirrored, tasks);
  const by = (id: string) => roster.find((a) => a.id === id)!;

  it("orders Friday first, then known agents, then unknown profiles", () => {
    assert.deepEqual(roster.map((a) => a.id), ["default", "mason", "builder", "newbie"]);
  });
  it("uses the directory for names/roles and a safe fallback for new profiles", () => {
    assert.equal(by("mason").name, AGENT_DIRECTORY.mason.name);
    assert.equal(by("builder").name, "Tony");
    assert.equal(by("newbie").name, "Newbie");
    assert.equal(by("newbie").role, "Hermes profile");
  });
  it("counts tasks, treats the tony assignee as the builder profile, and flags working", () => {
    assert.deepEqual([by("mason").tasksDone, by("mason").tasksOpen, by("mason").status], [1, 2, "working"]);
    assert.deepEqual([by("builder").tasksDone, by("builder").status], [1, "idle"]);
    assert.equal(by("mason").currentTask, "Scan deals");
  });
  it("lists newest activity first", () => {
    assert.deepEqual(by("mason").recentActivity.map((a) => a.title), ["Scan deals", "Stuck", "Check inbox"]);
  });
  it("only Friday is flagged as the default (chat happens on Today)", () => {
    assert.deepEqual(roster.filter((a) => a.isDefault).map((a) => a.id), ["default"]);
  });
});
