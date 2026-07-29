"use client";

import { AlertTriangle, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { api } from "@/lib/client";

// Local-only weekly check-in while the dashboard is open — the server-side
// throttle in /api/scrape/scout is the real gate (once per 7 days); this
// just needs to tick often enough that leaving the dashboard open for a
// while eventually crosses that threshold, not to BE the schedule itself.
const POLL_MS = 6 * 60 * 60 * 1000; // every 6h

interface ScoutState {
  companies: string[];
  lastRunAt: string | null;
}

/**
 * Dashboard company-scout panel. Weekly local judgment pass (via the
 * already-logged-in Claude Code CLI on this machine, never a GitHub Actions
 * secret) over companies currently showing up in your job feeds that
 * aren't already big-tech-alert-eligible — expands board/scout-companies.json,
 * which big-tech-alert.ts merges into its allowlist automatically. See
 * src/scraper/company-scout.ts for the full design and why this can't run
 * in CI at all.
 */
export function CompanyScoutPanel() {
  const [state, setState] = useState<ScoutState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const refresh = () => api<ScoutState>("/api/scrape/scout").then(setState).catch((e) => setError(e.message));

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const tick = () => api("/api/scrape/scout", { method: "POST" }).catch(() => {});
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  async function runNow() {
    setBusy(true);
    setError(null);
    setLastMessage(null);
    try {
      const result = await api<{ ran: boolean; reason?: string; added?: string[] }>("/api/scrape/scout?force=true", { method: "POST" });
      if (!result.ran) {
        setLastMessage(result.reason ?? "Nothing to do.");
      } else if (result.added?.length) {
        setLastMessage(`Added: ${result.added.join(", ")}`);
      } else {
        setLastMessage("Ran — no new companies met the bar this time.");
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles size={15} className="text-accent" /> Company scout
          <span className="text-xs font-normal text-muted">
            weekly local judgment pass, via your logged-in Claude CLI — never in CI
          </span>
        </h2>
        <Button variant="secondary" size="sm" onClick={runNow} disabled={busy}>
          {busy ? "Running…" : "Run now"}
        </Button>
      </div>

      <p className="mb-2 text-xs text-muted">
        {state.lastRunAt ? `Last ran ${new Date(state.lastRunAt).toLocaleString()}` : "Never run yet — click Run now, or wait for the weekly check."}
      </p>

      {lastMessage ? <p className="mb-2 text-xs text-foreground">{lastMessage}</p> : null}

      <div className="flex flex-wrap gap-1.5">
        {state.companies.map((c) => (
          <Badge key={c} className="bg-accent-soft">
            {c}
          </Badge>
        ))}
      </div>

      {state.companies.length === 0 ? (
        <p className="mt-2 text-xs text-muted">
          No companies added yet. This only ever proposes real companies already posting into your feeds — never invents one — and
          only adds them after you (well, Claude, reasoning about your actual candidates) confirms they're genuinely big-tech/unicorn
          tier.
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40">
          <AlertTriangle size={13} /> {error}
        </p>
      ) : null}
    </Card>
  );
}
