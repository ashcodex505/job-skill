"use client";

import { Briefcase, FileText, LayoutDashboard, Radar, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "./ui";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/applications", label: "Applications", icon: Briefcase },
  { href: "/discovery", label: "Job Discovery", icon: Radar },
  { href: "/resumes", label: "Resumes", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-xs font-bold text-white">
          RT
        </div>
        <span className="text-sm font-semibold tracking-tight">Resume Tracker</span>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 px-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                active
                  ? "bg-accent-soft font-medium text-accent"
                  : "text-muted hover:bg-accent-soft/50 hover:text-foreground",
              )}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>
      <p className="px-4 py-3 text-[10px] text-muted/60">Local-first · credentials never leave this Mac</p>
    </aside>
  );
}
