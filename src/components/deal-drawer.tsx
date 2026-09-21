"use client";

/* Deal drawer — edit a deal, log consent, and run Hermes playbooks against it.
   Playbooks only produce drafts/research; nothing here sends anything. */

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, Mail, Play, Trash2, X } from "lucide-react";
import { Button, Panel, Pill } from "@/components/ui/kit";
import { CONSENT_BASES, fmtMoney, stageLabel } from "@/lib/crm";
import { ACTIVITY_LABEL, LOGGABLE_TYPES, gmailComposeUrl, parseDraft } from "@/lib/outreach";

export interface PlaybookLite { key: string; name: string; description: string; needsInput: boolean }
export interface VentureLite { key: string; name: string; stages: string[]; wonStage: string; lostStage: string; recurring: boolean }

interface Run {
  id: string; title: string; status: string; result: string | null; error: string | null;
  playbookKey: string | null; createdAt: string;
}
interface Activity { id: string; type: string; summary: string; meta: { from?: string; to?: string; requestId?: string } | null; occurredAt: string }
interface Detail {
  deal: {
    id: string; title: string; stage: string; valueCents: number; nextAction: string | null; nextActionDue: string | null;
    notes: string | null; lostReason: string | null;
    company: { id: string; name: string; website: string | null; industry: string | null; size: string | null; location: string | null };
    contact: { id: string; name: string; email: string | null; title: string | null; linkedinUrl: string | null; consentBasis: string; unsubscribedAt: string | null } | null;
  };
  requests: Run[];
  activities: Activity[];
}

export const INPUT =
  "w-full rounded-[var(--r-md,10px)] bg-white/[0.04] border border-white/10 px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--text-3)] outline-none focus:border-[var(--accent)]";

const LIVE = new Set(["queued", "approved", "running", "awaiting_approval"]);
const STATUS_TONE: Record<string, "up" | "down" | "warn" | "accent" | "neutral"> = {
  done: "up", failed: "down", rejected: "down", awaiting_approval: "warn", running: "accent", queued: "neutral", approved: "accent",
};

const EMAIL_PLAYBOOKS = new Set(["draft-intro-email", "draft-followup", "draft-reply"]);
const safeHttpUrl = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);

interface Handoff {
  email: string | null; linkedinUrl: string | null; unsubscribed: boolean;
  logged: boolean; onLogSent: (type: "email_sent" | "linkedin_sent", summary: string) => Promise<void>;
}

function RunCard({ run, handoff }: { run: Run; handoff: Handoff }) {
  const [copied, setCopied] = useState(false);
  const [logging, setLogging] = useState(false);
  const isEmail = !!run.playbookKey && EMAIL_PLAYBOOKS.has(run.playbookKey);
  const isLinkedIn = run.playbookKey === "draft-linkedin-note";
  const draft = run.result && (isEmail || isLinkedIn) ? parseDraft(run.result) : null;
  const gmail = draft && isEmail ? gmailComposeUrl({ to: handoff.email, subject: draft.subject, body: draft.body }) : null;
  const profile = safeHttpUrl(handoff.linkedinUrl);
  const actionCls = "inline-flex items-center gap-1.5 text-[12px] text-[var(--text-3)] hover:text-[var(--text)]";

  return (
    <div className="rounded-[var(--r-md,10px)] border border-white/[0.07] p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-[var(--text)] truncate">{run.title}</span>
        <Pill tone={STATUS_TONE[run.status] ?? "neutral"}>{run.status.replace("_", " ")}</Pill>
      </div>
      {LIVE.has(run.status) && (
        <p className="text-[12px] text-[var(--text-3)] flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />
          {run.status === "awaiting_approval" ? "Waiting for your approval in Hermes → Approval inbox" : "Waiting for Hermes…"}
        </p>
      )}
      {run.error && <p className="text-[12px] text-[var(--down)]">{run.error}</p>}
      {run.result && (
        <>
          <pre className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-[var(--text-2)] max-h-64 overflow-auto font-sans">{run.result}</pre>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <button
              className={actionCls}
              onClick={async () => {
                try { await navigator.clipboard.writeText(run.result ?? ""); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
              }}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}{copied ? "Copied" : "Copy"}
            </button>
            {draft && !handoff.unsubscribed && (
              <>
                {gmail && (
                  <a className={actionCls} href={gmail.url} target="_blank" rel="noopener noreferrer">
                    <Mail className="w-3.5 h-3.5" />Open in Gmail<ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {isLinkedIn && profile && (
                  <a className={actionCls} href={profile} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-3.5 h-3.5" />Open profile
                  </a>
                )}
                {handoff.logged ? (
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--up)]"><Check className="w-3.5 h-3.5" />Logged as sent</span>
                ) : (
                  <button
                    className={actionCls} disabled={logging}
                    onClick={async () => { setLogging(true); await handoff.onLogSent(isEmail ? "email_sent" : "linkedin_sent", draft.subject || run.title); setLogging(false); }}
                  >
                    {logging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}I sent it
                  </button>
                )}
              </>
            )}
          </div>
          {gmail?.truncated && <p className="text-[11.5px] text-[var(--warn)]">Long draft: the Gmail link is shortened. Use Copy for the full text.</p>}
          {draft && handoff.unsubscribed && <p className="text-[11.5px] text-[var(--down)]">This contact has unsubscribed. Don&apos;t send this.</p>}
          {isEmail && draft && !handoff.email && <p className="text-[11.5px] text-[var(--text-3)]">No email address on this contact, so Gmail opens without a recipient.</p>}
        </>
      )}
    </div>
  );
}

export function DealDrawer({
  dealId, venture, playbooks, onClose, onChanged,
}: {
  dealId: string; venture: VentureLite; playbooks: PlaybookLite[]; onClose: () => void; onChanged: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [input, setInput] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [actType, setActType] = useState<string>("note");
  const [actText, setActText] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/deals/${dealId}`);
      if (!r.ok) throw new Error("not found");
      setDetail(await r.json());
    } catch { setErr("Couldn't load this deal."); }
  }, [dealId]);

  useEffect(() => { setDetail(null); setErr(null); setNotice(null); load(); }, [load]);

  // poll while any playbook run is still in flight
  const anyLive = detail?.requests.some((r) => LIVE.has(r.status)) ?? false;
  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [anyLive, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function patch(url: string, body: Record<string, unknown>) {
    setErr(null);
    const r = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "Update failed"); return false; }
    await load(); onChanged(); return true;
  }

  async function logActivity(type: string, summary: string, requestId?: string) {
    setErr(null);
    const r = await fetch(`/api/deals/${dealId}/activities`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, summary, requestId }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error ?? "Couldn't log that"); return false; }
    if (j.advancedTo) setNotice(`Moved to ${stageLabel(j.advancedTo)}. Follow-up set on the deal.`);
    await load(); onChanged(); return true;
  }

  async function run(pb: PlaybookLite) {
    setBusy(pb.key); setErr(null); setNotice(null);
    const r = await fetch("/api/playbooks/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playbookKey: pb.key, dealId, input: input[pb.key] ?? "" }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setErr(j.error ?? "Couldn't start that playbook"); return; }
    if (j.warning) setNotice(j.warning);
    await load();
  }

  const d = detail?.deal;
  const stages = [...venture.stages, venture.wonStage, venture.lostStage];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Deal details">
      <button aria-label="Close" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="relative w-full max-w-[520px] h-full overflow-y-auto bg-[var(--bg)] border-l border-white/10 p-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">{venture.name}</p>
            <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.015em] text-[var(--text)] truncate">{d?.company.name ?? "Loading…"}</h2>
            {d?.company.website && <p className="text-[12.5px] text-[var(--text-3)] truncate">{d.company.website}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-[var(--text-3)] hover:text-[var(--text)] hover:bg-white/5" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        {err && <p className="text-[13px] text-[var(--down)]" role="alert">{err}</p>}
        {notice && <p className="text-[13px] text-[var(--warn)]" role="status">{notice}</p>}

        {d && (
          <>
            <Panel className="p-4 space-y-3">
              {/* Uncontrolled fields are keyed on their server value so they refresh when a log/playbook changes it. */}
              <label className="block">
                <span className="eyebrow">Stage</span>
                <select
                  className={`${INPUT} mt-1`} value={d.stage}
                  onChange={async (e) => {
                    const stage = e.target.value;
                    const lostReason = stage === venture.lostStage ? (window.prompt("Why was this lost? (optional)") ?? "") : undefined;
                    await patch(`/api/deals/${d.id}`, { stage, lostReason });
                  }}
                >
                  {stages.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="eyebrow">{venture.recurring ? "Monthly value (CAD)" : "Value (CAD)"}</span>
                  <input key={d.valueCents} className={`${INPUT} mt-1`} inputMode="decimal" defaultValue={d.valueCents ? String(d.valueCents / 100) : ""} placeholder="0"
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== String(d.valueCents / 100) && !(v === "" && d.valueCents === 0)) patch(`/api/deals/${d.id}`, { value: v === "" ? "0" : v }); }} />
                </label>
                <label className="block">
                  <span className="eyebrow">Next action due</span>
                  <input key={`due-${d.nextActionDue}`} className={`${INPUT} mt-1`} type="date" defaultValue={d.nextActionDue?.slice(0, 10) ?? ""}
                    onChange={(e) => patch(`/api/deals/${d.id}`, { nextActionDue: e.target.value || null })} />
                </label>
              </div>
              <label className="block">
                <span className="eyebrow">Next action</span>
                <input key={`na-${d.nextAction}`} className={`${INPUT} mt-1`} defaultValue={d.nextAction ?? ""} placeholder="e.g. Send intro email"
                  onBlur={(e) => { if (e.target.value !== (d.nextAction ?? "")) patch(`/api/deals/${d.id}`, { nextAction: e.target.value }); }} />
              </label>
              <label className="block">
                <span className="eyebrow">Notes</span>
                <textarea key={`notes-${d.notes}`} className={`${INPUT} mt-1 min-h-[72px]`} defaultValue={d.notes ?? ""} placeholder="Anything Hermes should know (used in playbooks)"
                  onBlur={(e) => { if (e.target.value !== (d.notes ?? "")) patch(`/api/deals/${d.id}`, { notes: e.target.value }); }} />
              </label>
              {d.valueCents > 0 && <p className="text-[12px] text-[var(--text-3)]">{fmtMoney(d.valueCents)}{venture.recurring ? " / month" : ""}</p>}
            </Panel>

            <Panel className="p-4 space-y-3">
              <p className="eyebrow">Contact</p>
              {d.contact ? (
                <>
                  <div>
                    <p className="text-[14px] font-medium text-[var(--text)]">{d.contact.name}</p>
                    <p className="text-[12.5px] text-[var(--text-3)]">{[d.contact.title, d.contact.email].filter(Boolean).join(" · ") || "No details"}</p>
                  </div>
                  <label className="block">
                    <span className="eyebrow">CASL consent basis</span>
                    <select className={`${INPUT} mt-1`} value={d.contact.consentBasis} onChange={(e) => patch(`/api/contacts/${d.contact!.id}`, { consentBasis: e.target.value })}>
                      {CONSENT_BASES.map((c) => <option key={c} value={c}>{stageLabel(c)}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-[13px] text-[var(--text-2)]">
                    <input type="checkbox" checked={!!d.contact.unsubscribedAt} onChange={(e) => patch(`/api/contacts/${d.contact!.id}`, { unsubscribed: e.target.checked })} />
                    Unsubscribed — no outreach drafts
                  </label>
                </>
              ) : <p className="text-[12.5px] text-[var(--text-3)]">No contact on this deal. Outreach playbooks need one.</p>}
            </Panel>

            <section className="space-y-3">
              <p className="eyebrow">Hermes playbooks</p>
              {playbooks.length === 0 && <p className="text-[12.5px] text-[var(--text-3)]">No playbooks yet. Run `npm run db:seed`.</p>}
              {playbooks.map((pb) => (
                <Panel key={pb.key} className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium text-[var(--text)]">{pb.name}</p>
                      <p className="text-[12px] text-[var(--text-3)]">{pb.description}</p>
                    </div>
                    <Button size="sm" onClick={() => run(pb)} disabled={busy === pb.key || (pb.needsInput && !(input[pb.key] ?? "").trim())}>
                      {busy === pb.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}Run
                    </Button>
                  </div>
                  {pb.needsInput && (
                    <textarea className={`${INPUT} min-h-[56px]`} placeholder="What happened so far?" value={input[pb.key] ?? ""} onChange={(e) => setInput({ ...input, [pb.key]: e.target.value })} />
                  )}
                </Panel>
              ))}
            </section>

            {detail.requests.length > 0 && (
              <section className="space-y-3">
                <p className="eyebrow">Runs</p>
                {detail.requests.map((r) => (
                  <RunCard
                    key={r.id} run={r}
                    handoff={{
                      email: d.contact?.email ?? null, linkedinUrl: d.contact?.linkedinUrl ?? null, unsubscribed: !!d.contact?.unsubscribedAt,
                      logged: detail.activities.some((a) => a.meta?.requestId === r.id),
                      onLogSent: async (type, summary) => { await logActivity(type, summary, r.id); },
                    }}
                  />
                ))}
              </section>
            )}

            <section className="space-y-3">
              <p className="eyebrow">Activity</p>
              <form
                className="flex flex-wrap gap-2"
                onSubmit={async (e) => { e.preventDefault(); if (await logActivity(actType, actText)) setActText(""); }}
              >
                <select className={`${INPUT.replace("w-full", "w-[9.5rem]")} shrink-0`} value={actType} onChange={(e) => setActType(e.target.value)} aria-label="Activity type">
                  {LOGGABLE_TYPES.map((t) => <option key={t} value={t}>{ACTIVITY_LABEL[t]}</option>)}
                </select>
                <input className={`${INPUT} flex-1 min-w-[10rem]`} value={actText} onChange={(e) => setActText(e.target.value)} placeholder="What happened? (optional)" aria-label="Activity note" />
                <Button type="submit" size="sm">Log</Button>
              </form>
              {detail.activities.length === 0 ? (
                <p className="text-[12.5px] text-[var(--text-3)]">Nothing logged yet. Logging an email you sent or a reply you got moves the deal and sets the next follow-up for you.</p>
              ) : (
                <ol className="space-y-2">
                  {detail.activities.map((a) => (
                    <li key={a.id} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                      <span className="min-w-0">
                        <span className="text-[var(--text-2)] font-medium">{ACTIVITY_LABEL[a.type] ?? a.type}</span>
                        {(a.type === "stage" && a.meta?.to) ? <span className="text-[var(--text-3)]"> · {stageLabel(a.meta.from ?? "?")} → {stageLabel(a.meta.to)}</span>
                          : a.summary ? <span className="text-[var(--text-3)]"> · {a.summary}</span> : null}
                      </span>
                      <time className="shrink-0 text-[var(--text-3)] num" dateTime={a.occurredAt}>
                        {new Date(a.occurredAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                      </time>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <div className="pt-2">
              <button
                className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--text-3)] hover:text-[var(--down)]"
                onClick={async () => { if (window.confirm(`Delete the ${d.company.name} deal? This can't be undone.`)) { await fetch(`/api/deals/${d.id}`, { method: "DELETE" }); onChanged(); onClose(); } }}
              ><Trash2 className="w-3.5 h-3.5" />Delete deal</button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
