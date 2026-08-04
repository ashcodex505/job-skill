"use client";

import { AlertTriangle, AppWindow, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { api } from "@/lib/client";

// Options for the interval dropdown — server-side clamps to [5, 1440] min
// regardless (see browser-scan-settings.ts), this is just what's offered.
const INTERVAL_OPTIONS = [
  { label: "Every 15 min", minutes: 15 },
  { label: "Every 30 min", minutes: 30 },
  { label: "Every hour", minutes: 60 },
  { label: "Every 2 hours", minutes: 120 },
  { label: "Every 4 hours", minutes: 240 },
];

interface BrowserCompanyEntry {
  name: string;
  careersUrl: string;
}

interface BrowserState {
  companies: BrowserCompanyEntry[];
  dirty: boolean;
  syncError?: string | null;
}

interface ScanSettings {
  intervalMinutes: number;
  lastRunAt: string | null;
}

/**
 * Dashboard browser-scan panel: the ONLY surface for adding/removing local
 * headless-browser scan targets (career/browser-companies.md is
 * app-managed). See docs/browser-scraping.md for the full design.
 *
 * This is for companies with NO public API at all (Google, Apple, Meta,
 * and similar) — a fundamentally different, heavier mechanism than the
 * Priority companies panel above it, which only speeds up existing JSON
 * adapters. Scanning happens ONLY while this dashboard is open, ONLY on
 * this machine — never in CI, never on a schedule you're not present for.
 */
export function BrowserScanPanel() {
  const [state, setState] = useState<BrowserState | null>(null);
  const [settings, setSettings] = useState<ScanSettings | null>(null);
  const [name, setName] = useState("");
  const [careersUrl, setCareersUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<BrowserState>("/api/browser-companies").then(setState).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    api<ScanSettings>("/api/scrape/browser").then(setSettings).catch((e) => setError(e.message));
  }, []);

  // Re-arms the poll timer whenever the configured interval changes —
  // including the moment it's first loaded from the server, so this never
  // races the hardcoded default it used to have. Deliberately keyed only on
  // intervalMinutes, not the whole settings object (e.g. a lastRunAt update
  // from this very effect's own tick() must never restart its own timer).
  const intervalMinutes = settings?.intervalMinutes;
  useEffect(() => {
    if (!intervalMinutes) return;
    const tick = () => api("/api/scrape/browser", { method: "POST" }).catch(() => {});
    tick();
    const timer = setInterval(tick, intervalMinutes * 60_000);
    return () => clearInterval(timer);
  }, [intervalMinutes]);

  async function changeInterval(minutes: number) {
    setError(null);
    try {
      setSettings(await api<ScanSettings>("/api/scrape/browser", { method: "PUT", body: JSON.stringify({ intervalMinutes: minutes }) }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function add() {
    if (!name.trim() || !careersUrl.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setState(await api<BrowserState>("/api/browser-companies", { method: "POST", body: JSON.stringify({ name, careersUrl }) }));
      setName("");
      setCareersUrl("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(target: string) {
    setError(null);
    try {
      setState(await api<BrowserState>("/api/browser-companies", { method: "DELETE", body: JSON.stringify({ name: target }) }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!state) return null;

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <AppWindow size={15} className="text-accent" /> Browser scan
          <span className="text-xs font-normal text-muted">
            local-only, this machine, only while this dashboard is open — never in CI
          </span>
        </h2>
        {settings ? (
          <Select
            className="w-36 shrink-0 text-xs"
            value={settings.intervalMinutes}
            onChange={(e) => changeInterval(Number(e.target.value))}
            aria-label="Browser scan check frequency"
          >
            {INTERVAL_OPTIONS.map((o) => (
              <option key={o.minutes} value={o.minutes}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      {settings ? (
        <p className="mb-2 text-xs text-muted">
          {settings.lastRunAt ? `Last checked ${new Date(settings.lastRunAt).toLocaleString()}` : "Not run yet this session."}
        </p>
      ) : null}

      {state.syncError ? (
        <p className="mb-2 flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950/30">
          <AlertTriangle size={13} /> {state.syncError}
        </p>
      ) : state.dirty ? (
        <p className="mb-2 flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950/30">
          <AlertTriangle size={13} /> Not yet on GitHub — add/remove a company to auto-sync, or commit &amp; push career/browser-companies.md manually.
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company, e.g. Google" className="max-w-40" />
        <Input
          value={careersUrl}
          onChange={(e) => setCareersUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && add()}
          placeholder="Careers page URL"
          className="max-w-96"
        />
        <Button variant="primary" size="sm" onClick={add} disabled={busy || !name.trim() || !careersUrl.trim()}>
          <Plus size={13} /> Add
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {state.companies.map((c) => (
          <span key={c.name} title={c.careersUrl}>
            <Badge className="bg-accent-soft">
              <strong>{c.name}</strong>
              <button
                className="ml-1 cursor-pointer text-muted hover:text-red-500"
                onClick={() => remove(c.name)}
                aria-label={`Remove ${c.name} from browser scan`}
              >
                <X size={11} />
              </button>
            </Badge>
          </span>
        ))}
      </div>

      {state.companies.length === 0 ? (
        <p className="mt-2 text-xs text-muted">
          For companies with no public API at all — everything else already gets scraped through a real API, which is faster and
          more reliable. A generic page reader, not per-company rules — some pages (search-driven portals like Microsoft&apos;s) won&apos;t
          yield results this way. See docs/browser-scraping.md.
        </p>
      ) : null}

      {error ? <p className="mt-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40">{error}</p> : null}
    </Card>
  );
}
