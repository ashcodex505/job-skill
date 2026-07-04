"use client";

import { FileUp, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { api } from "@/lib/client";

interface ImportSummary {
  mode: string;
  totalRows: number;
  skippedRows: number;
  created: number;
  updated: number;
  unchanged: number;
  preview: { companyName: string; jobTitle: string; status: string; action: string }[];
}

/**
 * Simplify.jobs CSV import. Flow: pick the CSV exported from your Simplify
 * tracker → preview what would change → commit. Safe to re-run after every
 * application batch; already-tracked rows are skipped or status-advanced.
 */
export function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(mode: "preview" | "commit") {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", mode);
      const result = await api<ImportSummary>("/api/import/simplify", { method: "POST", body: fd });
      setSummary(result);
      if (mode === "commit") {
        onImported();
        onClose();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Import from Simplify" wide>
      <div className="space-y-3">
        <p className="text-xs text-muted">
          Simplify has no public API, so the sync path is its CSV export: open your{" "}
          <a href="https://simplify.jobs/tracker" target="_blank" rel="noreferrer" className="text-accent hover:underline">
            Simplify tracker
          </a>
          , export it as CSV, and drop the file here. Re-import any time — existing applications are matched by posting
          URL or company + title, statuses only ever move forward, and nothing is duplicated. Generic tracker CSVs
          (Sheets/Notion) with company + title columns work too.
        </p>
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted hover:border-accent">
          <FileUp size={14} />
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={() => { setSummary(null); run("preview"); }} />
        </label>

        {error ? <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40">{error}</p> : null}

        {summary ? (
          <div className="space-y-2">
            <p className="text-xs">
              <strong>{summary.totalRows}</strong> rows parsed{summary.skippedRows > 0 ? ` (${summary.skippedRows} incomplete skipped)` : ""} —{" "}
              <span className="text-emerald-600">{summary.created} new</span>,{" "}
              <span className="text-accent">{summary.updated} status updates</span>, {summary.unchanged} already tracked.
            </p>
            <div className="max-h-64 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b border-border bg-surface text-muted">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Company</th>
                    <th className="px-2 py-1.5 font-medium">Role</th>
                    <th className="px-2 py-1.5 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {summary.preview.map((r, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap px-2 py-1">{r.companyName}</td>
                      <td className="max-w-56 truncate px-2 py-1">{r.jobTitle}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-muted">{r.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => run("commit")} disabled={busy || !summary || (summary.created === 0 && summary.updated === 0)}>
            <Upload size={13} /> {busy ? "Importing…" : `Import ${summary ? summary.created + summary.updated : ""} changes`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
