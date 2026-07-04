"use client";

import { Briefcase, Columns3, Import, KeyRound, Plus, Table2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AppDrawer } from "@/components/applications/app-drawer";
import { AppForm } from "@/components/applications/app-form";
import { ImportModal } from "@/components/applications/import-modal";
import { StatusBadge } from "@/components/status";
import { Badge, Button, Card, EmptyState, Input, Select, Spinner, cn } from "@/components/ui";
import { api, formatDate, relativeDays } from "@/lib/client";
import type { ApplicationDetail, ApplicationRow } from "@/lib/app-types";
import { PIPELINE_ORDER } from "@/lib/status";
import { JOB_TYPE_LABELS, STATUS_LABELS } from "@/lib/types";

type SortKey = "updatedAt" | "companyName" | "dateApplied" | "status" | "nextActionDate";

export default function ApplicationsPage() {
  return (
    <Suspense>
      <ApplicationsInner />
    </Suspense>
  );
}

function ApplicationsInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [apps, setApps] = useState<ApplicationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"table" | "kanban">("table");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [seasonFilter, setSeasonFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<ApplicationRow | null>(null);
  const openId = search.get("open");

  const load = useCallback(() => {
    api<ApplicationRow[]>("/api/applications").then(setApps).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const seasons = useMemo(
    () => [...new Set((apps ?? []).map((a) => a.season).filter((s): s is string => Boolean(s)))].sort(),
    [apps],
  );

  const filtered = useMemo(() => {
    if (!apps) return [];
    const q = query.trim().toLowerCase();
    let rows = apps.filter((a) => {
      if (statusFilter && a.status !== statusFilter) return false;
      if (typeFilter && a.jobType !== typeFilter) return false;
      if (seasonFilter && a.season !== seasonFilter) return false;
      if (q) {
        const hay = `${a.companyName} ${a.jobTitle} ${a.location ?? ""} ${a.tags.join(" ")} ${a.notes ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    rows = rows.sort((a, b) => {
      const av = (a[sortKey] ?? "") as string;
      const bv = (b[sortKey] ?? "") as string;
      const cmp = sortKey === "status" ? PIPELINE_ORDER.indexOf(a.status as never) - PIPELINE_ORDER.indexOf(b.status as never) : av.localeCompare(bv);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [apps, query, statusFilter, typeFilter, seasonFilter, sortKey, sortDir]);

  function setSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "companyName" ? "asc" : "desc");
    }
  }

  function openDetail(id: string | null) {
    const params = new URLSearchParams(search.toString());
    if (id) params.set("open", id);
    else params.delete("open");
    router.replace(`/applications${params.size ? `?${params}` : ""}`, { scroll: false });
  }

  if (error) return <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Applications</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border">
            <button
              className={cn("flex items-center gap-1 px-2.5 py-1.5 text-xs cursor-pointer rounded-l-md", view === "table" ? "bg-accent-soft text-accent font-medium" : "text-muted")}
              onClick={() => setView("table")}
            >
              <Table2 size={13} /> Table
            </button>
            <button
              className={cn("flex items-center gap-1 px-2.5 py-1.5 text-xs cursor-pointer rounded-r-md", view === "kanban" ? "bg-accent-soft text-accent font-medium" : "text-muted")}
              onClick={() => setView("kanban")}
            >
              <Columns3 size={13} /> Board
            </button>
          </div>
          <Button onClick={() => setImportOpen(true)} title="Import your Simplify.jobs tracker CSV">
            <Import size={14} /> Import
          </Button>
          <Button variant="primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus size={14} /> Add application
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search company, title, tags…" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-64" />
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          {Object.entries(JOB_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
        <Select value={seasonFilter} onChange={(e) => setSeasonFilter(e.target.value)}>
          <option value="">All seasons</option>
          {seasons.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        {apps ? <span className="ml-auto text-xs text-muted">{filtered.length} of {apps.length}</span> : null}
      </div>

      {!apps ? (
        <div className="flex h-48 items-center justify-center"><Spinner /></div>
      ) : apps.length === 0 ? (
        <EmptyState
          icon={<Briefcase size={28} />}
          title="No applications yet"
          description="Track your first application, or save a role from Job Discovery."
          action={<Button variant="primary" onClick={() => setFormOpen(true)}><Plus size={14} /> Add application</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nothing matches your filters" description="Try clearing the search or filters." />
      ) : view === "table" ? (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs text-muted">
              <tr>
                <Th onClick={() => setSort("companyName")} active={sortKey === "companyName"} dir={sortDir}>Company</Th>
                <th className="px-3 py-2 font-medium">Role</th>
                <Th onClick={() => setSort("status")} active={sortKey === "status"} dir={sortDir}>Status</Th>
                <th className="px-3 py-2 font-medium">Season</th>
                <Th onClick={() => setSort("dateApplied")} active={sortKey === "dateApplied"} dir={sortDir}>Applied</Th>
                <Th onClick={() => setSort("nextActionDate")} active={sortKey === "nextActionDate"} dir={sortDir}>Next action</Th>
                <Th onClick={() => setSort("updatedAt")} active={sortKey === "updatedAt"} dir={sortDir}>Updated</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((a) => (
                <tr key={a.id} className="cursor-pointer hover:bg-accent-soft/40" onClick={() => openDetail(a.id)}>
                  <td className="px-3 py-2 font-medium">
                    <span className="flex items-center gap-1.5">
                      {a.companyName}
                      {a.hasCredential ? <KeyRound size={11} className="text-muted/60" aria-label="Has stored credential" /> : null}
                    </span>
                  </td>
                  <td className="max-w-64 truncate px-3 py-2">{a.jobTitle}</td>
                  <td className="px-3 py-2"><StatusBadge status={a.status} /></td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{a.season ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted">{formatDate(a.dateApplied)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted">{formatDate(a.nextActionDate)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{relativeDays(a.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {PIPELINE_ORDER.map((status) => {
            const column = filtered.filter((a) => a.status === status);
            return (
              <div key={status} className="w-60 shrink-0">
                <div className="mb-2 flex items-center gap-2">
                  <StatusBadge status={status} />
                  <span className="text-xs tabular-nums text-muted">{column.length}</span>
                </div>
                <div className="space-y-2">
                  {column.map((a) => (
                    <Card key={a.id} className="cursor-pointer p-2.5 hover:border-accent" >
                      <div onClick={() => openDetail(a.id)}>
                        <p className="text-sm font-medium">{a.companyName}</p>
                        <p className="truncate text-xs text-muted">{a.jobTitle}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {a.season ? <Badge className="text-[10px]">{a.season}</Badge> : null}
                          {a.tags.slice(0, 2).map((t) => (
                            <Badge key={t} className="bg-accent-soft text-[10px]">{t}</Badge>
                          ))}
                        </div>
                      </div>
                    </Card>
                  ))}
                  {column.length === 0 ? <div className="rounded-md border border-dashed border-border py-4 text-center text-[10px] text-muted/60">empty</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {importOpen ? <ImportModal onClose={() => setImportOpen(false)} onImported={load} /> : null}
      {formOpen ? (
        <AppForm
          key={editing?.id ?? "new"}
          onClose={() => setFormOpen(false)}
          application={editing}
          onSaved={() => load()}
        />
      ) : null}
      {openId ? (
        <AppDrawer
          key={openId}
          applicationId={openId}
          onClose={() => openDetail(null)}
          onChanged={load}
          onDeleted={load}
          onEdit={(detail: ApplicationDetail) => {
            setEditing(detail);
            setFormOpen(true);
          }}
        />
      ) : null}
    </div>
  );
}

function Th({ children, onClick, active, dir }: { children: React.ReactNode; onClick: () => void; active: boolean; dir: "asc" | "desc" }) {
  return (
    <th className="cursor-pointer select-none px-3 py-2 font-medium hover:text-foreground" onClick={onClick}>
      {children}
      {active ? <span className="ml-1">{dir === "asc" ? "↑" : "↓"}</span> : null}
    </th>
  );
}
