"use client";

import { Check, Copy, Eye, EyeOff, KeyRound, Lock, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { api, ApiError, copySecret, copyText, formatDateTime } from "@/lib/client";
import type { CredentialView } from "@/lib/app-types";

/**
 * Credential UX per the security model:
 * - password hidden until an explicit Reveal click (POST /reveal)
 * - copy clears the clipboard after ~45s
 * - decryption failures surface a clear error without touching stored data
 */
export function CredentialPanel({ applicationId }: { applicationId: string }) {
  const [credential, setCredential] = useState<CredentialView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState<{ password: string | null; secureNotes: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", username: "", password: "", secureNotes: "" });
  const [saving, setSaving] = useState(false);

  // Mounted per-application (inside the drawer), so no reset logic needed.
  useEffect(() => {
    api<CredentialView | null>(`/api/applications/${applicationId}/credential`)
      .then(setCredential)
      .finally(() => setLoaded(true));
  }, [applicationId]);

  function flashCopied(which: string) {
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  }

  async function reveal() {
    setError(null);
    try {
      const data = await api<{ password: string | null; secureNotes: string | null }>(
        `/api/applications/${applicationId}/credential/reveal`,
        { method: "POST" },
      );
      setRevealed(data);
    } catch (err) {
      setError(errMessage(err));
    }
  }

  async function copyPassword() {
    setError(null);
    try {
      const data =
        revealed ??
        (await api<{ password: string | null }>(`/api/applications/${applicationId}/credential/reveal`, {
          method: "POST",
        }));
      if (data.password) {
        await copySecret(data.password);
        flashCopied("password");
      }
    } catch (err) {
      setError(errMessage(err));
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api<CredentialView>(`/api/applications/${applicationId}/credential`, {
        method: "PUT",
        body: JSON.stringify({
          email: form.email || null,
          username: form.username || null,
          password: form.password || null,
          secureNotes: form.secureNotes || null,
        }),
      });
      setCredential(updated);
      setEditing(false);
      setRevealed(null);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Delete the stored credential for this application?")) return;
    await api(`/api/applications/${applicationId}/credential`, { method: "DELETE" });
    setCredential(null);
    setRevealed(null);
  }

  if (!loaded) return null;

  if (editing || !credential) {
    return (
      <div className="space-y-2 rounded-md border border-border p-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
          <KeyRound size={12} /> {credential ? "Update credential" : "Store login credential"}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Email">
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="akurse@asu.edu" />
          </Field>
          <Field label="Username (if different)">
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
          <div className="col-span-2">
            <Field label={credential?.hasPassword ? "New password (leave blank to keep current)" : "Password"}>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Security questions / secure notes (encrypted)">
              <Textarea rows={2} value={form.secureNotes} onChange={(e) => setForm({ ...form, secureNotes: e.target.value })} />
            </Field>
          </div>
        </div>
        {error ? <ErrorNote message={error} /> : null}
        <div className="flex justify-end gap-2">
          {credential ? (
            <Button size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          ) : null}
          <Button size="sm" variant="primary" onClick={save} disabled={saving || (!form.email && !form.username && !form.password)}>
            <Lock size={12} /> {saving ? "Encrypting…" : "Save encrypted"}
          </Button>
        </div>
        <p className="text-[10px] text-muted/70">Encrypted with AES-256-GCM. Stored only in the local database.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
          <KeyRound size={12} /> Login credential
        </p>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setForm({ email: credential.email ?? "", username: credential.username ?? "", password: "", secureNotes: "" });
              setEditing(true);
            }}
            title="Edit credential"
          >
            <Pencil size={12} />
          </Button>
          <Button size="sm" variant="ghost" onClick={remove} title="Delete credential">
            <Trash2 size={12} />
          </Button>
        </div>
      </div>

      <dl className="space-y-1.5 text-sm">
        {credential.email ? (
          <Row label="Email">
            <span className="truncate">{credential.email}</span>
            <IconCopy done={copied === "email"} onClick={() => copyText(credential.email!).then(() => flashCopied("email"))} />
          </Row>
        ) : null}
        {credential.username ? (
          <Row label="Username">
            <span className="truncate">{credential.username}</span>
            <IconCopy done={copied === "username"} onClick={() => copyText(credential.username!).then(() => flashCopied("username"))} />
          </Row>
        ) : null}
        {credential.hasPassword ? (
          <Row label="Password">
            <span className="truncate font-mono text-xs">{revealed?.password ?? "••••••••••••"}</span>
            <button
              className="cursor-pointer text-muted hover:text-foreground"
              onClick={() => (revealed ? setRevealed(null) : reveal())}
              title={revealed ? "Hide" : "Reveal password"}
            >
              {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
            <IconCopy done={copied === "password"} onClick={copyPassword} title="Copy (clipboard clears in 45s)" />
          </Row>
        ) : null}
        {credential.hasSecureNotes ? (
          <Row label="Secure notes">
            {revealed?.secureNotes ? (
              <span className="whitespace-pre-wrap text-xs">{revealed.secureNotes}</span>
            ) : (
              <button className="cursor-pointer text-xs text-accent hover:underline" onClick={reveal}>
                Reveal
              </button>
            )}
          </Row>
        ) : null}
      </dl>

      {error ? <ErrorNote message={error} /> : null}
      <p className="text-[10px] text-muted/70">Last updated {formatDateTime(credential.updatedAt)} · copied passwords auto-clear from the clipboard after 45s</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="w-24 shrink-0 text-xs text-muted">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center gap-2">{children}</dd>
    </div>
  );
}

function IconCopy({ onClick, done, title }: { onClick: () => void; done: boolean; title?: string }) {
  return (
    <button className="cursor-pointer text-muted hover:text-foreground" onClick={onClick} title={title ?? "Copy"}>
      {done ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
    </button>
  );
}

function ErrorNote({ message }: { message: string }) {
  return <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40">{message}</p>;
}

function errMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "VAULT_LOCKED") {
    return "Vault is locked. Unlock it in Settings with your master password.";
  }
  if (err instanceof ApiError && err.code === "DECRYPTION_FAILED") {
    return "Decryption failed — wrong key or master password. The stored data is untouched.";
  }
  return err instanceof Error ? err.message : String(err);
}
