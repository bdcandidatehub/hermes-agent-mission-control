"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Plus, X } from "lucide-react";
import { Button, EmptyState, Panel, Pill, SectionHeader, Skeleton } from "@/components/ui/kit";
import { DealDrawer, INPUT, type PlaybookLite, type VentureLite } from "@/components/deal-drawer";
import { CONSENT_BASES, fmtMoney, stageLabel } from "@/lib/crm";

interface Deal {
  id: string; title: string; stage: string; valueCents: number; nextAction: string | null; nextActionDue: string | null;
  company: { id: string; name: string }; contact: { id: string; name: string; title: string | null } | null;
}

// Local (browser) calendar-day comparison for the little due chip on cards.
function dueChip(due: string | null): { label: string; tone: "down" | "warn" | "neutral" } | null {
  if (!due) return null;
  const ymd = due.slice(0, 10);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const label = new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
  if (ymd < today) return { label: `${label} · overdue`, tone: "down" };
  if (ymd === today) return { label: "Today", tone: "warn" };
  return { label, tone: "neutral" };
}

function NewDealModal({ venture, onClose, onCreated }: { venture: VentureLite; onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({
    company: "", website: "", industry: "", size: "", location: "",
    contactName: "", contactEmail: "", contactTitle: "", consent: "none",
    value: "", nextAction: "", nextActionDue: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    const r = await fetch("/api/deals", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ventureKey: venture.key,
        company: { name: f.company, website: f.website, industry: f.industry, size: f.size, location: f.location },
        contact: f.contactName ? { name: f.contactName, email: f.contactEmail, title: f.contactTitle, consentBasis: f.consent } : undefined,
        value: f.value || undefined, nextAction: f.nextAction, nextActionDue: f.nextActionDue || null,
      }),
    });
    const j = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) { setErr(j.error ?? "Couldn't create the deal"); return; }
    onCreated(j.deal.id);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="New deal">
      <button aria-label="Close" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <form onSubmit={submit} className="relative w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-[var(--r-lg,16px)] bg-[var(--bg)] border border-white/10 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-[var(--text)]">New {venture.name} deal</h2>
          <button type="button" onClick={onClose} className="p-1.5 text-[var(--text-3)] hover:text-[var(--text)]" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <label className="block"><span className="eyebrow">Company *</span><input required autoFocus className={`${INPUT} mt-1`} value={f.company} onChange={set("company")} placeholder="Acme Foods" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="eyebrow">Website</span><input className={`${INPUT} mt-1`} value={f.website} onChange={set("website")} /></label>
          <label className="block"><span className="eyebrow">Industry</span><input className={`${INPUT} mt-1`} value={f.industry} onChange={set("industry")} /></label>
          <label className="block"><span className="eyebrow">Size (employees)</span><input className={`${INPUT} mt-1`} value={f.size} onChange={set("size")} /></label>
          <label className="block"><span className="eyebrow">Location</span><input className={`${INPUT} mt-1`} value={f.location} onChange={set("location")} placeholder="Halifax, NS" /></label>
        </div>
        <div className="rule" />
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="eyebrow">Contact name</span><input className={`${INPUT} mt-1`} value={f.contactName} onChange={set("contactName")} /></label>
          <label className="block"><span className="eyebrow">Title</span><input className={`${INPUT} mt-1`} value={f.contactTitle} onChange={set("contactTitle")} placeholder="HR Director" /></label>
          <label className="block"><span className="eyebrow">Email</span><input type="email" className={`${INPUT} mt-1`} value={f.contactEmail} onChange={set("contactEmail")} /></label>
          <label className="block"><span className="eyebrow">CASL consent basis</span>
            <select className={`${INPUT} mt-1`} value={f.consent} onChange={set("consent")}>{CONSENT_BASES.map((c) => <option key={c} value={c}>{stageLabel(c)}</option>)}</select>
          </label>
        </div>
        <div className="rule" />
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="eyebrow">{venture.recurring ? "Monthly value (CAD)" : "Value (CAD)"}</span><input className={`${INPUT} mt-1`} inputMode="decimal" value={f.value} onChange={set("value")} placeholder="249" /></label>
          <label className="block"><span className="eyebrow">Next action due</span><input type="date" className={`${INPUT} mt-1`} value={f.nextActionDue} onChange={set("nextActionDue")} /></label>
        </div>
        <label className="block"><span className="eyebrow">Next action</span><input className={`${INPUT} mt-1`} value={f.nextAction} onChange={set("nextAction")} placeholder="Send intro email" /></label>
        {err && <p className="text-[13px] text-[var(--down)]" role="alert">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving || !f.company.trim()}>{saving ? "Creating…" : "Create deal"}</Button>
        </div>
      </form>
    </div>
  );
}

function Board() {
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get("deal");

  const [ventures, setVentures] = useState<VentureLite[] | null>(null);
  const [ventureKey, setVentureKey] = useState<string | null>(null);
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [playbooks, setPlaybooks] = useState<PlaybookLite[]>([]);
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetch("/api/ventures").then((r) => r.json()).then((j) => {
      setVentures(j.ventures); setVentureKey((k) => k ?? j.ventures[0]?.key ?? null);
    }).catch(() => setLoadError(true));
  }, []);

  const venture = ventures?.find((v) => v.key === ventureKey) ?? null;

  const loadDeals = useCallback(async () => {
    if (!ventureKey) return;
    try {
      const r = await fetch(`/api/deals?venture=${encodeURIComponent(ventureKey)}`);
      if (!r.ok) throw new Error();
      setDeals((await r.json()).deals);
    } catch { setLoadError(true); }
  }, [ventureKey]);

  useEffect(() => { setDeals(null); loadDeals(); }, [loadDeals]);
  useEffect(() => {
    if (!ventureKey) return;
    fetch(`/api/playbooks?venture=${encodeURIComponent(ventureKey)}`).then((r) => r.json()).then((j) => setPlaybooks(j.playbooks ?? [])).catch(() => setPlaybooks([]));
  }, [ventureKey]);

  const openDeal = (id: string | null) => router.replace(id ? `/pipeline?deal=${id}` : "/pipeline", { scroll: false });

  async function advance(d: Deal, to: string) {
    setDeals((cur) => cur && cur.map((x) => (x.id === d.id ? { ...x, stage: to } : x))); // optimistic
    const r = await fetch(`/api/deals/${d.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: to }) });
    if (!r.ok) loadDeals();
  }

  if (loadError && !ventures) return <Panel className="p-6"><EmptyState title="Couldn't load the pipeline" hint="Check DATABASE_URL and run `npm run db:push` then `npm run db:seed`." /></Panel>;
  if (!ventures) return <Skeleton className="h-64" />;
  if (ventures.length === 0 || !venture) return <Panel className="p-6"><EmptyState title="No ventures yet" hint="Run `npm run db:seed` to add CandidateHub." /></Panel>;

  const columns = [...venture.stages, venture.wonStage, venture.lostStage];
  const totalOpen = (deals ?? []).filter((d) => d.stage !== venture.wonStage && d.stage !== venture.lostStage).reduce((n, d) => n + d.valueCents, 0);

  return (
    <div className="space-y-6">
      <SectionHeader
        label="Pipeline"
        title={
          ventures.length > 1 ? (
            <span className="inline-flex gap-2">{ventures.map((v) => (
              <button key={v.key} onClick={() => setVentureKey(v.key)} className={v.key === ventureKey ? "text-[var(--text)]" : "text-[var(--text-3)] hover:text-[var(--text-2)]"}>{v.name}</button>
            ))}</span>
          ) : venture.name
        }
        action={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="w-4 h-4" />New deal</Button>}
      />
      <p className="-mt-3 text-[12.5px] text-[var(--text-3)] num">{deals ? `${deals.length} deals · ${fmtMoney(totalOpen)}${venture.recurring ? "/mo" : ""} open` : "Loading…"}</p>

      <div className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1">
        {columns.map((stage, i) => {
          const items = (deals ?? []).filter((d) => d.stage === stage);
          const next = columns[i + 1] && stage !== venture.wonStage && stage !== venture.lostStage ? columns[i + 1] : null;
          return (
            <section key={stage} className="w-[260px] shrink-0" aria-label={stageLabel(stage)}>
              <div className="flex items-center justify-between px-1 pb-2">
                <span className="eyebrow">{stageLabel(stage)}</span>
                <span className="text-[12px] num text-[var(--text-3)]">{items.length}</span>
              </div>
              <div className="space-y-2 min-h-[80px]">
                {deals === null && <Skeleton className="h-20" />}
                {items.map((d) => {
                  const chip = dueChip(d.nextActionDue);
                  return (
                    <div key={d.id} className="panel panel-interactive p-3 group">
                      <button className="block w-full text-left" onClick={() => openDeal(d.id)}>
                        <div className="text-[13.5px] font-medium text-[var(--text)] truncate">{d.company.name}</div>
                        {d.contact && <div className="text-[12px] text-[var(--text-3)] truncate">{d.contact.name}{d.contact.title ? ` · ${d.contact.title}` : ""}</div>}
                        {d.nextAction && <div className="mt-1.5 text-[12px] text-[var(--text-2)] truncate">{d.nextAction}</div>}
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="text-[12px] num text-[var(--text-3)]">{d.valueCents ? fmtMoney(d.valueCents) : "—"}</span>
                          {chip && <Pill tone={chip.tone}>{chip.label}</Pill>}
                        </div>
                      </button>
                      {next && (
                        <button
                          onClick={() => advance(d, next)}
                          className="mt-2 w-full inline-flex items-center justify-center gap-1 rounded-md py-1 text-[11.5px] text-[var(--text-3)] hover:text-[var(--text)] hover:bg-white/5 opacity-70 group-hover:opacity-100"
                          aria-label={`Move ${d.company.name} to ${stageLabel(next)}`}
                        >
                          {stageLabel(next)}<ChevronRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {deals !== null && items.length === 0 && <div className="rounded-[var(--r-md,10px)] border border-dashed border-white/[0.07] py-6 text-center text-[12px] text-[var(--text-3)]">Empty</div>}
              </div>
            </section>
          );
        })}
      </div>

      {creating && <NewDealModal venture={venture} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); loadDeals(); openDeal(id); }} />}
      {openId && <DealDrawer key={openId} dealId={openId} venture={venture} playbooks={playbooks} onClose={() => openDeal(null)} onChanged={loadDeals} />}
    </div>
  );
}

export default function PipelinePage() {
  return <Suspense fallback={<Skeleton className="h-64" />}><Board /></Suspense>;
}
