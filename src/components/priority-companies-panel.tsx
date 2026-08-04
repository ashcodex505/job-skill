"use client";

import { AlertTriangle, Plus, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Input } from "@/components/ui";
import { api } from "@/lib/client";

const POLL_MS = 5 * 60 * 1000;

interface PriorityState {
  companies: string[];
  eligibleCompanies: string[];
  dirty: boolean;
  syncError?: string | null;
}

/**
 * Dashboard priority-companies panel: the ONLY surface for adding/removing
 * fast-lane companies (career/priority-companies.md is app-managed).
 *
 * Amazon is always on the 30-min fast lane and is shown as a fixed badge,
 * not something you add/remove here. Adding a company here doesn't change
 * how it's classified or filtered — same score/policy/big-tech rules as
 * everything else — it only changes how often CI checks it. As of this
 * session, career/preferences.md's Summer 2027 approved-companies list
 * also feeds the same fast lane — this panel is for companies you want
 * added WITHOUT putting them through that list's other policy
 * implications (e.g. gating what counts for the Summer 2027 season).
 *
 * Polls the same local live-scan endpoint the Watchlist panel uses (server
 * throttled to ~10 min), so newly-added priority companies get checked
 * while the dashboard is open too, not just from CI every 30 min.
 */
export function PriorityCompaniesPanel() {
  const [state, setState] = useState<PriorityState | null>(null);
  const [company, setCompany] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<PriorityState>("/api/priority-companies").then(setState).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    const tick = () => api("/api/scrape/watch", { method: "POST" }).catch(() => {});
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  async function add() {
    if (!company.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setState(await api<PriorityState>("/api/priority-companies", { method: "POST", body: JSON.stringify({ company }) }));
      setCompany("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(name: string) {
    setError(null);
    try {
      setState(await api<PriorityState>("/api/priority-companies", { method: "DELETE", body: JSON.stringify({ company: name }) }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!state) return null;

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Zap size={15} className="text-accent" /> Priority companies
          <span className="text-xs font-normal text-muted">checked every ~30 min instead of the default 12h — same filters apply</span>
        </h2>
      </div>

      {state.syncError ? (
        <p className="mb-2 flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950/30">
          <AlertTriangle size={13} /> {state.syncError}
        </p>
      ) : state.dirty ? (
        <p className="mb-2 flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950/30">
          <AlertTriangle size={13} /> Not yet on GitHub — add/remove a company to auto-sync, or commit &amp; push career/priority-companies.md manually.
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          list="priority-companies"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && add()}
          placeholder="Company you're expecting a drop from, e.g. Netflix"
          className="max-w-72"
        />
        <datalist id="priority-companies">
          {state.eligibleCompanies
            .filter((c) => c.toLowerCase() !== "amazon" && !state.companies.some((p) => p.toLowerCase() === c.toLowerCase()))
            .map((c) => (
              <option key={c} value={c} />
            ))}
        </datalist>
        <Button variant="primary" size="sm" onClick={add} disabled={busy || !company.trim()}>
          <Plus size={13} /> Add
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span title="Always on the fast lane">
          <Badge className="border-accent bg-accent-soft">
            <strong>Amazon</strong>&nbsp;— always
          </Badge>
        </span>
        {state.companies.map((c) => (
          <Badge key={c} className="bg-accent-soft">
            <strong>{c}</strong>
            <button
              className="ml-1 cursor-pointer text-muted hover:text-red-500"
              onClick={() => remove(c)}
              aria-label={`Remove ${c} from priority companies`}
            >
              <X size={11} />
            </button>
          </Badge>
        ))}
      </div>

      {state.companies.length === 0 ? (
        <p className="mt-2 text-xs text-muted">
          Only companies with a direct adapter can be added (the ones already scraped every 12h — check Job Discovery&apos;s company list).
          Unsupported anti-bot portals (Google, Apple, Meta…) stay on the community-feed watch instead.
        </p>
      ) : null}

      {error ? <p className="mt-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40">{error}</p> : null}
    </Card>
  );
}
