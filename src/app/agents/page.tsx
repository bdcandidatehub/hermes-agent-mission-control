"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, MessageSquare, X } from "lucide-react";
import { Button, EmptyState, Panel, Pill, Skeleton } from "@/components/ui/kit";
import { MAX_AGENT_MESSAGE_CHARS, buildOrgTree, type OrgNode, type RosterAgent } from "@/lib/agents";

interface Turn { id: string; status: string; message: string; reply: string | null; error: string | null }
const LIVE = new Set(["queued", "approved", "running"]);

function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

const STATUS = {
  working: { color: "var(--accent)", label: "Working", pulse: true },
  idle: { color: "var(--up)", label: "Ready", pulse: false },
} as const;

const RAIL = "var(--line-strong)";

function StatusDot({ status }: { status: RosterAgent["status"] }) {
  const s = STATUS[status];
  return (
    <span className="relative flex w-2 h-2 shrink-0">
      {s.pulse && <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ background: s.color }} />}
      <span className="relative inline-flex w-2 h-2 rounded-full" style={{ background: s.color }} />
    </span>
  );
}

// One agent in the org chart. A working agent gets an accent outline and glow so it stands out at a glance.
function OrgCard({ agent, selected, onSelect }: { agent: RosterAgent; selected: boolean; onSelect: () => void }) {
  const s = STATUS[agent.status];
  const working = agent.status === "working";
  return (
    <button
      onClick={onSelect} aria-pressed={selected} aria-label={`${agent.name}, ${agent.role}, ${s.label}`}
      className="panel panel-interactive w-[148px] sm:w-[152px] p-2.5 text-left transition-shadow"
      style={{
        borderColor: working ? "var(--accent)" : selected ? "var(--line-strong)" : undefined,
        boxShadow: working ? "0 0 0 1px var(--accent), 0 0 22px color-mix(in srgb, var(--accent) 28%, transparent)" : selected ? "0 0 0 1px var(--line-strong)" : undefined,
      }}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-[var(--r-md)] flex items-center justify-center text-lg shrink-0" style={{ background: "var(--surface-2)", border: "1px solid var(--line)" }}>{agent.emoji}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <StatusDot status={agent.status} />
            <span className="text-[13px] font-semibold text-[var(--text)] truncate">{agent.name}</span>
          </div>
          <div className="text-[10.5px] font-medium" style={{ color: s.color }}>{s.label}</div>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-[var(--text-3)]">{agent.role}</p>
      {working && agent.currentTask && <p className="mt-1.5 text-[11px] leading-snug truncate" style={{ color: "var(--accent)" }} title={agent.currentTask}>{agent.currentTask}</p>}
    </button>
  );
}

// Tony's throwaway helpers aren't Hermes profiles, so they get a plain dashed box under him.
function SubagentsNode() {
  return (
    <div className="w-[148px] sm:w-[152px] rounded-[var(--r-md,10px)] px-3 py-2.5 text-center" style={{ border: "1px dashed var(--line-strong)" }}>
      <div className="text-[12.5px] font-medium text-[var(--text-2)]">Subagents</div>
      <div className="text-[10.5px] text-[var(--text-3)]">spawned as needed</div>
    </div>
  );
}

// A manager with their reports beneath: a vertical line down, a rail across, and a short drop to each report.
function Branch({ node, selectedId, onSelect }: { node: OrgNode; selectedId: string; onSelect: (id: string) => void }) {
  const items: { key: string; el: React.ReactNode }[] = [
    ...node.children.map((c) => ({ key: c.agent.id, el: <Branch node={c} selectedId={selectedId} onSelect={onSelect} /> })),
    ...(node.agent.hasSubagents ? [{ key: "__subagents", el: <SubagentsNode /> }] : []),
  ];
  return (
    <div className="flex flex-col items-center">
      <OrgCard agent={node.agent} selected={selectedId === node.agent.id} onSelect={() => onSelect(node.agent.id)} />
      {items.length > 0 && (
        <>
          <div className="w-px h-5" style={{ background: RAIL }} />
          <div className="flex items-start justify-center">
            {items.map((it, i) => (
              <div key={it.key} className="relative flex flex-col items-center px-1.5 pt-5">
                {items.length > 1 && <div className="absolute top-0 h-px" style={{ background: RAIL, left: i === 0 ? "50%" : 0, right: i === items.length - 1 ? "50%" : 0 }} />}
                <div className="absolute top-0 left-1/2 w-px h-5" style={{ background: RAIL }} />
                {it.el}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Detail({ agent, onChat }: { agent: RosterAgent; onChat: () => void }) {
  return (
    <Panel className="p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-12 h-12 rounded-[var(--r-md)] flex items-center justify-center text-2xl shrink-0" style={{ background: "var(--surface-2)", border: "1px solid var(--line)" }}>{agent.emoji}</div>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><StatusDot status={agent.status} /><h3 className="text-[16px] font-semibold text-[var(--text)]">{agent.name}</h3>
              <span className="text-[11px] font-medium" style={{ color: STATUS[agent.status].color }}>{STATUS[agent.status].label}</span></div>
            <p className="text-[12.5px] text-[var(--text-3)]">{agent.role}</p>
            <p className="text-[11.5px] text-[var(--text-4)] num truncate" title={agent.model}>{agent.model}</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right"><div className="num text-[20px] font-semibold text-[var(--text)] leading-none">{agent.tasksDone}</div><div className="eyebrow mt-1.5">done</div></div>
          {agent.tasksOpen > 0 && <div className="text-right"><div className="num text-[20px] font-semibold leading-none" style={{ color: "var(--warn)" }}>{agent.tasksOpen}</div><div className="eyebrow mt-1.5">open</div></div>}
          {agent.isDefault ? (
            <Link href="/" className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--text-2)] hover:text-[var(--text)]"><MessageSquare className="w-3.5 h-3.5" />Talk to {agent.name} on Today</Link>
          ) : (
            <Button onClick={onChat}><MessageSquare className="w-3.5 h-3.5" />Chat with {agent.name}</Button>
          )}
        </div>
      </div>
      {agent.status === "working" && agent.currentTask && <p className="text-[12.5px]" style={{ color: "var(--accent)" }}>{agent.currentTask}</p>}
      <div>
        <h4 className="eyebrow mb-2">Recent tasks</h4>
        {agent.recentActivity.length === 0 ? (
          <p className="text-[12.5px] text-[var(--text-3)]">No tasks on the board yet.</p>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {agent.recentActivity.map((a, i) => (
              <div key={i} className="flex items-start gap-2.5 text-[12px]">
                <span className="num text-[var(--text-4)] shrink-0 w-14">{timeAgo(a.at)}</span>
                <span className="text-[var(--text-2)] min-w-0 flex-1 truncate">{a.title}</span>
                <Pill tone={a.status === "done" ? "up" : a.status === "blocked" ? "warn" : "neutral"}>{a.status}</Pill>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function AgentChat({ agent, onClose }: { agent: RosterAgent; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[] | null>(null);
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/agents/chat?agent=${encodeURIComponent(agent.id)}`);
      if (r.ok) setTurns((await r.json()).turns);
    } catch { /* keep what we have */ }
  }, [agent.id]);

  useEffect(() => { load(); }, [load]);

  const anyLive = turns?.some((t) => LIVE.has(t.status)) ?? false;
  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [anyLive, load]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send() {
    const message = input.trim();
    if (!message || sending) return;
    setSending(true); setErr(null);
    const r = await fetch("/api/agents/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent: agent.id, message }) });
    const j = await r.json().catch(() => ({}));
    setSending(false);
    if (!r.ok) { setErr(j.error ?? "Couldn't send that."); return; }
    setInput("");
    await load();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Chat with ${agent.name}`}>
      <button aria-label="Close" className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="elevated relative w-full max-w-lg overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: "1px solid var(--line)" }}>
          <div className="text-2xl">{agent.emoji}</div>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-[var(--text)]">{agent.name}</div>
            <div className="text-[12px] text-[var(--text-3)] truncate">{agent.role} · <span className="num">{agent.model}</span></div>
          </div>
          <button onClick={onClose} className="ml-auto p-1.5 text-[var(--text-3)] hover:text-[var(--text)]" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="h-80 overflow-y-auto p-4 space-y-3" style={{ background: "var(--surface-1)" }}>
          {turns === null && <Skeleton className="h-16" />}
          {turns?.length === 0 && (
            <div className="h-full flex items-center justify-center">
              <p className="text-[var(--text-3)] text-[13px] text-center">Ask {agent.name} anything.<br />Each message is billed by {agent.model}.</p>
            </div>
          )}
          {turns?.map((t) => (
            <div key={t.id} className="space-y-2">
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-[var(--r-md)] px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ background: "var(--surface-3)", color: "var(--text)" }}>{t.message}</div>
              </div>
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-[var(--r-md)] px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ background: "var(--surface-2)", border: "1px solid var(--line)", color: t.error ? "var(--down)" : "var(--text-2)" }}>
                  {LIVE.has(t.status) ? <span className="inline-flex items-center gap-1.5 text-[var(--text-3)]"><Loader2 className="w-3 h-3 animate-spin" />{agent.emoji} {t.status === "running" ? "working on it…" : "waiting its turn…"}</span>
                    : t.error ? `Couldn't get a reply: ${t.error}` : (t.reply ?? "")}
                </div>
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        {err && <p className="px-4 pt-2 text-[12.5px] text-[var(--down)]" role="alert">{err}</p>}
        <form className="flex gap-2 p-3" style={{ borderTop: "1px solid var(--line)" }} onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input
            value={input} onChange={(e) => setInput(e.target.value)} maxLength={MAX_AGENT_MESSAGE_CHARS} autoFocus
            placeholder={`Message ${agent.name}…`}
            className="flex-1 rounded-full px-4 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
          />
          <Button type="submit" variant="primary" disabled={!input.trim() || sending}>{sending ? "Sending…" : "Send"}</Button>
        </form>
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<RosterAgent[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/agents");
      if (r.ok) setAgents((await r.json()).agents);
    } catch { /* keep the last roster */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5_000); // fast enough to see an agent start and stop working
    return () => clearInterval(t);
  }, [load]);

  if (agents === null) return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}</div>;
  if (agents.length === 0)
    return <Panel className="p-6"><EmptyState title="No agents reported yet" hint="The bridge mirrors Hermes' agents every couple of minutes. If this stays empty, check that the bridge is running." /></Panel>;

  const trees = buildOrgTree(agents);
  const working = agents.filter((a) => a.status === "working").length;
  const done = agents.reduce((n, a) => n + a.tasksDone, 0);
  const selected = agents.find((a) => a.id === selectedId) ?? agents.find((a) => a.isDefault) ?? agents[0];
  const chatAgent = agents.find((a) => a.id === chatId) ?? null;

  return (
    <div className="space-y-8 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-2.5">Hermes</div>
          <h1 className="text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">Your AI team</h1>
          <p className="text-[13px] text-[var(--text-3)] mt-3">Live from Hermes. A glowing card means that agent is working right now.</p>
        </div>
        <div className="flex gap-7 text-center">
          <div><div className="num text-[22px] font-semibold leading-none text-[var(--text)]">{agents.length}</div><div className="eyebrow mt-1.5">Agents</div></div>
          <div><div className="num text-[22px] font-semibold leading-none" style={{ color: "var(--accent)" }}>{working}</div><div className="eyebrow mt-1.5">Working</div></div>
          <div><div className="num text-[22px] font-semibold leading-none text-[var(--text)]">{done}</div><div className="eyebrow mt-1.5">Tasks done</div></div>
        </div>
      </div>

      <Panel className="p-6">
        <div className="eyebrow mb-5">Reporting structure</div>
        {/* Teams stay side by side (wrapping would make one look like it reports to another); a narrow screen scrolls instead. */}
        <div className="overflow-x-auto pb-2">
          <div className="flex justify-center items-start gap-8 min-w-max mx-auto">
            {trees.map((t) => <Branch key={t.agent.id} node={t} selectedId={selected.id} onSelect={setSelectedId} />)}
          </div>
        </div>
      </Panel>

      <Detail agent={selected} onChat={() => setChatId(selected.id)} />

      {chatAgent && <AgentChat key={chatAgent.id} agent={chatAgent} onClose={() => setChatId(null)} />}
    </div>
  );
}
