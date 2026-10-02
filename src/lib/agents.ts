// Agents page: the roster is what Hermes actually has (profiles mirrored by the bridge), dressed with a name,
// emoji and role from AGENT_DIRECTORY below. A new Hermes profile shows up automatically with a plain fallback;
// add an entry here to give it a proper name and role.

export const AGENT_KIND = "agent.chat";
export const MAX_AGENT_MESSAGE_CHARS = 2000;

export const AGENT_DIRECTORY: Record<string, { name: string; emoji: string; role: string }> = {
  default: { name: "Friday", emoji: "✨", role: "Chief of Staff · Orchestrator" },
  mason: { name: "Mason", emoji: "💼", role: "Sales · Outreach & Email" },
  builder: { name: "Tony", emoji: "🛠️", role: "Engineering · Product Builder" },
  paula: { name: "Paula", emoji: "🎨", role: "Design · Creative Director" },
  video: { name: "Video", emoji: "🎬", role: "Video Creation & Editing" },
  sarah: { name: "Sarah", emoji: "🌸", role: "Specialist" },
  "email-calendar": { name: "Email & Calendar", emoji: "📅", role: "Inbox & Schedule Assistant" },
};

// Friday's delegation instructions call the engineering agent "tony"; the Hermes profile is named "builder".
const ASSIGNEE_ALIASES: Record<string, string> = { tony: "builder" };

const WORKING = new Set(["running", "in_progress", "claimed", "started"]);
const FINISHED = new Set(["done", "completed", "archived", "cancelled", "canceled"]);

export interface MirroredAgent { id: string; name: string; isDefault: boolean; model: string; gateway: string }
export interface TaskLite { id: string; title: string; assignee: string | null; status: string; result: string | null; updatedAt: Date | string }
export interface AgentActivity { title: string; status: string; result: string | null; at: string }
export interface RosterAgent {
  id: string; name: string; emoji: string; role: string; isDefault: boolean; model: string; gateway: string;
  status: "working" | "idle"; currentTask?: string; lastActive?: string;
  tasksDone: number; tasksOpen: number; recentActivity: AgentActivity[];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const iso = (d: Date | string) => new Date(d).toISOString();

export function buildRoster(mirrored: MirroredAgent[], tasks: TaskLite[]): RosterAgent[] {
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
    return {
      id: a.id,
      name: dir?.name ?? cap(a.name),
      emoji: dir?.emoji ?? "👤",
      role: dir?.role ?? "Hermes profile",
      isDefault: a.isDefault,
      model: a.model,
      gateway: a.gateway,
      status: working ? "working" : "idle",
      currentTask: working?.title,
      lastActive: mine[0] ? iso(mine[0].updatedAt) : undefined,
      tasksDone: mine.filter((t) => t.status.toLowerCase() === "done").length,
      tasksOpen: mine.filter((t) => !FINISHED.has(t.status.toLowerCase())).length,
      recentActivity: mine.slice(0, 10).map((t) => ({ title: t.title, status: t.status, result: t.result, at: iso(t.updatedAt) })),
    };
  });
}
