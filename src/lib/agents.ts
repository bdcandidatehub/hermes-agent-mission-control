// Agents page: the roster is what Hermes actually has (profiles mirrored by the bridge), dressed with a name,
// emoji, role and place in the org chart from AGENT_DIRECTORY below. A new Hermes profile shows up automatically
// with a plain fallback; add an entry here to give it a proper name, role and reporting line.

export const AGENT_KIND = "agent.chat";
export const MAX_AGENT_MESSAGE_CHARS = 2000;

export interface DirectoryEntry {
  name: string; emoji: string; role: string;
  reportsTo?: string;     // profile id of the manager; leave out for the head of a team
  order?: number;         // left-to-right position among the heads of teams
  subagents?: boolean;    // spawns throwaway helpers (shown as a "Subagents" box under the agent)
}

// Keys are Hermes profile ids. Key order is the order agents are listed in.
export const AGENT_DIRECTORY: Record<string, DirectoryEntry> = {
  mason: { name: "Mason", emoji: "💼", role: "Sales · Outreach & Email", order: 0 },
  "email-calendar": { name: "Alex", emoji: "📅", role: "Inbox & Schedule Assistant", reportsTo: "mason" }, // profile id is still email-calendar
  default: { name: "Friday", emoji: "✨", role: "Chief of Staff · Orchestrator", order: 1 },
  tony: { name: "Tony", emoji: "🛠️", role: "Engineering · Product Builder", reportsTo: "default", subagents: true },
  "marketing-manager": { name: "Claire", emoji: "📣", role: "Marketing Manager", order: 2 }, // profile id is marketing-manager
  sarah: { name: "Sarah", emoji: "✂️", role: "Video Editing", reportsTo: "marketing-manager" },
  video: { name: "Video", emoji: "🎬", role: "Video Creation", reportsTo: "marketing-manager" },
  paula: { name: "Paula", emoji: "🎨", role: "Design · Creative Director", reportsTo: "marketing-manager" },
};

// Tony's Hermes profile used to be called "builder"; tasks assigned under the old name still count as his.
const ASSIGNEE_ALIASES: Record<string, string> = { builder: "tony" };

const WORKING = new Set(["running", "in_progress", "claimed", "started"]);
const FINISHED = new Set(["done", "completed", "archived", "cancelled", "canceled"]);

export interface MirroredAgent { id: string; name: string; isDefault: boolean; model: string; gateway: string }
export interface TaskLite { id: string; title: string; assignee: string | null; status: string; result: string | null; updatedAt: Date | string }
export interface AgentActivity { title: string; status: string; result: string | null; at: string }
export interface RosterAgent {
  id: string; name: string; emoji: string; role: string; isDefault: boolean; model: string; gateway: string;
  reportsTo: string | null; hasSubagents: boolean; order: number | null;
  status: "working" | "idle"; currentTask?: string; lastActive?: string;
  tasksDone: number; tasksOpen: number; recentActivity: AgentActivity[];
}

// Agents that are mid-turn right now, from outside the board (a conversation, a Telegram reply, a scheduled job).
export type LiveMap = Record<string, { source?: string }>;

export function liveLabel(source?: string): string {
  switch (source) {
    case "cron": return "Running a scheduled job";
    case "telegram": return "Replying on Telegram";
    default: return "In a conversation";
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const iso = (d: Date | string) => new Date(d).toISOString();

export function buildRoster(mirrored: MirroredAgent[], tasks: TaskLite[], live: LiveMap = {}): RosterAgent[] {
  const order = Object.keys(AGENT_DIRECTORY);
  const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
  const sorted = [...mirrored].sort((a, b) => rank(a.id) - rank(b.id)); // stable: unknown profiles keep Hermes' order

  return sorted.map((a) => {
    const dir = AGENT_DIRECTORY[a.id];
    const mine = tasks
      .filter((t) => {
        const who = (t.assignee ?? "").toLowerCase();
        return (ASSIGNEE_ALIASES[who] ?? who) === a.id;
      })
      .sort((x, y) => +new Date(y.updatedAt) - +new Date(x.updatedAt));
    const working = mine.find((t) => WORKING.has(t.status.toLowerCase()));
    const inTurn = Object.prototype.hasOwnProperty.call(live, a.id) ? live[a.id] : null;
    return {
      id: a.id,
      name: dir?.name ?? cap(a.name),
      emoji: dir?.emoji ?? "👤",
      role: dir?.role ?? "Hermes profile",
      isDefault: a.isDefault,
      model: a.model,
      gateway: a.gateway,
      reportsTo: dir?.reportsTo ?? null,
      hasSubagents: !!dir?.subagents,
      order: dir?.order ?? null,
      status: working || inTurn ? "working" : "idle",
      currentTask: working?.title ?? (inTurn ? liveLabel(inTurn.source) : undefined),
      lastActive: mine[0] ? iso(mine[0].updatedAt) : undefined,
      tasksDone: mine.filter((t) => t.status.toLowerCase() === "done").length,
      tasksOpen: mine.filter((t) => !FINISHED.has(t.status.toLowerCase())).length,
      recentActivity: mine.slice(0, 10).map((t) => ({ title: t.title, status: t.status, result: t.result, at: iso(t.updatedAt) })),
    };
  });
}

export interface OrgNode { agent: RosterAgent; children: OrgNode[] }

// The reporting structure as trees. An agent whose manager isn't on the roster (or who has none) heads its own team.
// Heads of teams are placed by `order`, then in roster order, so the chart reads the same way every time.
export function buildOrgTree(agents: RosterAgent[]): OrgNode[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const kids = new Map<string, RosterAgent[]>();
  const heads: RosterAgent[] = [];
  for (const a of agents) {
    const boss = a.reportsTo && a.reportsTo !== a.id && byId.has(a.reportsTo) ? a.reportsTo : null;
    if (boss) kids.set(boss, [...(kids.get(boss) ?? []), a]);
    else heads.push(a);
  }
  heads.sort((x, y) => (x.order ?? 1000) - (y.order ?? 1000)); // stable: ties keep roster order

  const seen = new Set<string>();
  const build = (a: RosterAgent): OrgNode => {
    seen.add(a.id);
    return { agent: a, children: (kids.get(a.id) ?? []).filter((c) => !seen.has(c.id)).map(build) };
  };
  const trees = heads.map(build);
  for (const a of agents) if (!seen.has(a.id)) trees.push(build(a)); // anything stuck in a reporting loop still shows
  return trees;
}
