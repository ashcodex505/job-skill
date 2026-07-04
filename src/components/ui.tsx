"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-accent text-white hover:opacity-90 border-transparent",
    secondary: "bg-surface border-border hover:bg-accent-soft text-foreground",
    ghost: "border-transparent hover:bg-accent-soft text-muted hover:text-foreground",
    danger: "bg-surface border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer",
        size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent placeholder:text-muted/60",
        props.className,
      )}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent placeholder:text-muted/60",
        props.className,
      )}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent",
        props.className,
      )}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted/70">{hint}</span> : null}
    </label>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border bg-surface", className)}>{children}</div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent",
        className,
      )}
    />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-14 text-center">
      {icon ? <div className="text-muted/60">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-sm text-xs text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[6vh]" onMouseDown={onClose}>
      <div
        className={cn("w-full rounded-lg border border-border bg-surface shadow-xl", wide ? "max-w-3xl" : "max-w-lg")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X size={14} />
          </Button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Drawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40" onMouseDown={onClose}>
      <div
        className="absolute right-0 top-0 h-full w-full max-w-xl overflow-y-auto border-l border-border bg-surface shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/** Multi-value tag input: type + Enter to add. */
export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (tags: string[]) => void; placeholder?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-surface px-2 py-1">
      {value.map((tag) => (
        <Badge key={tag} className="bg-accent-soft">
          {tag}
          <button
            type="button"
            className="text-muted hover:text-foreground cursor-pointer"
            onClick={() => onChange(value.filter((t) => t !== tag))}
            aria-label={`Remove ${tag}`}
          >
            <X size={10} />
          </button>
        </Badge>
      ))}
      <input
        className="min-w-24 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted/60"
        placeholder={placeholder ?? "Add tag + Enter"}
        onKeyDown={(e) => {
          const input = e.currentTarget;
          if (e.key === "Enter" && input.value.trim()) {
            e.preventDefault();
            const tag = input.value.trim().toLowerCase();
            if (!value.includes(tag)) onChange([...value, tag]);
            input.value = "";
          } else if (e.key === "Backspace" && !input.value && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
      />
    </div>
  );
}
