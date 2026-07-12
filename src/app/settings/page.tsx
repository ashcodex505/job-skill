"use client";

import { CheckCircle2, KeyRound, Lock, ShieldCheck, Unlock, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Field, Input, Spinner } from "@/components/ui";
import { api, formatDateTime } from "@/lib/client";
import type { ScraperRun, VaultStatus } from "@/lib/app-types";

interface CareerConfig {
  skills: string[];
  targetRoles: string[];
  seasons: string[];
  requiredNewGradTitleKeywords: string[];
  internshipSeasons: string[];
  summer2027ApprovedCompanies: string[];
  locations: string[];
  positiveKeywords: string[];
  negativeKeywords: string[];
  claudeAvailable: boolean;
  changedFiles?: string[];
  files: { profile: string; preferences: string };
}

export default function SettingsPage() {
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [runs, setRuns] = useState<ScraperRun[] | null>(null);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [career, setCareer] = useState<CareerConfig | null>(null);

  const load = useCallback(() => {
    api<VaultStatus>("/api/vault").then(setVault).catch(() => setVault(null));
    api<ScraperRun[]>("/api/scrape").then(setRuns).catch(() => setRuns([]));
    api<CareerConfig>("/api/career").then(setCareer).catch(() => setCareer(null));
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
        <h2 className="mb-1 text-sm font-semibold">Career profile (scraper personalization)</h2>
        <p className="mb-3 text-xs text-muted">
          The scraper reads <code className="rounded bg-accent-soft px-1">career/profile.md</code> and{" "}
          <code className="rounded bg-accent-soft px-1">career/preferences.md</code> (career-ops style) on every run:
          your skills are matched against each posting&apos;s description (score boost up to +25), and your target
          roles/seasons/locations and keyword exclusions steer the title filter. Edit the files, then scrape again.
        </p>
        {!career ? (
          <Spinner />
        ) : career.skills.length === 0 && career.targetRoles.length === 0 ? (
          <p className="text-xs text-amber-600">
            No career profile found — create <code>career/profile.md</code> and <code>career/preferences.md</code>{" "}
            (see career/README.md) to personalize scoring.
          </p>
        ) : (
          <div className="space-y-2 text-xs">
            <CareerRow label={`Skills (${career.skills.length})`} items={career.skills} />
            <CareerRow label="Target roles" items={career.targetRoles} />
            <CareerRow label="Seasons" items={career.seasons} />
            <CareerRow label="Required grad labels" items={career.requiredNewGradTitleKeywords} />
            <CareerRow label="Intern seasons" items={career.internshipSeasons} />
            <CareerRow label="Summer ’27 companies" items={career.summer2027ApprovedCompanies} />
            <CareerRow label="Locations" items={career.locations} />
            <CareerRow label="Extra keywords" items={career.positiveKeywords} />
            <CareerRow label="Exclusions" items={career.negativeKeywords} />
          </div>
        )}
        {career ? (
          <div className="mt-3 space-y-2 border-t border-border pt-3">
            <FileViewer name="career/profile.md" content={career.files.profile} />
            <FileViewer name="career/preferences.md" content={career.files.preferences} />
          </div>
        ) : null}
        {career ? <CareerEditor claudeAvailable={career.claudeAvailable} onUpdated={setCareer} /> : null}
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

function FileViewer({ name, content }: { name: string; content: string }) {
  return (
    <details className="group rounded-md border border-border">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted hover:text-foreground">
        <code className="rounded bg-accent-soft px-1">{name}</code>
        <span className="ml-2 text-[10px] text-muted/70">
          {content ? `${content.split("\n").length} lines — click to view` : "file missing"}
        </span>
      </summary>
      {content ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-border px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/90">
          {content}
        </pre>
      ) : (
        <p className="border-t border-border px-3 py-2 text-xs text-amber-600">
          File not found — see career/README.md for the expected format.
        </p>
      )}
    </details>
  );
}

function CareerEditor({ claudeAvailable, onUpdated }: { claudeAvailable: boolean; onUpdated: (c: CareerConfig) => void }) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  if (!claudeAvailable) {
    return (
      <p className="mt-3 border-t border-border pt-3 text-[11px] text-muted/80">
        Tip: install the Claude Code CLI (<code className="rounded bg-accent-soft px-1">npm i -g @anthropic-ai/claude-code</code>)
        to edit these preferences in plain English from here instead of editing the markdown by hand.
      </p>
    );
  }

  async function apply() {
    setBusy(true);
    setNote(null);
    try {
      const updated = await api<CareerConfig>("/api/career", {
        method: "POST",
        body: JSON.stringify({ instruction }),
      });
      onUpdated(updated);
      setInstruction("");
      setNote({ ok: true, text: `Updated ${updated.changedFiles?.join(" and ") ?? "career files"} — next scrape uses the new config.` });
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <p className="text-xs font-medium">Edit in plain English (via your local Claude Code CLI)</p>
      <div className="flex gap-2">
        <Input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && instruction.trim().length >= 3 && !busy && apply()}
          placeholder='e.g. "add Rust and Go to my skills" or "exclude defense companies"'
        />
        <Button variant="primary" onClick={apply} disabled={busy || instruction.trim().length < 3}>
          {busy ? "Thinking…" : "Apply"}
        </Button>
      </div>
      {note ? (
        <p className={`rounded-md border p-2 text-xs ${note.ok ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40" : "border-red-300 bg-red-50 text-red-700 dark:bg-red-950/40"}`}>
          {note.text}
        </p>
      ) : null}
      <p className="text-[10px] text-muted/70">
        Runs <code className="rounded bg-accent-soft px-1">claude -p</code> locally to rewrite career/profile.md and
        career/preferences.md; changes are validated before saving and versioned in git.
      </p>
    </div>
  );
}

function CareerRow({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex gap-2">
      <span className="w-28 shrink-0 pt-0.5 text-muted">{label}</span>
      <span className="flex flex-wrap gap-1">
        {items.map((item) => (
          <Badge key={item} className="bg-accent-soft text-[10px]">{item}</Badge>
        ))}
      </span>
    </div>
  );
}
