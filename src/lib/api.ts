import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { DecryptionError } from "./security/encryption";
import { VaultLockedError } from "./security/credentials";

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status: 400 });
}

export function notFound(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

/**
 * Wraps a route handler with consistent error mapping. Error messages from
 * the security layer are safe by construction (never contain key material or
 * plaintext).
 */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: "Validation failed", details: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
          { status: 400 },
        );
      }
      if (err instanceof VaultLockedError) {
        return NextResponse.json({ error: err.message, code: "VAULT_LOCKED" }, { status: 423 });
      }
      if (err instanceof DecryptionError) {
        return NextResponse.json({ error: err.message, code: "DECRYPTION_FAILED" }, { status: 422 });
      }
      console.error("API error:", err instanceof Error ? err.message : err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Internal error" },
        { status: 500 },
      );
    }
  };
}

export const parseTags = (raw: string | null | undefined): string[] => {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
