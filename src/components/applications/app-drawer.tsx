"use client";

import { Download, ExternalLink, FileText, Pencil, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { StatusBadge, StatusSelect } from "@/components/status";
import { Badge, Button, Drawer, Input, Spinner } from "@/components/ui";
import { api, formatDate, formatDateTime } from "@/lib/client";
import type { ApplicationDetail } from "@/lib/app-types";
import { JOB_TYPE_LABELS, STATUS_LABELS, type ApplicationStatus, type JobType } from "@/lib/types";
import { CredentialPanel } from "./credential-panel";

interface Props {
  applicationId: string;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (app: ApplicationDetail) => void;
  onDeleted: () => void;
}

/** Mounted only while open (parent keys it by applicationId). */
export function AppDrawer({ applicationId, onClose, onChanged, onEdit, onDeleted }: Props) {
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [statusNote, setStatusNote] = useState("");
  const [pendingStatus, setPendingStatus] = useState<ApplicationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<ApplicationDetail>(`/api/applications/${applicationId}`)
      .then(setDetail)
      .catch((e) => setError(e.message));
  }, [applicationId]);

  useEffect(load, [load]);

  async function applyStatus() {
    if (!detail || !pendingStatus) return;
    setError(null);
    try {
      await api(`/api/applications/${detail.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status: pendingStatus, note: statusNote || null }),
      });
      setPendingStatus(null);
      setStatusNote("");
      load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove() {
    if (!detail) return;
    if (!confirm(`Delete the application for ${detail.companyName} — ${detail.jobTitle}? This also deletes its status history and stored credential.`)) return;
    await api(`/api/applications/${detail.id}`, { method: "DELETE" });
    onDeleted();
    onClose();
  }

  return (
    <Drawer open onClose={onClose}>
      {!detail ? (
        <div className="flex h-40 items-center justify-center">{error ? <p className="text-sm text-red-600">{error}</p> : <Spinner />}</div>
      ) : (
        <div className="flex min-h-full flex-col">
          <div className="sticky top-0 z-10 border-b border-border bg-surface px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold">{detail.companyName}</h2>
                <p className="truncate text-sm text-muted">{detail.jobTitle}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="sm" onClick={() => onEdit(detail)} title="Edit">
                  <Pencil size={14} />
                </Button>
                <Button variant="ghost" size="sm" onClick={remove} title="Delete">
                  <Trash2 size={14} />
                </Button>
                <Button variant="ghost" size="sm" onClick={onClose} title="Close">
                  <X size={14} />
                </Button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.status} />
              <Badge>{JOB_TYPE_LABELS[detail.jobType as JobType] ?? detail.jobType}</Badge>
              {detail.season ? <Badge>{detail.season}</Badge> : null}
              {detail.workMode !== "unknown" ? <Badge>{detail.workMode}</Badge> : null}
              {detail.tags.map((t) => (
                <Badge key={t} className="bg-accent-soft">{t}</Badge>
              ))}
            </div>
          </div>

          <div className="flex-1 space-y-5 px-5 py-4">
            {/* Quick status update */}
            <section className="rounded-md border border-border p-3">
              <p className="mb-2 text-xs font-semibold text-muted">Update status</p>
              <div className="flex gap-2">
                <StatusSelect value={pendingStatus ?? detail.status} onChange={setPendingStatus} />
                <Input placeholder="Note (optional)" value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
                <Button variant="primary" size="md" onClick={applyStatus} disabled={!pendingStatus || pendingStatus === detail.status}>
                  Update
                </Button>
              </div>
              {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
            </section>

            {/* Facts */}
            <section className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Fact label="Applied" value={formatDate(detail.dateApplied)} />
              <Fact label="Location" value={detail.location ?? "—"} />
              <Fact label="Next action" value={detail.nextActionDate ? `${formatDate(detail.nextActionDate)}${detail.nextActionNote ? ` — ${detail.nextActionNote}` : ""}` : "—"} />
              <Fact label="Last updated" value={formatDateTime(detail.updatedAt)} />
              {detail.jobUrl ? (
                <a href={detail.jobUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent hover:underline">
                  <ExternalLink size={13} /> Job posting
                </a>
              ) : null}
              {detail.portalUrl ? (
                <a href={detail.portalUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent hover:underline">
                  <ExternalLink size={13} /> Application portal
                </a>
              ) : null}
            </section>

            {/* Resume */}
            {detail.resume ? (
              <section className="flex items-center gap-3 rounded-md border border-border p-3">
                <FileText size={16} className="shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {detail.resume.name} <span className="text-muted">({detail.resume.versionLabel})</span>
                  </p>
                  <p className="text-xs text-muted">{detail.resume.targetRole ?? "Resume used for this application"}</p>
                </div>
                {detail.resume.storageKey ? (
                  <div className="flex gap-1">
                    <a href={`/api/resumes/${detail.resume.id}/file`} target="_blank" rel="noreferrer">
                      <Button size="sm">Preview</Button>
                    </a>
                    <a href={`/api/resumes/${detail.resume.id}/file?download=1`}>
                      <Button size="sm" variant="ghost" title="Download">
                        <Download size={13} />
                      </Button>
                    </a>
                  </div>
                ) : (
                  <span className="text-xs text-muted">no file</span>
                )}
              </section>
            ) : null}
            {detail.coverLetter ? (
              <section className="flex items-center gap-3 rounded-md border border-border p-3">
                <FileText size={16} className="shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">Cover letter: {detail.coverLetter.name}</p>
                </div>
                {detail.coverLetter.storageKey ? (
                  <a href={`/api/resumes/${detail.coverLetter.id}/file`} target="_blank" rel="noreferrer">
                    <Button size="sm">Preview</Button>
                  </a>
                ) : null}
              </section>
            ) : null}

            {/* Credentials */}
            <CredentialPanel applicationId={detail.id} />

            {/* Notes */}
            {detail.notes ? (
              <section>
                <p className="mb-1 text-xs font-semibold text-muted">Notes</p>
                <p className="whitespace-pre-wrap rounded-md border border-border p-3 text-sm">{detail.notes}</p>
              </section>
            ) : null}

            {/* Timeline */}
            <section>
              <p className="mb-2 text-xs font-semibold text-muted">Timeline</p>
              <ol className="relative ml-2 space-y-3 border-l border-border pl-4">
                {[...detail.events].reverse().map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-accent" />
                    <div className="flex items-center gap-2">
                      <StatusBadge status={e.toStatus} />
                      {e.fromStatus ? (
                        <span className="text-xs text-muted">from {STATUS_LABELS[e.fromStatus as ApplicationStatus] ?? e.fromStatus}</span>
                      ) : null}
                      <span className="ml-auto text-xs tabular-nums text-muted">{formatDateTime(e.createdAt)}</span>
                    </div>
                    {e.note ? <p className="mt-1 text-xs text-muted">{e.note}</p> : null}
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}
