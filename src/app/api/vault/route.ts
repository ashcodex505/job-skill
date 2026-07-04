import { handler, ok } from "@/lib/api";
import { isUnlocked, lockVault, unlockVault, vaultMode, verifyVault } from "@/lib/security/credentials";
import { unlockInput } from "@/lib/validation";

/** Vault status: which key mode is active and whether secrets are accessible. */
export const GET = handler(async () => {
  return ok({ mode: vaultMode(), unlocked: await isUnlocked() });
});

/** Unlock with the master password (master mode only). */
export const POST = handler(async (req: Request) => {
  const { masterPassword } = unlockInput.parse(await req.json());
  await unlockVault(masterPassword);
  return ok({ mode: vaultMode(), unlocked: true });
});

/** Lock the vault / verify keychain health. */
export const DELETE = handler(async () => {
  lockVault();
  return ok({ mode: vaultMode(), unlocked: await isUnlocked() });
});

/** Keychain mode: force a verification round-trip (used by Settings). */
export const PATCH = handler(async () => {
  await verifyVault();
  return ok({ mode: vaultMode(), unlocked: true, verified: true });
});
