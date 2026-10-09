import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyActivity, classifyTurn, hasLiveLease, composeAgentQuery, modelFromConfig, parseProfileList, validProfileId } from "../hermes-bridge/agents.mjs";
import { buildOrgTree, buildRoster, liveLabel, AGENT_DIRECTORY, type OrgNode, type RosterAgent } from "../src/lib/agents";

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
    { id: "tony", name: "tony", isDefault: false, model: "q", gateway: "stopped" },
    { id: "newbie", name: "newbie", isDefault: false, model: "z", gateway: "stopped" },
  ];
  const tasks = [
    { id: "1", title: "Check inbox", assignee: "mason", status: "done", result: "ok", updatedAt: new Date("2026-10-01T10:00:00Z") },
    { id: "2", title: "Scan deals", assignee: "mason", status: "running", result: null, updatedAt: new Date("2026-10-02T10:00:00Z") },
    { id: "3", title: "Fix bug", assignee: "tony", status: "done", result: null, updatedAt: new Date("2026-10-02T09:00:00Z") },
    { id: "5", title: "Old-name task", assignee: "builder", status: "done", result: null, updatedAt: new Date("2026-09-30T09:00:00Z") },
    { id: "4", title: "Stuck", assignee: "mason", status: "blocked", result: null, updatedAt: new Date("2026-10-02T08:00:00Z") },
  ];
  const roster = buildRoster(mirrored, tasks);
  const by = (id: string) => roster.find((a) => a.id === id)!;

  it("lists known agents in the directory's order, then unknown profiles", () => {
    assert.deepEqual(roster.map((a) => a.id), ["default", "mason", "tony", "newbie"]);
  });
  it("uses the directory for names/roles and a safe fallback for new profiles", () => {
    assert.equal(by("mason").name, AGENT_DIRECTORY.mason.name);
    assert.equal(by("tony").name, "Tony");
    assert.equal(by("newbie").name, "Newbie");
    assert.equal(by("newbie").role, "Hermes profile");
  });
  it("counts tasks, still credits the old \"builder\" assignee to Tony, and flags working", () => {
    assert.deepEqual([by("mason").tasksDone, by("mason").tasksOpen, by("mason").status], [1, 2, "working"]);
    assert.deepEqual([by("tony").tasksDone, by("tony").status], [2, "idle"]);
    assert.equal(by("mason").currentTask, "Scan deals");
  });
  it("lists newest activity first", () => {
    assert.deepEqual(by("mason").recentActivity.map((a) => a.title), ["Scan deals", "Stuck", "Check inbox"]);
  });
  it("only Friday is flagged as the default (chat happens on Today)", () => {
    assert.deepEqual(roster.filter((a) => a.isDefault).map((a) => a.id), ["default"]);
  });
});

const AGENTS_LIKE_VM = ["default", "email-calendar", "marketing-manager", "mason", "paula", "sarah", "tony", "video"].map((id) => ({
  id, name: id, isDefault: id === "default", model: "m", gateway: "running",
}));

describe("live activity", () => {
  const roster = (live = {}) => buildRoster(AGENTS_LIKE_VM, [], live);
  const by = (r: RosterAgent[], id: string) => r.find((a) => a.id === id)!;
  it("an agent mid-conversation is working even with nothing on the board", () => {
    const r = roster({ default: { source: "telegram" } });
    assert.deepEqual([by(r, "default").status, by(r, "default").currentTask], ["working", "Replying on Telegram"]);
    assert.equal(by(r, "mason").status, "idle");
  });
  it("a board task's title wins over the generic live label", () => {
    const r = buildRoster(AGENTS_LIKE_VM, [{ id: "1", title: "Scan deals", assignee: "mason", status: "running", result: null, updatedAt: new Date() }], { mason: {} });
    assert.equal(by(r, "mason").currentTask, "Scan deals");
  });
  it("labels each kind of live work plainly", () => {
    assert.deepEqual([liveLabel("cron"), liveLabel("telegram"), liveLabel("desktop"), liveLabel(undefined)], ["Running a scheduled job", "Replying on Telegram", "In a conversation", "In a conversation"]);
  });
  it("ignores inherited object keys like 'constructor'", () => {
    const r = buildRoster([{ id: "constructor", name: "x", isDefault: false, model: "m", gateway: "g" }], [], {});
    assert.equal(r[0].status, "idle");
  });
});

describe("reporting structure", () => {
  const names = (n: OrgNode): unknown => (n.children.length ? { [n.agent.name]: n.children.map(names) } : n.agent.name);
  const trees = buildOrgTree(buildRoster(AGENTS_LIKE_VM, []));
  it("matches the org chart: Friday heads Mason (> Alex), Claire (> Sarah, Video, Paula) and Tony", () => {
    assert.deepEqual(trees.map(names), [{ Friday: [{ Mason: ["Alex"] }, { Claire: ["Sarah", "Video", "Paula"] }, "Tony"] }]);
  });
  it("marks Tony as having subagents", () => {
    const tony = trees[0].children[2].agent;
    assert.deepEqual([tony.name, tony.hasSubagents], ["Tony", true]);
  });
  it("Claire's profile id is marketing-manager", () => {
    assert.equal(AGENT_DIRECTORY["marketing-manager"].name, "Claire");
  });
  it("if Friday isn't on the roster, her direct reports head their own teams", () => {
    const t = buildOrgTree(buildRoster(AGENTS_LIKE_VM.filter((a) => a.id !== "default"), []));
    assert.deepEqual(t.map((n) => n.agent.name), ["Mason", "Claire", "Tony"]);
  });
  it("a new profile with no directory entry heads its own team, after the known ones", () => {
    const t = buildOrgTree(buildRoster([...AGENTS_LIKE_VM, { id: "newbie", name: "newbie", isDefault: false, model: "m", gateway: "g" }], []));
    assert.equal(t[t.length - 1].agent.id, "newbie");
  });
  it("an agent whose manager isn't on the roster heads its own team instead of vanishing", () => {
    const t = buildOrgTree(buildRoster(AGENTS_LIKE_VM.filter((a) => a.id !== "mason"), []));
    assert.ok(t.some((n) => n.agent.id === "email-calendar"));
  });
  it("survives a reporting loop without recursing forever", () => {
    const a = { ...buildRoster([AGENTS_LIKE_VM[1]], [])[0], id: "a", reportsTo: "b" };
    const b = { ...a, id: "b", reportsTo: "a" };
    const all = buildOrgTree([a, b]).flatMap(function walk(n: OrgNode): string[] { return [n.agent.id, ...n.children.flatMap(walk)]; });
    assert.deepEqual([...new Set(all)].sort(), ["a", "b"]);
  });
});

describe("classifyTurn (is an agent mid-turn?)", () => {
  const now = 1_000_000;
  const msg = (o: object, ago = 10) => ({ role: "assistant", tool_calls: null, timestamp: now - ago, source: "telegram", ...o });
  it("a question waiting for an answer, or a tool result waiting for the model, means working", () => {
    assert.deepEqual(classifyTurn(msg({ role: "user" }), now), { working: true, source: "telegram" });
    assert.equal(classifyTurn(msg({ role: "tool" }), now).working, true);
  });
  it("an assistant message with tool calls means tools are running", () => {
    assert.equal(classifyTurn(msg({ tool_calls: '[{"id":"1"}]' }), now).working, true);
  });
  it("a finished reply means idle, including empty tool-call placeholders", () => {
    for (const tc of [null, "", "[]", "null"]) assert.equal(classifyTurn(msg({ tool_calls: tc }), now).working, false, String(tc));
  });
  it("an abandoned turn stops counting after the window", () => {
    assert.equal(classifyTurn(msg({ role: "user" }, 599), now).working, true);
    assert.equal(classifyTurn(msg({ role: "user" }, 601), now).working, false);
  });
  it("handles missing data and clock skew", () => {
    assert.equal(classifyTurn(null, now).working, false);
    assert.equal(classifyTurn({ role: "user" }, now).working, false);
    assert.equal(classifyTurn(msg({ role: "user" }, -60), now).working, false);
  });
});

describe("classifyActivity (live turn leases)", () => {
  const now = 1_000_000;
  const idleLast = { role: "assistant", tool_calls: null, timestamp: now - 3, source: "cli" };
  it("an unexpired lease means working even when the newest message is a finished reply", () => {
    assert.deepEqual(classifyActivity({ leases: [{ expires_at: now + 250 }], last: idleLast }, now), { working: true, source: "cli" });
  });
  it("expired leases left by a crashed process do not count", () => {
    assert.equal(hasLiveLease([{ expires_at: now - 1 }, { expires_at: now }], now), false);
    assert.equal(classifyActivity({ leases: [{ expires_at: now - 500 }], last: idleLast }, now).working, false);
  });
  it("falls back to the newest message when there is no lease", () => {
    assert.equal(classifyActivity({ leases: [], last: { ...idleLast, role: "user" } }, now).working, true);
    assert.equal(classifyActivity({ leases: null, last: idleLast }, now).working, false);
  });
  it("tolerates a lease with no source message and bad rows", () => {
    assert.deepEqual(classifyActivity({ leases: [{ expires_at: String(now + 60) }], last: null }, now), { working: true, source: undefined });
    assert.equal(hasLiveLease([null as never, {}, { expires_at: null }], now), false);
  });
});
