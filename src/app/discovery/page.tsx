"use client";

import { BookmarkPlus, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Radar, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { PostApplyModal } from "@/components/applications/post-apply-modal";
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
  const [hideSaved, setHideSaved] = useState(false);
  const [minMatch, setMinMatch] = useState(0);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [postApply, setPostApply] = useState<{ id: string; companyName: string; jobTitle: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
      const app = await api<{ id: string; companyName: string; jobTitle: string }>(`/api/jobs/${job.id}/save`, {
        method: "POST",
        body: JSON.stringify({ markApplied }),
      });
      load();
      // Just applied → prompt for the resume version + login used, while fresh.
      if (markApplied) setPostApply({ id: app.id, companyName: app.companyName, jobTitle: app.jobTitle });
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
        if (hideSaved && j.savedApplicationId) return false;
        if (j.score < minMatch) return false;
        if (q && !`${j.company} ${j.title} ${j.location ?? ""}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => b.score - a.score || b.firstSeenAt.localeCompare(a.firstSeenAt));
  }, [jobs, query, companyFilter, typeFilter, seasonFilter, sourceFilter, onlyNew, hideSaved, minMatch]);

  function matchTooltip(j: DiscoveredJob): string {
    const b = j.scoreBreakdown;
    if (!b) return j.matchedSkills.length > 0 ? `Matches your skills: ${j.matchedSkills.join(", ")}` : "Scraped before score breakdowns — re-scrape to populate";
    const lines = [
      b.role ? `Engineering role fit +${b.role}` : null,
      b.roleType ? `Intern/new-grad title +${b.roleType}` : null,
      b.season ? `Season${j.season ? ` (${j.season})` : ""} +${b.season}` : null,
      b.location ? `Preferred location +${b.location}` : null,
      b.keywords ? `Preference keywords +${b.keywords}` : null,
      b.skills ? `Your skills in posting +${b.skills} (${j.matchedSkills.join(", ")})` : "No profile skills found in posting",
    ].filter(Boolean);
    return lines.join("\n");
  }

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
        <Select value={String(minMatch)} onChange={(e) => setMinMatch(Number(e.target.value))} title="Minimum match percentage">
          <option value="0">Any match</option>
          <option value="50">50%+ match</option>
          <option value="70">70%+ match</option>
          <option value="85">85%+ match</option>
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
        <button
          className={cn(
            "flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs",
            hideSaved ? "border-accent bg-accent-soft font-medium text-accent" : "border-border text-muted",
          )}
          onClick={() => setHideSaved((v) => !v)}
        >
          Hide saved
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
                <th className="px-3 py-2 font-medium">Posted</th>
                <th className="px-3 py-2 font-medium">Found</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((j) => (
                <Fragment key={j.id}>
                <tr className="hover:bg-accent-soft/40">
                  <td className="whitespace-nowrap px-3 py-2 font-medium">
                    <span className="flex items-center gap-1.5">
                      {j.company}
                      {j.isNew ? <Badge className="border-accent bg-accent-soft text-[10px] text-accent">new</Badge> : null}
                    </span>
                  </td>
                  <td className="max-w-72 px-3 py-2">
                    <span className="flex items-center gap-1">
                      {j.description ? (
                        <button
                          className="shrink-0 cursor-pointer text-muted/60 hover:text-foreground"
                          onClick={() => setExpandedId(expandedId === j.id ? null : j.id)}
                          title="Show job description"
                          aria-label="Toggle job description"
                        >
                          {expandedId === j.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </button>
                      ) : null}
                      <a href={j.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1 hover:text-accent">
                        <span className="truncate">{j.title}</span>
                        <ExternalLink size={11} className="shrink-0 text-muted/60" />
                      </a>
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">
                    {j.roleType === "new_grad" ? "New Grad" : j.roleType === "internship" ? "Internship" : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{j.season ?? "—"}</td>
                  <td className="max-w-44 truncate px-3 py-2 text-xs text-muted">{j.location ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums text-xs text-muted">
                    <span title={matchTooltip(j)} className="cursor-help underline decoration-dotted decoration-border underline-offset-2">
                      {j.score}%
                      {j.matchedSkills.length > 0 ? <span className="ml-1 text-emerald-600">({j.matchedSkills.length} skills)</span> : null}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-muted">
                    <span title={j.postedAt ? "Posting date from the company's ATS" : "Company didn't publish a date — showing when the scraper first saw it"}>
                      {formatDate(j.postedAt ?? j.firstSeenAt)}
                      {!j.postedAt ? <span className="text-muted/50">*</span> : null}
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
                {expandedId === j.id && j.description ? (
                  <tr className="bg-accent-soft/20">
                    <td colSpan={9} className="px-6 py-3">
                      <p className="max-h-56 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted">{j.description}</p>
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {postApply ? (
        <PostApplyModal
          applicationId={postApply.id}
          companyName={postApply.companyName}
          jobTitle={postApply.jobTitle}
          onClose={() => setPostApply(null)}
          onDone={load}
        />
      ) : null}
    </div>
  );
}
