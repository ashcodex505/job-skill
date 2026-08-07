"use client";

import { AlertTriangle, BellRing, ExternalLink, Plus, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Input, Select, cn } from "@/components/ui";
import { api, formatDate } from "@/lib/client";
import { ANY_COMPANY, matchWatches, type Watch } from "@/lib/career/watchlist";
import type { DiscoveredJob } from "@/lib/app-types";

const CLOCK_TICK_MS = 60_000;
const URGENT_WINDOW_MS = 24 * 60 * 60 * 1000;

const INTERVAL_OPTIONS = [
  { label: "Every 30 min", minutes: 30 },
  { label: "Every hour", minutes: 60 },
  { label: "Every 2 hours", minutes: 120 },
  { label: "Every 4 hours", minutes: 240 },
  { label: "Every 8 hours", minutes: 480 },
  { label: "Every 12 hours", minutes: 720 },
];

interface WatchlistState {
  watches: Watch[];
  companies: string[];
  dirty: boolean;
  syncError?: string | null;
}

interface ScanSettings {
  intervalMinutes: number;
  lastRunAt: string | null;
}

interface WatchScanResult extends ScanSettings {
  ran: boolean;
  reason?: string;
  notify?: { notified: boolean; reason?: string; issueJobCount?: number };
}

/**
 * Dashboard watchlist: the ONLY surface for adding/removing watches
 * (career/watchlist.md is app-managed).
 *
 * Polling only happens here while this panel is mounted (dashboard open).
 * The route scans all supported registry adapters and community feeds even
 * with zero watches, keeping local discovery current and notifying for every
 * newly inserted eligible opportunity. Watch chips filter the panel display.
 */
export function WatchlistPanel() {
  const [state, setState] = useState<WatchlistState | null>(null);
  const [settings, setSettings] = useState<ScanSettings | null>(null);
  const [jobs, setJobs] = useState<DiscoveredJob[]>([]);
  const [company, setCompany] = useState("");
  const [keywords, setKeywords] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  const loadJobs = useCallback(() => {
    api<{ jobs: DiscoveredJob[] }>("/api/jobs")
      .then((d) => setJobs(d.jobs.filter((j) => j.active)))
      .catch(() => {});
  }, []);

  // Load watchlist state once on mount (cheap, no scan involved).
  useEffect(() => {
    api<WatchlistState>("/api/watchlist").then(setState).catch((e) => setError(e.message));
    api<ScanSettings>("/api/scrape/watch").then(setSettings).catch((e) => setError(e.message));
    loadJobs();
  }, [loadJobs]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Full API/feed polling while mounted. The server reads and enforces the
  // same interval, so overlapping tabs or a timer firing early cannot cause
  // extra scrapes.
  const intervalMinutes = settings?.intervalMinutes;
  useEffect(() => {
    if (!intervalMinutes) return;
    const tick = () => {
      api<WatchScanResult>("/api/scrape/watch", { method: "POST" })
        .then((result) => {
          if (result.lastRunAt) {
            setSettings({ intervalMinutes: result.intervalMinutes, lastRunAt: result.lastRunAt });
          }
          if (result.ran && result.notify?.notified) {
            setScanNotice(`Created a local-watch GitHub issue for ${result.notify.issueJobCount ?? 0} new ${result.notify.issueJobCount === 1 ? "opportunity" : "opportunities"}.`);
          } else if (result.ran && result.notify?.reason && !result.notify.reason.startsWith("no new")) {
            setScanNotice(`Scan completed, but GitHub notification was not sent: ${result.notify.reason}`);
          } else if (result.ran) {
            setScanNotice(null);
          }
        })
        .catch((e) => setScanNotice(`Local watch scan failed: ${e.message}`))
        .finally(loadJobs);
    };
    tick();
    const timer = setInterval(tick, intervalMinutes * 60_000);
    return () => clearInterval(timer);
  }, [intervalMinutes, loadJobs]);

  async function changeInterval(minutes: number) {
    setError(null);
    try {
      setSettings(await api<ScanSettings>("/api/scrape/watch", {
        method: "PUT",
        body: JSON.stringify({ intervalMinutes: minutes }),
      }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

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
  const isUrgent = (j: DiscoveredJob) => clock - new Date(j.firstSeenAt).getTime() < URGENT_WINDOW_MS;

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <BellRing size={15} className="text-accent" /> Watchlist
          <span className="text-xs font-normal text-muted">
            all supported API adapters + community repos while this dashboard is open; browser pages excluded
          </span>
        </h2>
        {settings ? (
          <Select
            className="w-36 shrink-0 text-xs"
            value={settings.intervalMinutes}
            onChange={(e) => changeInterval(Number(e.target.value))}
            aria-label="Local watch scan frequency"
          >
            {INTERVAL_OPTIONS.map((option) => (
              <option key={option.minutes} value={option.minutes}>
                {option.label}
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      {settings ? (
        <p className="mb-2 text-xs text-muted">
          {settings.lastRunAt
            ? `Last checked ${new Date(settings.lastRunAt).toLocaleString()}. New eligible opportunities create a GitHub issue labeled local-watch.`
            : "Not run yet this session. New eligible opportunities create a GitHub issue labeled local-watch."}
        </p>
      ) : null}

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
          to filter the roles shown here. The full local scan and <code>local-watch</code> issue alerts still run without a chip.
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
      {scanNotice ? <p className="mb-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950/30">{scanNotice}</p> : null}

      {/* Matches */}
      {state.watches.length > 0 ? (
        matches.length === 0 ? (
          <p className="text-xs text-muted">No open roles match your watches yet. The local-watch issue stream still covers every new eligible opportunity found by this scan.</p>
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
