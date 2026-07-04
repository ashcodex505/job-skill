import { eq } from "drizzle-orm";
import { db, newId, now, tables } from "@/db";
import { handler, notFound, ok } from "@/lib/api";
import { encryptSecrets, toCredentialView } from "@/lib/security/credentials";
import { credentialInput } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const row = await db.query.credentials.findFirst({ where: eq(tables.credentials.applicationId, id) });
  return ok(row ? toCredentialView(row) : null);
});

/**
 * Create/replace the credential for an application. The plaintext password
 * only exists in this request body (localhost) and is encrypted before any
 * write. If encryption fails, nothing is persisted — existing data stays
 * intact.
 */
export const PUT = handler(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const app = await db.query.applications.findFirst({ where: eq(tables.applications.id, id) });
  if (!app) return notFound("Application not found");

  const input = credentialInput.parse(await req.json());
  const existing = await db.query.credentials.findFirst({
    where: eq(tables.credentials.applicationId, id),
  });

  // Encrypt first (throws VaultLockedError/DecryptionError before any write).
  const toEncrypt: Record<string, string> = {};
  if (input.password) toEncrypt.password = input.password;
  if (input.secureNotes) toEncrypt.notes = input.secureNotes;
  const encrypted =
    Object.keys(toEncrypt).length > 0 ? await encryptSecrets(toEncrypt) : null;

  const t = now();
  const secretFields = encrypted
    ? {
        ...(encrypted.values.password
          ? { encryptedPassword: encrypted.values.password.ciphertext, encryptionIv: encrypted.values.password.iv }
          : {}),
        ...(encrypted.values.notes
          ? { encryptedNotes: encrypted.values.notes.ciphertext, notesIv: encrypted.values.notes.iv }
          : {}),
        encryptionSalt: encrypted.salt,
        encryptionVersion: encrypted.version,
      }
    : {};

  if (existing) {
    await db
      .update(tables.credentials)
      .set({ email: input.email, username: input.username, ...secretFields, updatedAt: t })
      .where(eq(tables.credentials.id, existing.id));
  } else {
    await db.insert(tables.credentials).values({
      id: newId(),
      applicationId: id,
      email: input.email,
      username: input.username,
      ...secretFields,
      createdAt: t,
      updatedAt: t,
    });
  }

  const row = await db.query.credentials.findFirst({ where: eq(tables.credentials.applicationId, id) });
  return ok(toCredentialView(row!));
});

export const DELETE = handler(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await db.delete(tables.credentials).where(eq(tables.credentials.applicationId, id));
  return ok({ deleted: true });
});
