"use client";

import { CheckCircle2, KeyRound, Lock, ShieldCheck, Unlock, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Field, Input, Spinner } from "@/components/ui";
import { api, formatDateTime } from "@/lib/client";
import type { ScraperRun, VaultStatus } from "@/lib/app-types";

export default function SettingsPage() {
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [runs, setRuns] = useState<ScraperRun[] | null>(null);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<VaultStatus>("/api/vault").then(setVault).catch(() => setVault(null));
    api<ScraperRun[]>("/api/scrape").then(setRuns).catch(() => setRuns([]));
  }, []);
  useEffect(load, [load]);

  async function unlock() {
    setBusy(true);
    setMessage(null);
    try {
      await api("/api/vault", { method: "POST", body: JSON.stringify({ masterPassword: password }) });
      setPassword("");
      setMessage({ ok: true, text: "Vault unlocked for this session." });
      load();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function lock() {
    await api("/api/vault", { method: "DELETE" });
    setMessage({ ok: true, text: "Vault locked." });
    load();
  }

  async function verifyKeychain() {
    setBusy(true);
    setMessage(null);
    try {
      await api("/api/vault", { method: "PATCH" });
      setMessage({ ok: true, text: "Keychain key verified — encryption and decryption round-trip OK." });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <Card className="p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck size={16} className="text-accent" /> Credential vault
        </h2>
        <p className="mb-3 text-xs text-muted">
          Application passwords are encrypted with AES-256-GCM and stored only in the local SQLite database. They are
          never sent to Supabase, GitHub, or the scraper.
        </p>
        {!vault ? (
          <Spinner />
        ) : vault.mode === "keychain" ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm">
              <KeyRound size={14} className="text-emerald-500" />
              Key mode: <strong>macOS Keychain</strong> — the encryption key lives in your login keychain
              (service <code className="rounded bg-accent-soft px-1 text-xs">resume-tracker</code>). No master password needed.
            </p>
            <Button onClick={verifyKeychain} disabled={busy}>
              <ShieldCheck size={14} /> Verify keychain key
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm">
              {vault.unlocked ? <Unlock size={14} className="text-emerald-500" /> : <Lock size={14} className="text-amber-500" />}
              Key mode: <strong>Master password</strong> (scrypt-derived) — vault is currently{" "}
              <strong>{vault.unlocked ? "unlocked" : "locked"}</strong>.
            </p>
            {vault.unlocked ? (
              <Button onClick={lock}>
                <Lock size={14} /> Lock vault
              </Button>
            ) : (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label="Master password">
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && password.length >= 8 && unlock()}
                      placeholder="At least 8 characters"
                    />
                  </Field>
                </div>
                <Button variant="primary" onClick={unlock} disabled={busy || password.length < 8}>
                  <Unlock size={14} /> Unlock
                </Button>
              </div>
            )}
            <p className="text-[10px] text-muted/70">
              First unlock sets the password. It is never stored — only held in memory while the app runs.
            </p>
          </div>
        )}
        {message ? (
          <p className={`mt-3 flex items-center gap-1.5 rounded-md border p-2 text-xs ${message.ok ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40" : "border-red-300 bg-red-50 text-red-700 dark:bg-red-950/40"}`}>
            {message.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {message.text}
          </p>
        ) : null}
      </Card>

      <Card className="p-4">
        <h2 className="mb-1 text-sm font-semibold">Resume storage</h2>
        <p className="text-xs text-muted">
          Files are stored via the <code className="rounded bg-accent-soft px-1">RESUME_STORAGE_DRIVER</code> in{" "}
          <code className="rounded bg-accent-soft px-1">.env.local</code>: <strong>local</strong> (default,{" "}
          <code className="rounded bg-accent-soft px-1">data/resumes/</code>) or <strong>supabase</strong> (free-tier
          object storage — see README for setup). Credentials never use this storage.
        </p>
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Scraper runs</h2>
        {!runs ? (
          <Spinner />
        ) : runs.length === 0 ? (
          <p className="text-xs text-muted">No runs yet. Trigger one from Job Discovery or run <code className="rounded bg-accent-soft px-1">npm run scrape</code>.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">Started</th>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 pr-3 font-medium">Companies</th>
                <th className="py-1 pr-3 font-medium">Jobs</th>
                <th className="py-1 pr-3 font-medium">New</th>
                <th className="py-1 font-medium">Errors</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-3 tabular-nums">{formatDateTime(r.startedAt)}</td>
                  <td className="py-1.5 pr-3">{r.status}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{r.companiesScanned}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{r.jobsFound}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{r.newJobs}</td>
                  <td className="py-1.5" title={r.errors.map((e) => `${e.company}: ${e.message}`).join("\n")}>
                    {r.errors.length > 0 ? `${r.errors.length} ⚠` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
