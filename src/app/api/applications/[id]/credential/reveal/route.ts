import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { handler, notFound, ok } from "@/lib/api";
import { decryptSecret } from "@/lib/security/credentials";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Explicit reveal: decrypts the password (and secure notes) for one
 * application. POST-only so it never ends up in prefetches or link previews.
 * Plaintext exists only in this localhost response — it is never logged and
 * never persisted.
 */
export const POST = handler(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const row = await db.query.credentials.findFirst({ where: eq(tables.credentials.applicationId, id) });
  if (!row) return notFound("No credential stored for this application");

  const password = row.encryptedPassword
    ? await decryptSecret({
        ciphertext: row.encryptedPassword,
        iv: row.encryptionIv!,
        salt: row.encryptionSalt ?? "",
        version: row.encryptionVersion ?? 1,
      })
    : null;
  const secureNotes = row.encryptedNotes
    ? await decryptSecret({
        ciphertext: row.encryptedNotes,
        iv: row.notesIv!,
        salt: row.encryptionSalt ?? "",
        version: row.encryptionVersion ?? 1,
      })
    : null;

  return ok({ password, secureNotes });
});
