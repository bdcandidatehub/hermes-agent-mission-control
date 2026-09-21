"use client";

/* CSV prospect import: pick a file (or paste), preview exactly what would happen, then confirm.
   The preview is a server-side dry run, so what you see is what the import will do. */

import { useEffect, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/kit";
import { INPUT, type VentureLite } from "@/components/deal-drawer";
import { CONSENT_BASES, stageLabel } from "@/lib/crm";

interface Result {
  dryRun: boolean; rows: number; stage: string; unknownColumns: string[];
  companiesCreated: number; contactsCreated: number; dealsCreated: number;
  skipped: { line: number; company: string; reason: string }[]; skippedCount: number;
  errors: { line: number; error: string }[]; errorCount: number;
}

const TEMPLATE =
  "Company,Website,Industry,Employees,Location,First Name,Last Name,Job Title,Email,Consent,Notes\n" +
  'Acme Foods,acmefoods.ca,Food manufacturing,200,"Halifax, NS",Jo,Tremblay,HR Director,jo@acmefoods.ca,,Hiring 12 line staff\n';

export function ImportModal({ venture, onClose, onImported }: { venture: VentureLite; onClose: () => void; onImported: () => void }) {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [consent, setConsent] = useState("none");
  const [preview, setPreview] = useState<Result | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  async function call(dryRun: boolean): Promise<Result | null> {
    const r = await fetch("/api/import/prospects", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ventureKey: venture.key, csv, dryRun, defaultConsent: consent }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error ?? "Import failed"); return null; }
    return j as Result;
  }

  // dry-run preview whenever the data or default consent changes (debounced; stale responses are ignored)
  useEffect(() => {
    setPreview(null); setErr(null);
    if (!csv.trim()) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const res = await call(true);
      if (mine === seq.current && res) setPreview(res);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csv, consent]);

  async function confirm() {
    setBusy(true); setErr(null);
    const res = await call(false);
    setBusy(false);
    if (res) { setDone(res); onImported(); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Import prospects">
      <button aria-label="Close" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-[600px] max-h-[90vh] overflow-y-auto rounded-[var(--r-lg,16px)] bg-[var(--bg)] border border-white/10 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-[var(--text)]">Import prospects into {venture.name}</h2>
          <button onClick={onClose} className="p-1.5 text-[var(--text-3)] hover:text-[var(--text)]" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        {done ? (
          <>
            <p className="text-[14px] text-[var(--text)]">
              Imported <b>{done.dealsCreated}</b> {done.dealsCreated === 1 ? "deal" : "deals"} into {stageLabel(done.stage)}
              {" "}({done.companiesCreated} new {done.companiesCreated === 1 ? "company" : "companies"}, {done.contactsCreated} new {done.contactsCreated === 1 ? "contact" : "contacts"}).
            </p>
            {(done.skippedCount > 0 || done.errorCount > 0) && <p className="text-[12.5px] text-[var(--text-3)]">{done.skippedCount} skipped, {done.errorCount} rows had errors.</p>}
            <div className="flex justify-end"><Button variant="primary" onClick={onClose}>Done</Button></div>
          </>
        ) : (
          <>
            <p className="text-[12.5px] text-[var(--text-3)]">
              A CSV or spreadsheet export with a <b>Company</b> column. Optional: Website, Industry, Employees, Location, First/Last Name, Job Title, Email, Consent, Notes.
              Re-importing the same file is safe: existing companies, contacts and deals are matched, not duplicated.{" "}
              <a className="underline hover:text-[var(--text)]" download="prospects-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}>Download a template</a>.
            </p>

            <label className="flex items-center justify-center gap-2 rounded-[var(--r-md,10px)] border border-dashed border-white/15 py-5 text-[13px] text-[var(--text-2)] cursor-pointer hover:bg-white/[0.03]">
              <Upload className="w-4 h-4" />{fileName ?? "Choose a .csv file"}
              <input
                type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only"
                onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setFileName(f.name); setCsv(await f.text()); } }}
              />
            </label>
            <textarea className={`${INPUT} min-h-[90px] font-mono text-[12px]`} placeholder="…or paste rows here (header row first)" value={csv} onChange={(e) => { setCsv(e.target.value); setFileName(null); }} aria-label="CSV contents" />

            <label className="block">
              <span className="eyebrow">Consent basis for contacts without a Consent column</span>
              <select className={`${INPUT} mt-1`} value={consent} onChange={(e) => setConsent(e.target.value)}>
                {CONSENT_BASES.map((c) => <option key={c} value={c}>{stageLabel(c)}</option>)}
              </select>
              <span className="mt-1 block text-[11.5px] text-[var(--text-3)]">
                &quot;None&quot; is the safe default. Only choose &quot;Implied conspicuous&quot; if the addresses are publicly published and your message is relevant to their role (CASL).
              </span>
            </label>

            {err && <p className="text-[13px] text-[var(--down)]" role="alert">{err}</p>}

            {preview && (
              <div className="rounded-[var(--r-md,10px)] border border-white/[0.08] p-4 space-y-3" aria-live="polite">
                <p className="text-[14px] text-[var(--text)]">
                  Will create <b>{preview.dealsCreated}</b> {preview.dealsCreated === 1 ? "deal" : "deals"} in {stageLabel(preview.stage)}
                  <span className="text-[var(--text-3)]"> · {preview.companiesCreated} new companies · {preview.contactsCreated} new contacts · {preview.rows} rows read</span>
                </p>
                {preview.unknownColumns.length > 0 && <p className="text-[12px] text-[var(--text-3)]">Ignored columns: {preview.unknownColumns.join(", ")}</p>}
                {preview.skippedCount > 0 && (
                  <details className="text-[12px] text-[var(--text-3)]">
                    <summary className="cursor-pointer">{preview.skippedCount} skipped</summary>
                    <ul className="mt-1 space-y-0.5">{preview.skipped.map((s) => <li key={s.line}>Line {s.line}: {s.company}, {s.reason}</li>)}</ul>
                  </details>
                )}
                {preview.errorCount > 0 && (
                  <details className="text-[12px] text-[var(--warn)]" open>
                    <summary className="cursor-pointer">{preview.errorCount} rows have problems and will be left out</summary>
                    <ul className="mt-1 space-y-0.5">{preview.errors.map((e) => <li key={e.line}>Line {e.line}: {e.error}</li>)}</ul>
                  </details>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" onClick={confirm} disabled={busy || !preview || preview.dealsCreated === 0}>
                {busy ? "Importing…" : preview ? `Import ${preview.dealsCreated} ${preview.dealsCreated === 1 ? "deal" : "deals"}` : "Import"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
