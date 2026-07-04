import type { StorageDriver } from "./index";

/**
 * Supabase Storage driver using the plain REST API (no SDK dependency).
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET.
 *
 * The service-role key stays server-side (route handlers only). Create the
 * bucket as *private* — files are always proxied through the local app.
 */
export function supabaseStorageDriver(): StorageDriver {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_BUCKET ?? "resumes";
  if (!url || !key) {
    throw new Error(
      "Supabase storage selected but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set (see .env.example)",
    );
  }
  const base = `${url.replace(/\/$/, "")}/storage/v1/object`;
  const headers = { Authorization: `Bearer ${key}` };

  return {
    name: "supabase",
    async put(objectKey, data, contentType) {
      const res = await fetch(`${base}/${bucket}/${objectKey}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": contentType, "x-upsert": "true" },
        body: new Uint8Array(data),
      });
      if (!res.ok) throw new Error(`Supabase upload failed (${res.status}): ${await res.text()}`);
    },
    async get(objectKey) {
      const res = await fetch(`${base}/${bucket}/${objectKey}`, { headers });
      if (!res.ok) throw new Error(`Supabase download failed (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },
    async delete(objectKey) {
      const res = await fetch(`${base}/${bucket}/${objectKey}`, { method: "DELETE", headers });
      if (!res.ok && res.status !== 404) throw new Error(`Supabase delete failed (${res.status})`);
    },
  };
}
