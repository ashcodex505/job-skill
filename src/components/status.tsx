"use client";

import { STATUS_LABELS, type ApplicationStatus } from "@/lib/types";
import { cn, Select } from "./ui";

const STATUS_COLORS: Record<ApplicationStatus, string> = {
  interested: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  applied: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  oa_received: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  oa_completed: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  recruiter_screen: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  technical_interview: "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  final_round: "bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300",
  offer: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  rejected: "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300",
  withdrawn: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = status as ApplicationStatus;
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_COLORS[s] ?? STATUS_COLORS.interested,
        className,
      )}
    >
      {STATUS_LABELS[s] ?? status}
    </span>
  );
}

export function StatusSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (status: ApplicationStatus) => void;
  className?: string;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as ApplicationStatus)} className={className}>
      {Object.entries(STATUS_LABELS).map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </Select>
  );
}
