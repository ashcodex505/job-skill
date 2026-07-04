"use client";

import { Archive, ArchiveRestore, Download, Eye, FileText, FileUp, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Spinner, TagInput, Textarea, cn } from "@/components/ui";
import { api, formatDate } from "@/lib/client";
import type { ResumeRow } from "@/lib/app-types";

const TARGET_ROLES = ["Backend SWE", "Frontend SWE", "Full-stack", "AI/ML", "Systems", "General"];

export default function ResumesPage() {
  const [resumes, setResumes] = useState<ResumeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ResumeRow | null>(null);

  const load = useCallback(() => {
    api<ResumeRow[]>("/api/resumes").then(setResumes).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function toggleArchive(r: ResumeRow) {
    await api(`/api/resumes/${r.id}`, { method: "PATCH", body: JSON.stringify({ archived: !r.archived }) });
    load();
  }

  async function remove(r: ResumeRow) {
    if (!confirm(`Delete "${r.name}" and its file? Applications linked to it will block deletion.`)) return;
    try {
      await api(`/api/resumes/${r.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const visible = (resumes ?? []).filter((r) => showArchived || !r.archived);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Resumes</h1>
          <p className="text-xs text-muted">Every version you submit, so you always know which resume went where.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowArchived((v) => !v)}>
            <Archive size={14} /> {showArchived ? "Hide archived" : "Show archived"}
          </Button>
          <Button variant="primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus size={14} /> Add resume
          </Button>
        </div>
      </div>

      {error ? <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40">{error}</p> : null}

      {!resumes ? (
        <div className="flex h-48 items-center justify-center"><Spinner /></div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<FileText size={28} />}
          title="No resumes yet"
          description="Add your first resume version and upload the PDF."
          action={<Button variant="primary" onClick={() => setFormOpen(true)}><Plus size={14} /> Add resume</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((r) => (
            <Card key={r.id} className={cn("flex flex-col p-4", r.archived && "opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{r.name}</p>
                  <p className="text-xs text-muted">
                    {r.versionLabel}
                    {r.targetRole ? ` · ${r.targetRole}` : ""}
                  </p>
                </div>
                <FileText size={18} className="shrink-0 text-muted/50" />
              </div>
              {r.tags.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.tags.map((t) => (
                    <Badge key={t} className="bg-accent-soft text-[10px]">{t}</Badge>
                  ))}
                </div>
              ) : null}
              {r.notes ? <p className="mt-2 line-clamp-2 text-xs text-muted">{r.notes}</p> : null}
              <p className="mt-2 text-[10px] text-muted/70">
                {r.fileName ? `${r.fileName} · ${r.sizeBytes ? `${Math.round(r.sizeBytes / 1024)} KB · ` : ""}${r.storageDriver}` : "No file uploaded yet"}
                {" · added "}{formatDate(r.createdAt)}
              </p>
              <div className="mt-3 flex items-center gap-1 border-t border-border pt-2">
                {r.storageKey ? (
                  <>
                    <a href={`/api/resumes/${r.id}/file`} target="_blank" rel="noreferrer">
                      <Button size="sm" title="Preview"><Eye size={12} /> Preview</Button>
                    </a>
                    <a href={`/api/resumes/${r.id}/file?download=1`}>
                      <Button size="sm" variant="ghost" title="Download"><Download size={12} /></Button>
                    </a>
                  </>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setFormOpen(true); }}>Edit</Button>
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => toggleArchive(r)} title={r.archived ? "Restore" : "Archive"}>
                    {r.archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(r)} title="Delete">
                    <Trash2 size={12} />
                  </Button>
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {formOpen ? (
        <ResumeForm key={editing?.id ?? "new"} onClose={() => setFormOpen(false)} onSaved={load} resume={editing} />
      ) : null}
    </div>
  );
}

/** Mounted only while open — state initializes from the `resume` prop. */
function ResumeForm({ onClose, onSaved, resume }: { onClose: () => void; onSaved: () => void; resume: ResumeRow | null }) {
  const [form, setForm] = useState(() =>
    resume
      ? { name: resume.name, versionLabel: resume.versionLabel, targetRole: resume.targetRole ?? "", notes: resume.notes ?? "" }
      : { name: "", versionLabel: "v1", targetRole: "", notes: "" },
  );
  const [tags, setTags] = useState<string[]>(() => resume?.tags ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const meta = { ...form, targetRole: form.targetRole || null, notes: form.notes || null, tags };
      const file = fileRef.current?.files?.[0];
      if (resume) {
        await api(`/api/resumes/${resume.id}`, { method: "PATCH", body: JSON.stringify(meta) });
        if (file) {
          const fd = new FormData();
          fd.append("file", file);
          await api(`/api/resumes/${resume.id}`, { method: "PATCH", body: fd });
        }
      } else {
        const fd = new FormData();
        fd.append("meta", JSON.stringify(meta));
        if (file) fd.append("file", file);
        await api("/api/resumes", { method: "POST", body: fd });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={resume ? "Edit resume" : "Add resume"}>
      <div className="space-y-3">
        <Field label="Name *">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ashish Kurse — SWE General" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Version label">
            <Input value={form.versionLabel} onChange={(e) => setForm({ ...form, versionLabel: e.target.value })} placeholder="v2, stripe-tailored…" />
          </Field>
          <Field label="Target role">
            <Input value={form.targetRole} onChange={(e) => setForm({ ...form, targetRole: e.target.value })} list="target-roles" placeholder="Backend SWE" />
            <datalist id="target-roles">
              {TARGET_ROLES.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </Field>
        </div>
        <Field label={resume?.fileName ? `File (replaces ${resume.fileName})` : "File (PDF preferred)"}>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted hover:border-accent">
            <FileUp size={14} />
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" className="text-xs" />
          </label>
        </Field>
        <Field label="Tags">
          <TagInput value={tags} onChange={setTags} />
        </Field>
        <Field label="Notes">
          <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="What's different about this version?" />
        </Field>
        {error ? <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving || !form.name.trim()}>
            {saving ? "Saving…" : resume ? "Save changes" : "Add resume"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
