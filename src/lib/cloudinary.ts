// Cloudinary helpers for the SERVER (API routes, server actions, scripts). Never import in client code:
// the API secret must stay on the server. No SDK needed – Cloudinary's API is plain HTTPS + SHA-1 signing.
import { createHash } from "node:crypto";

export const CLOUDINARY_FOLDER = "ifecollection/products";
export const ALLOWED_FORMATS = "jpg,png,webp";

export type CloudinaryConfig = { cloudName: string; apiKey: string; apiSecret: string };

/**
 * Reads CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET,
 * or the single CLOUDINARY_URL (cloudinary://KEY:SECRET@CLOUD_NAME) shown in the Cloudinary dashboard.
 * Returns null when Cloudinary is not set up (the app then uses Supabase Storage).
 */
export function cloudinaryConfig(env: Record<string, string | undefined> = process.env): CloudinaryConfig | null {
  const url = env.CLOUDINARY_URL?.trim();
  if (url) {
    const m = url.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
    if (m) return { apiKey: m[1], apiSecret: m[2], cloudName: m[3] };
  }
  const cloudName = env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = env.CLOUDINARY_API_SECRET?.trim();
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
}

/** Cloudinary signature: SHA-1 of the sorted "key=value&…" string followed by the API secret. */
export function cloudinarySignature(params: Record<string, string | number>, apiSecret: string): string {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== "" && params[k] != null)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(toSign + apiSecret).digest("hex");
}

/** Everything the phone needs to upload ONE photo directly to Cloudinary (valid ~1 hour). */
export function signedUpload(cfg: CloudinaryConfig, publicId: string, now = Date.now()) {
  const params = {
    allowed_formats: ALLOWED_FORMATS,
    folder: CLOUDINARY_FOLDER,
    public_id: publicId,
    timestamp: Math.floor(now / 1000),
  };
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`,
    fields: { ...params, api_key: cfg.apiKey, signature: cloudinarySignature(params, cfg.apiSecret) },
  };
}

/** Server-side upload (used by the seed script). */
export async function cloudinaryUpload(cfg: CloudinaryConfig, file: Blob, publicId: string) {
  const { uploadUrl, fields } = signedUpload(cfg, publicId);
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, String(v)));
  form.append("file", file);
  const res = await fetch(uploadUrl, { method: "POST", body: form });
  const body = await res.json();
  if (!res.ok) throw new Error(`Cloudinary upload failed: ${body?.error?.message ?? res.status}`);
  return { secureUrl: body.secure_url as string, publicId: body.public_id as string };
}

/** Delete photos from Cloudinary (best effort – a failure must not block saving a product). */
export async function cloudinaryDestroy(cfg: CloudinaryConfig, publicIds: string[]) {
  const results = await Promise.allSettled(
    publicIds.map(async (publicId) => {
      const params = { public_id: publicId, timestamp: Math.floor(Date.now() / 1000) };
      const form = new FormData();
      Object.entries({ ...params, api_key: cfg.apiKey, signature: cloudinarySignature(params, cfg.apiSecret) }).forEach(
        ([k, v]) => form.append(k, String(v)),
      );
      const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/destroy`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`destroy ${publicId}: ${res.status}`);
    }),
  );
  return results.filter((r) => r.status === "rejected").length;
}
