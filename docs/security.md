# Security model

This app stores job-site credentials (email, username, password, security
questions). Even though it runs only on localhost, **passwords and secure
notes are never stored in plaintext**.

## What is encrypted, where

| Data | At rest | Notes |
| --- | --- | --- |
| Password | AES-256-GCM ciphertext in SQLite | `credentials.encrypted_password` + per-record IV |
| Security questions / secure notes | AES-256-GCM ciphertext in SQLite | `credentials.encrypted_notes` |
| Email / username | Plaintext in SQLite | Deliberate usability trade-off: they're searchable and shown in lists. The DB file lives in `data/` (git-ignored) on your own Mac. |
| Resume files | Plain files (local disk or private Supabase bucket) | Not secrets. |

There is **no plaintext password column** in the schema. Stored fields:
`encrypted_password`, `encryption_iv`, `encryption_salt`,
`encryption_version`, `encrypted_notes`, `notes_iv`.

## Encryption design

- **Cipher**: AES-256-GCM (authenticated — tampering or a wrong key fails
  loudly instead of returning garbage). Random 96-bit IV per encryption; the
  16-byte auth tag is appended to the ciphertext.
- **Key, mode 1 (default on macOS — `encryption_version = 1`)**: a random
  256-bit key generated on first use and stored in the **macOS login
  Keychain** (generic password, service `resume-tracker`) via the system
  `security` CLI. The key never appears in the DB, env files, or logs.
- **Key, mode 2 (`ENCRYPTION_MODE=master` — `encryption_version = 2`)**: the
  key is derived from a master password with **scrypt**
  (N=2¹⁵, r=8, p=1, 32-byte key) and a **unique random salt per record**.
  The master password is held only in process memory after you unlock in
  Settings (or from `RESUME_TRACKER_MASTER_PASSWORD`); it is never persisted.
- **Verifier**: a known plaintext encrypted under the active key is stored in
  `app_settings`. A wrong master password / swapped keychain key is detected
  up front with a clear error — stored ciphertext is never touched or
  overwritten on failure.
- Both fields of one credential are encrypted under a single derived key
  (one salt) but always with distinct IVs.

## Guarantees enforced in code

- Plaintext credentials exist only (a) in the localhost request that saves
  them and (b) in the response to an explicit **Reveal**/**Copy** action
  (`POST .../credential/reveal` — POST so it is never prefetched or cached).
- Nothing in the credential path logs plaintext or key material; decryption
  errors are generic by construction (`DecryptionError`).
- The scraper, GitHub Actions workflow, and Supabase driver have no code path
  that reads the `credentials` table. Supabase receives resume files only.
- Encrypt-then-write: a credential update encrypts first and only then
  touches the DB, so a locked vault or bad key can never corrupt saved data.

## UI behavior

- Passwords render as `••••` until you click **Reveal**.
- **Copy password** puts the secret on the clipboard and clears it after
  ~45 s (only if the clipboard still holds that value).
- The credential panel shows *last updated*, supports edit/replace/delete,
  and shows a clear message if decryption fails.

## Tests

`src/lib/security/encryption.test.ts` covers: round-trip, wrong key fails,
wrong master password fails, unique IV per encryption, unique salt per
derivation, ciphertext contains no plaintext (utf8 or hex), GCM tamper
detection, and key-length validation.

## Known limitations (single-user local app)

- The one-time `security add-generic-password` call passes the key as a
  process argument — visible in `ps` for milliseconds on your own machine.
- Anyone with your unlocked macOS login session can read the keychain key
  (that's the Keychain trust model). Use master-password mode if you want a
  secret independent of the login session.
- The server binds to localhost without auth; anything on your machine can
  call the reveal endpoint while the app runs. Quit the app / lock the vault
  when not in use if this matters to you.
- Clipboard clearing is best-effort (browser focus rules).
