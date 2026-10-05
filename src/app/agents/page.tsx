"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, MessageSquare, X } from "lucide-react";
import { Button, EmptyState, Panel, Pill, Skeleton } from "@/components/ui/kit";
import { MAX_AGENT_MESSAGE_CHARS, type RosterAgent } from "@/lib/agents";

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

function StatusDot({ status }: { status: RosterAgent["status"] }) {
  const s = STATUS[status];
  return (
    <span className="relative flex w-2 h-2 shrink-0">
      {s.pulse && <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ background: s.color }} />}
      <span className="relative inline-flex w-2 h-2 rounded-full" style={{ background: s.color }} />
    </span>
  );
}

function AgentCard({ agent, expanded, onToggle, onChat }: { agent: RosterAgent; expanded: boolean; onToggle: () => void; onChat: () => void }) {
  const s = STATUS[agent.status];
  return (
    <Panel className="overflow-hidden">
      <button className="block w-full text-left p-5" onClick={onToggle} aria-expanded={expanded}>
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-[var(--r-md)] flex items-center justify-center text-2xl shrink-0" style={{ background: "var(--surface-2)", border: "1px solid var(--line)" }}>
            {agent.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <StatusDot status={agent.status} />
              <h3 className="text-[14px] font-semibold text-[var(--text)] truncate">{agent.name}</h3>
              <span className="text-[10px] font-medium shrink-0" style={{ color: s.color }}>{s.label}</span>
            </div>
            <p className="text-[12px] text-[var(--text-3)] mt-1">{agent.role}</p>
            {agent.currentTask && <p className="text-[12px] mt-2 truncate" style={{ color: "var(--accent)" }}>{agent.currentTask}</p>}
          </div>
          <div className="text-right shrink-0 min-w-[3rem]">
            <div className="num text-[22px] font-semibold text-[var(--text)] leading-none">{agent.tasksDone}</div>
            <div className="eyebrow mt-1.5">done</div>
            {agent.tasksOpen > 0 && <div className="num text-[10px] text-[var(--warn)] mt-1">{agent.tasksOpen} open</div>}
            {agent.lastActive && <div className="num text-[10px] text-[var(--text-4)] mt-1">{timeAgo(agent.lastActive)}</div>}
          </div>
        </div>
      </button>

      <div className="px-5 pb-4 -mt-1 flex items-center justify-between gap-3">
        {agent.isDefault ? (
          <Link href="/" className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-3)] hover:text-[var(--text)] shrink-0">
            <MessageSquare className="w-3.5 h-3.5" />Talk to {agent.name} on Today
          </Link>
        ) : (
          <button onClick={onChat} className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-2)] hover:text-[var(--text)] shrink-0">
            <MessageSquare className="w-3.5 h-3.5" />Chat with {agent.name}
          </button>
        )}
        <span className="text-[11px] text-[var(--text-4)] truncate num" title={agent.model}>{agent.model}</span>
      </div>

      {expanded && (
        <div className="px-5 py-4 space-y-2.5" style={{ borderTop: "1px solid var(--line)" }}>
          <h4 className="eyebrow">Recent tasks</h4>
          {agent.recentActivity.length === 0 ? (
            <p className="text-[12px] text-[var(--text-3)] py-1">No tasks on the board yet.</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
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
      )}
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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/agents");
      if (r.ok) setAgents((await r.json()).agents);
    } catch { /* keep the last roster */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  if (agents === null) return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}</div>;
  if (agents.length === 0)
    return <Panel className="p-6"><EmptyState title="No agents reported yet" hint="The bridge mirrors Hermes' agents every couple of minutes. If this stays empty, check that the bridge is running." /></Panel>;

  const lead = agents.find((a) => a.isDefault);
  const team = agents.filter((a) => !a.isDefault);
  const working = agents.filter((a) => a.status === "working").length;
  const done = agents.reduce((n, a) => n + a.tasksDone, 0);
  const chatAgent = agents.find((a) => a.id === chatId) ?? null;

  const card = (a: RosterAgent) => (
    <AgentCard key={a.id} agent={a} expanded={expanded === a.id} onToggle={() => setExpanded(expanded === a.id ? null : a.id)} onChat={() => setChatId(a.id)} />
  );

  return (
    <div className="space-y-8 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-2.5">Hermes</div>
          <h1 className="text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">Your AI team</h1>
          <p className="text-[13px] text-[var(--text-3)] mt-3">Live from Hermes. Friday delegates to the team through the kanban board.</p>
        </div>
        <div className="flex gap-7 text-center">
          <div><div className="num text-[22px] font-semibold leading-none text-[var(--text)]">{agents.length}</div><div className="eyebrow mt-1.5">Agents</div></div>
          <div><div className="num text-[22px] font-semibold leading-none" style={{ color: "var(--accent)" }}>{working}</div><div className="eyebrow mt-1.5">Working</div></div>
          <div><div className="num text-[22px] font-semibold leading-none text-[var(--text)]">{done}</div><div className="eyebrow mt-1.5">Tasks done</div></div>
        </div>
      </div>

      {lead && card(lead)}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{team.map(card)}</div>

      {lead && (
        <div className="pt-6" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="eyebrow mb-5">Team structure</div>
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2.5 rounded-[var(--r-md)] px-4 py-2.5" style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 24%, transparent)" }}>
              <span className="text-xl">{lead.emoji}</span>
              <div><div className="text-[13px] font-semibold text-[var(--text)]">{lead.name}</div><div className="text-[10px] text-[var(--text-3)]">{lead.role}</div></div>
            </div>
            <div className="w-px h-6" style={{ background: "var(--line-strong)" }} />
            <div className="w-full max-w-3xl h-px" style={{ background: "var(--line-strong)" }} />
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              {team.map((a) => (
                <div key={a.id} className="flex items-center gap-2.5 rounded-[var(--r-md)] px-3.5 py-2.5" style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}>
                  <span className="text-lg">{a.emoji}</span>
                  <div><div className="text-[12px] font-semibold text-[var(--text)]">{a.name}</div><div className="text-[10px] text-[var(--text-3)]">{a.role}</div></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {chatAgent && <AgentChat key={chatAgent.id} agent={chatAgent} onClose={() => setChatId(null)} />}
    </div>
  );
}
