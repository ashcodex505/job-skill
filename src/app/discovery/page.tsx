"use client";

import { BookmarkPlus, CheckCircle2, ExternalLink, Radar, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, Input, Select, Spinner, cn } from "@/components/ui";
import { api, formatDate, formatDateTime } from "@/lib/client";
import type { DiscoveredJob, ScraperRun } from "@/lib/app-types";

export default function DiscoveryPage() {
  const [jobs, setJobs] = useState<DiscoveredJob[] | null>(null);
  const [lastRun, setLastRun] = useState<ScraperRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [seasonFilter, setSeasonFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [onlyNew, setOnlyNew] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ jobs: DiscoveredJob[]; lastRun: ScraperRun | null }>("/api/jobs")
      .then((d) => {
        setJobs(d.jobs);
        setLastRun(d.lastRun ? { ...d.lastRun, errors: typeof d.lastRun.errors === "string" ? JSON.parse(d.lastRun.errors as unknown as string) : d.lastRun.errors } : null);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function scrapeNow() {
    setScraping(true);
    setScrapeResult(null);
    setError(null);
    try {
      const res = await api<{ companiesScanned: number; jobsFound: number; newJobs: number; errors: { company: string }[] }>(
        "/api/scrape",
        { method: "POST" },
      );
      setScrapeResult(
        `Scanned ${res.companiesScanned} companies — ${res.jobsFound} relevant roles, ${res.newJobs} new${res.errors.length ? ` (${res.errors.length} companies failed)` : ""}.`,
      );
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScraping(false);
    }
  }

  async function save(job: DiscoveredJob, markApplied: boolean) {
    setSavingId(job.id);
    try {
      await api(`/api/jobs/${job.id}/save`, { method: "POST", body: JSON.stringify({ markApplied }) });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  const companies = useMemo(() => [...new Set((jobs ?? []).map((j) => j.company))].sort(), [jobs]);
  const seasons = useMemo(() => [...new Set((jobs ?? []).map((j) => j.season).filter((s): s is string => Boolean(s)))].sort(), [jobs]);
  const sources = useMemo(() => [...new Set((jobs ?? []).map((j) => j.source))].sort(), [jobs]);

  const filtered = useMemo(() => {
    if (!jobs) return [];
    const q = query.trim().toLowerCase();
    return jobs
      .filter((j) => j.active)
      .filter((j) => {
        if (companyFilter && j.company !== companyFilter) return false;
        if (typeFilter && j.roleType !== typeFilter) return false;
        if (seasonFilter && j.season !== seasonFilter) return false;
        if (sourceFilter && j.source !== sourceFilter) return false;
        if (onlyNew && !j.isNew) return false;
        if (q && !`${j.company} ${j.title} ${j.location ?? ""}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => b.score - a.score || b.firstSeenAt.localeCompare(a.firstSeenAt));
  }, [jobs, query, companyFilter, typeFilter, seasonFilter, sourceFilter, onlyNew]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Job Discovery</h1>
          <p className="text-xs text-muted">
            {lastRun
              ? `Last scrape ${formatDateTime(lastRun.startedAt)} · ${lastRun.companiesScanned} companies · ${lastRun.jobsFound} relevant roles`
              : "SWE new grad + Summer 2027 internships from official ATS APIs"}
          </p>
        </div>
        <Button variant="primary" onClick={scrapeNow} disabled={scraping}>
          <RefreshCw size={14} className={cn(scraping && "animate-spin")} />
          {scraping ? "Scraping… (~1 min)" : "Scrape now"}
        </Button>
      </div>

      {scrapeResult ? <p className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-700 dark:bg-emerald-950/40">{scrapeResult}</p> : null}
      {error ? <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search title, company…" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-56" />
        <Select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All role types</option>
          <option value="internship">Internship</option>
          <option value="new_grad">New Grad</option>
          <option value="unknown">Unclassified</option>
        </Select>
        <Select value={seasonFilter} onChange={(e) => setSeasonFilter(e.target.value)}>
          <option value="">All seasons</option>
          {seasons.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <button
          className={cn(
            "flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs",
            onlyNew ? "border-accent bg-accent-soft font-medium text-accent" : "border-border text-muted",
          )}
          onClick={() => setOnlyNew((v) => !v)}
        >
          <Sparkles size={12} /> New since last scrape
        </button>
        {jobs ? <span className="ml-auto text-xs text-muted">{filtered.length} roles</span> : null}
      </div>

      {!jobs ? (
        <div className="flex h-48 items-center justify-center"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Radar size={28} />}
          title={jobs.length === 0 ? "No discovered jobs yet" : "Nothing matches your filters"}
          description={jobs.length === 0 ? "Run the scraper to pull SWE new grad and Summer 2027 internship roles from 25+ company job boards." : "Try clearing filters."}
          action={jobs.length === 0 ? <Button variant="primary" onClick={scrapeNow} disabled={scraping}><RefreshCw size={14} /> Scrape now</Button> : undefined}
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Season</th>
                <th className="px-3 py-2 font-medium">Location</th>
                <th className="px-3 py-2 font-medium">Match</th>
                <th className="px-3 py-2 font-medium">Found</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((j) => (
                <tr key={j.id} className="hover:bg-accent-soft/40">
                  <td className="whitespace-nowrap px-3 py-2 font-medium">
                    <span className="flex items-center gap-1.5">
                      {j.company}
                      {j.isNew ? <Badge className="border-accent bg-accent-soft text-[10px] text-accent">new</Badge> : null}
                    </span>
                  </td>
                  <td className="max-w-72 px-3 py-2">
                    <a href={j.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-accent">
                      <span className="truncate">{j.title}</span>
                      <ExternalLink size={11} className="shrink-0 text-muted/60" />
                    </a>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">
                    {j.roleType === "new_grad" ? "New Grad" : j.roleType === "internship" ? "Internship" : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{j.season ?? "—"}</td>
                  <td className="max-w-44 truncate px-3 py-2 text-xs text-muted">{j.location ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums text-xs text-muted">
                    <span title={j.matchedSkills.length > 0 ? `Matches your skills: ${j.matchedSkills.join(", ")}` : "No skills from career/profile.md found in this posting"}>
                      {j.score}%
                      {j.matchedSkills.length > 0 ? <span className="ml-1 text-emerald-600">({j.matchedSkills.length} skills)</span> : null}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-muted">{formatDate(j.firstSeenAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {j.savedApplicationId ? (
                      <Link href={`/applications?open=${j.savedApplicationId}`} className="flex items-center gap-1 text-xs text-emerald-600 hover:underline">
                        <CheckCircle2 size={13} /> In tracker
                      </Link>
                    ) : (
                      <span className="flex gap-1">
                        <Button size="sm" onClick={() => save(j, false)} disabled={savingId === j.id} title="Save with status Interested">
                          <BookmarkPlus size={12} /> Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => save(j, true)} disabled={savingId === j.id} title="Save with status Applied">
                          Mark applied
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
