"use client";

/** Client-side fetch helper with typed JSON errors. */
export class ApiError extends Error {
  status: number;
  code?: string;
  details?: string[];
  constructor(status: number, message: string, code?: string, details?: string[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers:
      init?.body instanceof FormData
        ? init?.headers
        : { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.code, data?.details);
  }
  return data as T;
}

const CLIPBOARD_CLEAR_MS = 45_000;
let clearTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Copy a secret and clear the clipboard after 45s — but only if the clipboard
 * still holds the same value (don't clobber something copied later).
 */
export async function copySecret(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(async () => {
    try {
      const current = await navigator.clipboard.readText();
      if (current === value) await navigator.clipboard.writeText("");
    } catch {
      // Clipboard read may be denied when unfocused — best effort only.
    }
  }, CLIPBOARD_CLEAR_MS);
}

export async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function relativeDays(iso: string | null | undefined): string {
  if (!iso) return "";
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}
