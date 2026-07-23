"use client";

import { AlertTriangle, ArrowRight, Radar } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/status";
import { PriorityCompaniesPanel } from "@/components/priority-companies-panel";
import { WatchlistPanel } from "@/components/watchlist-panel";
import { Card, EmptyState, Spinner, cn } from "@/components/ui";
import { api, formatDate, formatDateTime, relativeDays } from "@/lib/client";
import { STATUS_LABELS } from "@/lib/types";

interface Dashboard {
  totals: {
    total: number;
    applied: number;
    active: number;
    interviews: number;
    offers: number;
    rejections: number;
    interested: number;
    discoveredActive: number;
  };
  byStatus: Record<string, number>;
  nextActions: {
    id: string;
    companyName: string;
    jobTitle: string;
    status: string;
    nextActionDate: string;
    nextActionNote: string | null;
    overdue: boolean;
  }[];
  recent: { id: string; companyName: string; jobTitle: string; status: string; updatedAt: string }[];
  hiddenPriorCycle: number;
  lastRun: { startedAt: string; jobsFound: number; newJobs: number } | null;
}

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Dashboard>("/api/dashboard").then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) {
    return <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  }
  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const { totals } = data;
  const stats = [
    { label: "Total applied", value: totals.applied },
    { label: "Active processes", value: totals.active },
    { label: "In interviews", value: totals.interviews },
    { label: "Offers", value: totals.offers, accent: totals.offers > 0 },
    { label: "Rejections", value: totals.rejections },
    { label: "Watching", value: totals.interested },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-xs text-muted">
            {data.lastRun
              ? `Last scrape ${formatDateTime(data.lastRun.startedAt)} — ${data.lastRun.jobsFound} relevant roles, ${data.lastRun.newJobs} new`
              : "No scrapes yet — run one from Job Discovery"}
            {data.hiddenPriorCycle > 0
              ? ` · ${data.hiddenPriorCycle} prior-cycle application${data.hiddenPriorCycle === 1 ? "" : "s"} hidden (see Applications for all)`
              : ""}
          </p>
        </div>
        <Link href="/discovery" className="flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
          <Radar size={14} />
          {totals.discoveredActive} discovered roles
          <ArrowRight size={12} />
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <WatchlistPanel />
        <PriorityCompaniesPanel />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <Link key={s.label} href="/applications">
            <Card className={cn("px-4 py-3 transition-colors hover:border-accent", s.accent && "border-emerald-400")}>
              <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
              <p className="text-xs text-muted">{s.label}</p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Next actions</h2>
          {data.nextActions.length === 0 ? (
            <EmptyState
              title="No upcoming actions"
              description="Set a next-action date on an application to see it here."
            />
          ) : (
            <ul className="divide-y divide-border">
              {data.nextActions.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  {a.overdue ? <AlertTriangle size={14} className="shrink-0 text-amber-500" /> : null}
                  <div className="min-w-0 flex-1">
                    <Link href={`/applications?open=${a.id}`} className="block truncate font-medium hover:text-accent">
                      {a.companyName} — {a.jobTitle}
                    </Link>
                    {a.nextActionNote ? <p className="truncate text-xs text-muted">{a.nextActionNote}</p> : null}
                  </div>
                  <span className={cn("shrink-0 text-xs tabular-nums", a.overdue ? "font-medium text-amber-600" : "text-muted")}>
                    {formatDate(a.nextActionDate)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Recent activity</h2>
          {data.recent.length === 0 ? (
            <EmptyState
              title="No applications yet"
              description="Add your first application or save one from Job Discovery."
            />
          ) : (
            <ul className="divide-y divide-border">
              {data.recent.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <Link href={`/applications?open=${a.id}`} className="block truncate font-medium hover:text-accent">
                      {a.companyName} — {a.jobTitle}
                    </Link>
                    <p className="text-xs text-muted">{relativeDays(a.updatedAt)}</p>
                  </div>
                  <StatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold">Pipeline</h2>
        <div className="flex flex-wrap gap-2">
          {Object.keys(STATUS_LABELS).map((key) => (
            <div key={key} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
              <StatusBadge status={key} />
              <span className="text-sm font-semibold tabular-nums">{data.byStatus[key] ?? 0}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
