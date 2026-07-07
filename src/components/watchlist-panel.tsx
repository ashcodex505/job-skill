"use client";

import { AlertTriangle, BellRing, ExternalLink, Plus, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Input, cn } from "@/components/ui";
import { api, formatDate } from "@/lib/client";
import { ANY_COMPANY, matchWatches, type Watch } from "@/lib/career/watchlist";
import type { DiscoveredJob } from "@/lib/app-types";

const POLL_MS = 5 * 60 * 1000;
const URGENT_WINDOW_MS = 24 * 60 * 60 * 1000;

interface WatchlistState {
  watches: Watch[];
  companies: string[];
  dirty: boolean;
  syncError?: string | null;
}

/**
 * Dashboard watchlist: the ONLY surface for adding/removing watches
 * (career/watchlist.md is app-managed). Polls /api/jobs every 5 minutes
 * while mounted so a running app surfaces new matches without a manual
 * scrape; roles first seen <24h ago are urgent-styled.
 */
export function WatchlistPanel() {
  const [state, setState] = useState<WatchlistState | null>(null);
  const [jobs, setJobs] = useState<DiscoveredJob[]>([]);
  const [company, setCompany] = useState("");
  const [keywords, setKeywords] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadJobs = useCallback(() => {
    api<{ jobs: DiscoveredJob[] }>("/api/jobs")
      .then((d) => setJobs(d.jobs.filter((j) => j.active)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api<WatchlistState>("/api/watchlist").then(setState).catch((e) => setError(e.message));
    loadJobs();
    // Each tick kicks a server-side watch-scan (scrapes watched companies +
    // the SimplifyJobs feed into the local DB; throttled server-side to
    // ~10 min), then re-reads jobs — so new postings appear while the
    // dashboard sits open, no manual scrape needed.
    const tick = () => {
      api<{ ran: boolean }>("/api/scrape/watch", { method: "POST" })
        .catch(() => {})
        .finally(loadJobs);
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, [loadJobs]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      setState(await api<WatchlistState>("/api/watchlist", {
        method: "POST",
        body: JSON.stringify({ company: company.trim() || ANY_COMPANY, keywords }),
      }));
      setCompany("");
      setKeywords("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(watch: Watch) {
    setError(null);
    try {
      setState(await api<WatchlistState>("/api/watchlist", { method: "DELETE", body: JSON.stringify(watch) }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!state) return null;

  const matches = matchWatches(state.watches, jobs)
    .sort((a, b) => (b.postedAt ?? b.firstSeenAt).localeCompare(a.postedAt ?? a.firstSeenAt))
    .slice(0, 12);
  const isUrgent = (j: DiscoveredJob) => Date.now() - new Date(j.firstSeenAt).getTime() < URGENT_WINDOW_MS;

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <BellRing size={15} className="text-accent" /> Watchlist
          <span className="text-xs font-normal text-muted">roles you want the moment they open · live-scans every ~10 min while this page is open, hourly via CI · auto-syncs to GitHub</span>
        </h2>
      </div>

      {state.syncError ? (
        <p className="mb-2 flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950/30">
          <AlertTriangle size={13} /> {state.syncError}
        </p>
      ) : state.dirty ? (
        <p className="mb-2 flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950/30">
          <AlertTriangle size={13} /> Watchlist not yet on GitHub — add/remove any watch to auto-sync, or commit &amp; push career/watchlist.md manually.
        </p>
      ) : null}

      {/* Add form — the only way watches are created */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          list="watch-companies"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder={`Company (or "${ANY_COMPANY}")`}
          className="max-w-48"
        />
        <datalist id="watch-companies">
          <option value={ANY_COMPANY} />
          {state.companies.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && keywords.trim().length >= 2 && !busy && add()}
          placeholder="keywords, e.g. new grad software engineer"
          className="max-w-72"
        />
        <Button variant="primary" size="sm" onClick={add} disabled={busy || keywords.trim().length < 2}>
          <Plus size={13} /> Watch
        </Button>
      </div>

      {/* Current watches */}
      {state.watches.length === 0 ? (
        <p className="mb-2 text-xs text-muted">
          No watches yet. Add a company (or “{ANY_COMPANY}”) plus keywords — e.g. <em>Google — new grad software engineer</em> —
          and matching roles appear here and trigger 🚨 urgent GitHub alerts the moment the scraper sees them.
        </p>
      ) : (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {state.watches.map((w) => (
            <Badge key={`${w.company}|${w.keywords}`} className="bg-accent-soft">
              <strong>{w.company}</strong>&nbsp;— {w.keywords}
              <button
                className="ml-1 cursor-pointer text-muted hover:text-red-500"
                onClick={() => remove(w)}
                aria-label={`Remove watch ${w.company} ${w.keywords}`}
              >
                <X size={11} />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {error ? <p className="mb-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40">{error}</p> : null}

      {/* Matches */}
      {state.watches.length > 0 ? (
        matches.length === 0 ? (
          <p className="text-xs text-muted">No open roles match your watches yet — you&apos;ll see them here (and get an urgent GitHub notification) as soon as one appears.</p>
        ) : (
          <ul className="divide-y divide-border">
            {matches.map((j) => (
              <li key={j.id} className={cn("flex items-center gap-3 py-1.5", isUrgent(j) && "rounded-md border-l-2 border-red-500 bg-red-50/60 pl-2 dark:bg-red-950/20")}>
                {isUrgent(j) ? <span className="shrink-0 text-[10px] font-bold uppercase text-red-600">urgent</span> : null}
                <div className="min-w-0 flex-1">
                  <a href={j.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-sm font-medium hover:text-accent">
                    {j.company} — {j.title}
                    <ExternalLink size={11} className="shrink-0 text-muted/60" />
                  </a>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted" title={j.postedAt ? "Posted" : "First seen"}>
                  {formatDate(j.postedAt ?? j.firstSeenAt)}
                </span>
                <Link href="/discovery" className="shrink-0 text-xs text-accent hover:underline">
                  view
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </Card>
  );
}
