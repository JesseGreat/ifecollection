"use client";
import { uuid } from "@/lib/uuid";
// Upload to Supabase Storage with a real progress bar (fetch() cannot report upload progress).
// Storage RLS only lets the admin write to the product-images bucket.
import { supabaseBrowser } from "@/lib/supabase/client";
import { PRODUCT_BUCKET, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";

export async function uploadWithProgress(
  path: string,
  blob: Blob,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const { data } = await supabaseBrowser().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please log in again.");

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SUPABASE_URL}/storage/v1/object/${PRODUCT_BUCKET}/${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", SUPABASE_ANON_KEY);
    xhr.setRequestHeader("Content-Type", blob.type || "image/jpeg");
    xhr.setRequestHeader("x-upsert", "true"); // a retry of the same path must not fail
    xhr.setRequestHeader("cache-control", "max-age=31536000"); // path is unique, so cache forever
    xhr.timeout = 90_000;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? (onProgress(1), resolve())
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Upload failed – check your internet"));
    xhr.ontimeout = () => reject(new Error("Upload timed out – check your internet"));
    xhr.send(blob);
  });
}

export type UploadTicket =
  | { provider: "supabase" }
  | { provider: "cloudinary"; uploadUrl: string; fields: Record<string, string | number> };

/** Ask our server (admin only) where/how to upload the next photo. */
export async function getUploadTicket(): Promise<UploadTicket> {
  const res = await fetch("/api/images/sign", { method: "POST", cache: "no-store" });
  if (res.status === 403) throw new Error("Only the admin can upload photos.");
  if (!res.ok) throw new Error("Upload failed – check your internet");
  return res.json();
}

/** Upload straight from the phone to Cloudinary with the server's one-time signature. */
export function uploadToCloudinary(
  ticket: Extract<UploadTicket, { provider: "cloudinary" }>,
  blob: Blob,
  onProgress: (fraction: number) => void,
): Promise<{ secureUrl: string; publicId: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    Object.entries(ticket.fields).forEach(([k, v]) => form.append(k, String(v)));
    form.append("file", blob, `photo.${blob.type === "image/webp" ? "webp" : "jpg"}`);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", ticket.uploadUrl);
    xhr.timeout = 90_000;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && body.secure_url) {
          onProgress(1);
          resolve({ secureUrl: body.secure_url, publicId: body.public_id });
        } else reject(new Error(body?.error?.message ? `Upload failed: ${body.error.message}` : `Upload failed (${xhr.status})`));
      } catch {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed – check your internet"));
    xhr.ontimeout = () => reject(new Error("Upload timed out – check your internet"));
    xhr.send(form);
  });
}

export function newPhotoPaths(type: string) {
  const ext = type === "image/webp" ? "webp" : "jpg";
  const id = uuid();
  const month = new Date().toISOString().slice(0, 7);
  return { full: `products/${month}/${id}.${ext}`, thumb: `products/${month}/${id}-t.${ext}` };
}
