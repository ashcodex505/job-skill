"use client";

import { FileText, FileUp, KeyRound, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { api } from "@/lib/client";
import type { ResumeRow } from "@/lib/app-types";

interface Props {
  applicationId: string;
  companyName: string;
  jobTitle: string;
  /** Skip the credential section (it already exists). */
  hasCredential?: boolean;
  /** Skip the resume section (one is already linked). */
  hasResume?: boolean;
  onClose: () => void;
  onDone: () => void;
}

/**
 * The "you just applied" prompt: capture which resume version went out and
 * the login you used, while it's fresh. Every field is optional — Skip
 * closes without writing anything.
 */
export function PostApplyModal({ applicationId, companyName, jobTitle, hasCredential, hasResume, onClose, onDone }: Props) {
  const [resumes, setResumes] = useState<ResumeRow[]>([]);
  const [resumeId, setResumeId] = useState("");
  const [uploadName, setUploadName] = useState("");
  const [fileChosen, setFileChosen] = useState(false);
  const [cred, setCred] = useState({ email: "", username: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<ResumeRow[]>("/api/resumes").then((r) => setResumes(r.filter((x) => !x.archived)));
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // 1. Resume: link an existing version, or upload the file as a new one.
      let linkedResumeId = resumeId;
      const file = fileRef.current?.files?.[0];
      if (!hasResume && file) {
        const fd = new FormData();
        fd.append(
          "meta",
          JSON.stringify({
            name: uploadName.trim() || `${companyName} — ${jobTitle}`.slice(0, 190),
            versionLabel: new Date().toISOString().slice(0, 10),
            tags: ["submitted"],
          }),
        );
        fd.append("file", file);
        const created = await api<ResumeRow>("/api/resumes", { method: "POST", body: fd });
        linkedResumeId = created.id;
      }
      if (!hasResume && linkedResumeId) {
        await api(`/api/applications/${applicationId}`, {
          method: "PATCH",
          body: JSON.stringify({ resumeId: linkedResumeId }),
        });
      }

      // 2. Credential (encrypted before it touches disk).
      if (!hasCredential && (cred.email || cred.username || cred.password)) {
        await api(`/api/applications/${applicationId}/credential`, {
          method: "PUT",
          body: JSON.stringify({
            email: cred.email || null,
            username: cred.username || null,
            password: cred.password || null,
          }),
        });
      }

      onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const hasAnything =
    (!hasResume && (resumeId || fileChosen)) ||
    (!hasCredential && (cred.email || cred.username || cred.password));

  return (
    <Modal open onClose={onClose} title={`Applied to ${companyName} 🎉 — save the details?`}>
      <div className="space-y-4">
        <p className="text-xs text-muted">
          {jobTitle} · capture what you submitted while it&apos;s fresh. Everything is optional.
        </p>

        {!hasResume ? (
          <section className="space-y-2 rounded-md border border-border p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
              <FileText size={12} /> Resume you applied with
            </p>
            <Field label="Pick an existing version">
              <Select value={resumeId} onChange={(e) => setResumeId(e.target.value)} className="w-full" disabled={fileChosen}>
                <option value="">— select —</option>
                {resumes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.versionLabel})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="…or upload the exact file you submitted">
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted hover:border-accent">
                <FileUp size={14} />
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.doc,.docx"
                  onChange={(e) => {
                    setFileChosen(Boolean(e.target.files?.length));
                    setResumeId("");
                  }}
                />
              </label>
            </Field>
            {fileChosen ? (
              <Field label="Name for this resume version">
                <Input value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder={`${companyName} — ${jobTitle}`} />
              </Field>
            ) : null}
          </section>
        ) : null}

        {!hasCredential ? (
          <section className="space-y-2 rounded-md border border-border p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
              <KeyRound size={12} /> Login you used (encrypted, local-only)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Email">
                <Input value={cred.email} onChange={(e) => setCred({ ...cred, email: e.target.value })} placeholder="akurse@asu.edu" />
              </Field>
              <Field label="Username (if different)">
                <Input value={cred.username} onChange={(e) => setCred({ ...cred, username: e.target.value })} />
              </Field>
              <div className="col-span-2">
                <Field label="Password">
                  <Input type="password" value={cred.password} onChange={(e) => setCred({ ...cred, password: e.target.value })} autoComplete="new-password" />
                </Field>
              </div>
            </div>
          </section>
        ) : null}

        {error ? <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Skip for now</Button>
          <Button variant="primary" onClick={save} disabled={busy || !hasAnything}>
            <Lock size={13} /> {busy ? "Saving…" : "Save details"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
