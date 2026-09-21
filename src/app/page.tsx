"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Kanban, ShieldCheck, TrendingUp, Wallet } from "lucide-react";
import { MetricCard } from "@/components/ui/metric-card";
import { EmptyState, Eyebrow, Panel, Pill, SectionHeader, Skeleton, rise } from "@/components/ui/kit";
import { HermesBriefing } from "@/components/hermes-briefing";
import { ApprovalInbox } from "@/components/approval-inbox";
import { fmtMoney, stageLabel, type DueBucket, type VentureSummary } from "@/lib/crm";

interface TodayVenture {
  key: string;
  name: string;
  stages: string[];
  wonStage: string;
  lostStage: string;
  recurring: boolean;
  summary: VentureSummary;
}
interface DueDeal {
  id: string;
  ventureKey: string;
  title: string;
  company: string;
  contact: string | null;
  stage: string;
  nextAction: string | null;
  nextActionDue: string;
  bucket: DueBucket;
}
interface Today {
  ventures: TodayVenture[];
  mrrCents: number;
  openPipelineCents: number;
  dueCount: number;
  due: DueDeal[];
  pendingApprovals: number;
}

const BUCKET_TONE: Record<string, "down" | "warn" | "neutral"> = { overdue: "down", today: "warn", soon: "neutral" };
const BUCKET_LABEL: Record<string, string> = { overdue: "Overdue", today: "Today", soon: "Soon" };

export default function Home() {
  const [data, setData] = useState<Today | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/today");
      if (!r.ok) throw new Error(String(r.status));
      setData(await r.json());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const loaded = data !== null;
  // Whole dollars on the tiles: the count-up animation passes through fractional cents.
  const money = (n: number) => fmtMoney(Math.round(n / 100) * 100);

  return (
    <div className="space-y-8">
      <div className="hq-rise" style={rise(0)}>
        <Eyebrow>{new Date().toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })}</Eyebrow>
        <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.02em] text-[var(--text)]">Today</h1>
      </div>

      {error && !data && (
        <Panel className="p-6">
          <EmptyState
            title="Couldn't load your dashboard"
            hint="Check DATABASE_URL and that you've run `npm run db:push` and `npm run db:seed`."
          />
        </Panel>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="hq-rise" style={rise(1)}>
          <MetricCard label="MRR" value={data?.mrrCents ?? 0} format={money} loaded={loaded} accent="#34d399" icon={<Wallet className="w-4 h-4" />} deltaLabel="Won recurring deals" />
        </div>
        <div className="hq-rise" style={rise(2)}>
          <MetricCard label="Open pipeline" value={data?.openPipelineCents ?? 0} format={money} loaded={loaded} accent="#6ea8fe" icon={<TrendingUp className="w-4 h-4" />} href="/pipeline" deltaLabel="Across all ventures" />
        </div>
        <div className="hq-rise" style={rise(3)}>
          <MetricCard label="Follow-ups due" value={data?.dueCount ?? 0} loaded={loaded} accent="#fbbf24" icon={<CalendarClock className="w-4 h-4" />} href="/pipeline" deltaLabel="Overdue, today, next 2 days" />
        </div>
        <div className="hq-rise" style={rise(4)}>
          <MetricCard label="Awaiting approval" value={data?.pendingApprovals ?? 0} loaded={loaded} accent="#f472b6" icon={<ShieldCheck className="w-4 h-4" />} href="/hermes" deltaLabel="Hermes is waiting on you" />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 items-start">
        <div className="xl:col-span-3 space-y-6">
          <section className="hq-rise" style={rise(5)}>
            <SectionHeader label="Next actions" title="Follow-ups that need you" />
            <Panel className="p-2">
              {!loaded ? (
                <div className="p-4 space-y-3"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
              ) : data.due.length === 0 ? (
                <EmptyState icon={<CalendarClock className="w-6 h-6" />} title="Nothing due" hint="Give each deal a next action and date on the pipeline board and it will show up here." action={<Link href="/pipeline" className="btn-ghost px-4 py-2 text-[13px]">Open pipeline</Link>} />
              ) : (
                <ul className="divide-y divide-[var(--hairline,rgba(255,255,255,0.06))]">
                  {data.due.map((d) => (
                    <li key={d.id}>
                      <Link href={`/pipeline?deal=${d.id}`} className="flex items-center justify-between gap-4 rounded-[var(--r-md,10px)] px-4 py-3 hover:bg-white/[0.03] transition-colors">
                        <div className="min-w-0">
                          <div className="text-[14px] font-medium text-[var(--text)] truncate">{d.company}{d.contact ? <span className="text-[var(--text-3)] font-normal"> · {d.contact}</span> : null}</div>
                          <div className="text-[12.5px] text-[var(--text-3)] truncate">{d.nextAction || "No action set"} · {stageLabel(d.stage)}</div>
                        </div>
                        <Pill tone={BUCKET_TONE[d.bucket] ?? "neutral"}>{BUCKET_LABEL[d.bucket] ?? d.bucket}</Pill>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </section>

          <section className="hq-rise" style={rise(6)}>
            <SectionHeader label="Ventures" title="Pipeline by stage" action={<Link href="/pipeline" className="text-[12.5px] text-[var(--text-3)] hover:text-[var(--text)]">Open board →</Link>} />
            {!loaded ? (
              <Skeleton className="h-32" />
            ) : data.ventures.length === 0 ? (
              <Panel className="p-6"><EmptyState icon={<Kanban className="w-6 h-6" />} title="No ventures yet" hint="Run `npm run db:seed` to add CandidateHub, or insert a Venture row for your own stream." /></Panel>
            ) : (
              <div className="space-y-4">
                {data.ventures.map((v) => (
                  <Panel key={v.key} className="p-5">
                    <div className="flex items-baseline justify-between gap-4">
                      <h3 className="text-[15px] font-semibold text-[var(--text)]">{v.name}</h3>
                      <div className="text-[12.5px] text-[var(--text-3)] num">
                        {v.summary.openDeals} open · {fmtMoney(v.summary.openValueCents)}{v.recurring ? "/mo" : ""} · {v.summary.wonDeals} won
                      </div>
                    </div>
                    <div className="mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${v.stages.length}, minmax(0, 1fr))` }}>
                      {v.stages.map((s) => (
                        <div key={s} className="min-w-0">
                          <div className="text-[22px] font-semibold num text-[var(--text)]">{v.summary.counts[s] ?? 0}</div>
                          <div className="eyebrow truncate" title={stageLabel(s)}>{stageLabel(s)}</div>
                        </div>
                      ))}
                    </div>
                  </Panel>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="xl:col-span-2 space-y-6">
          <div className="hq-rise" style={rise(7)}><HermesBriefing /></div>
          <div className="hq-rise" style={rise(8)}><ApprovalInbox compact /></div>
        </div>
      </div>
    </div>
  );
}
