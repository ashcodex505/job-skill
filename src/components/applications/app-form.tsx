"use client";

import { useEffect, useState } from "react";
import { Button, Field, Input, Modal, Select, TagInput, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/client";
import type { ApplicationRow, ResumeRow } from "@/lib/app-types";
import { JOB_TYPE_LABELS, SEASON_PRESETS, STATUS_LABELS, WORK_MODES } from "@/lib/types";

interface Props {
  onClose: () => void;
  onSaved: (app: ApplicationRow) => void;
  /** Existing application when editing; null for create. */
  application?: ApplicationRow | null;
}

const empty = {
  companyName: "",
  jobTitle: "",
  jobType: "internship",
  season: "Summer 2027",
  location: "",
  workMode: "unknown",
  jobUrl: "",
  portalUrl: "",
  dateApplied: "",
  status: "interested",
  resumeId: "",
  coverLetterId: "",
  notes: "",
  nextActionDate: "",
  nextActionNote: "",
};

/** Mounted only while open — state initializes from the `application` prop. */
export function AppForm({ onClose, onSaved, application }: Props) {
  const [form, setForm] = useState<typeof empty>(() =>
    application
      ? {
          companyName: application.companyName,
          jobTitle: application.jobTitle,
          jobType: application.jobType,
          season: application.season ?? "",
          location: application.location ?? "",
          workMode: application.workMode,
          jobUrl: application.jobUrl ?? "",
          portalUrl: application.portalUrl ?? "",
          dateApplied: application.dateApplied ?? "",
          status: application.status,
          resumeId: application.resumeId ?? "",
          coverLetterId: application.coverLetterId ?? "",
          notes: application.notes ?? "",
          nextActionDate: application.nextActionDate ?? "",
          nextActionNote: application.nextActionNote ?? "",
        }
      : empty,
  );
  const [tags, setTags] = useState<string[]>(() => application?.tags ?? []);
  const [resumes, setResumes] = useState<ResumeRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ResumeRow[]>("/api/resumes").then((r) => setResumes(r.filter((x) => !x.archived)));
  }, []);

  const set = (key: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        ...form,
        resumeId: form.resumeId || null,
        coverLetterId: form.coverLetterId || null,
        tags,
      };
      const saved = application
        ? await api<ApplicationRow>(`/api/applications/${application.id}`, {
            method: "PATCH",
            // Status edits go through the quick-status flow to keep the timeline.
            body: JSON.stringify({ ...body, status: undefined }),
          })
        : await api<ApplicationRow>("/api/applications", { method: "POST", body: JSON.stringify(body) });
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.details?.length ? err.details.join("; ") : (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={application ? "Edit application" : "Add application"} wide>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Company *">
          <Input value={form.companyName} onChange={set("companyName")} placeholder="Stripe" autoFocus />
        </Field>
        <Field label="Job title *">
          <Input value={form.jobTitle} onChange={set("jobTitle")} placeholder="Software Engineer Intern" />
        </Field>
        <Field label="Job type">
          <Select value={form.jobType} onChange={set("jobType")} className="w-full">
            {Object.entries(JOB_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </Field>
        <Field label="Season / cycle">
          <Input value={form.season} onChange={set("season")} placeholder="Summer 2027" list="season-presets" />
          <datalist id="season-presets">
            {SEASON_PRESETS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="Location">
          <Input value={form.location} onChange={set("location")} placeholder="San Francisco, CA" />
        </Field>
        <Field label="Work mode">
          <Select value={form.workMode} onChange={set("workMode")} className="w-full">
            {WORK_MODES.map((m) => (
              <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Job posting URL">
          <Input value={form.jobUrl} onChange={set("jobUrl")} placeholder="https://..." type="url" />
        </Field>
        <Field label="Application portal URL">
          <Input value={form.portalUrl} onChange={set("portalUrl")} placeholder="https://..." type="url" />
        </Field>
        <Field label="Date applied">
          <Input value={form.dateApplied} onChange={set("dateApplied")} type="date" />
        </Field>
        {!application ? (
          <Field label="Initial status">
            <Select value={form.status} onChange={set("status")} className="w-full">
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
        ) : (
          <div />
        )}
        <Field label="Resume used">
          <Select value={form.resumeId} onChange={set("resumeId")} className="w-full">
            <option value="">— none —</option>
            {resumes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.versionLabel})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cover letter (optional)">
          <Select value={form.coverLetterId} onChange={set("coverLetterId")} className="w-full">
            <option value="">— none —</option>
            {resumes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.versionLabel})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Next action date">
          <Input value={form.nextActionDate} onChange={set("nextActionDate")} type="date" />
        </Field>
        <Field label="Next action note">
          <Input value={form.nextActionNote} onChange={set("nextActionNote")} placeholder="Follow up with recruiter" />
        </Field>
        <div className="col-span-2">
          <Field label="Tags">
            <TagInput value={tags} onChange={setTags} />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Notes">
            <Textarea value={form.notes} onChange={set("notes")} rows={3} placeholder="Referral, salary notes, anything." />
          </Field>
        </div>
      </div>
      {error ? <p className="mt-3 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={saving || !form.companyName.trim() || !form.jobTitle.trim()}>
          {saving ? "Saving…" : application ? "Save changes" : "Add application"}
        </Button>
      </div>
    </Modal>
  );
}
