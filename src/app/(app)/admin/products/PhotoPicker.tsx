"use client";
import { useRef } from "react";
import { Icon } from "@/components/icons";
import { cx } from "@/components/ui";
import { compressImage, FULL_BYTES, FULL_MAX, THUMB_BYTES, THUMB_MAX } from "@/lib/image";
import { imageUrl } from "@/lib/images";
import { getUploadTicket, newPhotoPaths, uploadToCloudinary, uploadWithProgress } from "@/lib/upload";
import { uuid } from "@/lib/uuid";

export type Photo = {
  key: string;
  existingId?: string;
  provider?: "supabase" | "cloudinary";
  /** Cloudinary public_id (needed to delete it later). */
  externalId?: string;
  preview: string;
  status: "processing" | "uploading" | "done" | "error";
  progress: number;
  /** Cloudinary: secure_url. Supabase: object path. */
  path?: string;
  thumbPath?: string;
  error?: string;
  full?: Blob;
  thumb?: Blob;
};

export type ExistingImage = {
  id: string;
  provider: string;
  path: string;
  thumb_path: string | null;
  external_id: string | null;
  sort_order: number;
};

export function photoFromExisting(img: ExistingImage): Photo {
  return {
    key: img.id,
    existingId: img.id,
    provider: img.provider === "cloudinary" ? "cloudinary" : "supabase",
    externalId: img.external_id ?? undefined,
    preview: imageUrl(img, "thumb"),
    status: "done",
    progress: 1,
    path: img.path,
    thumbPath: img.thumb_path ?? undefined,
  };
}

export function PhotoPicker({
  photos,
  setPhotos,
}: {
  photos: Photo[];
  setPhotos: (fn: (p: Photo[]) => Photo[]) => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const update = (key: string, patch: Partial<Photo>) =>
    setPhotos((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  /** Upload the already-compressed photo: to Cloudinary when set up, otherwise to Supabase Storage. */
  async function upload(key: string, full: Blob, thumb: Blob, paths?: { full: string; thumb: string }) {
    update(key, { status: "uploading", progress: 0, error: undefined });
    try {
      const ticket = await getUploadTicket();
      if (ticket.provider === "cloudinary") {
        // One upload only: Cloudinary makes thumbnails from the URL.
        const r = await uploadToCloudinary(ticket, full, (f) => update(key, { progress: f }));
        update(key, { status: "done", progress: 1, provider: "cloudinary", path: r.secureUrl, externalId: r.publicId, thumbPath: undefined });
        return;
      }
      const p = paths ?? newPhotoPaths(full.type);
      update(key, { provider: "supabase", path: p.full, thumbPath: p.thumb });
      await uploadWithProgress(p.full, full, (f) => update(key, { progress: f * 0.85 }));
      await uploadWithProgress(p.thumb, thumb, (f) => update(key, { progress: 0.85 + f * 0.15 }));
      update(key, { status: "done", progress: 1 });
    } catch (e) {
      update(key, { status: "error", error: (e as Error).message });
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const key = uuid();
      setPhotos((list) => [...list, { key, preview: "", status: "processing", progress: 0 }]);
      try {
        const [full, thumb] = await Promise.all([
          compressImage(file, FULL_MAX, FULL_BYTES),
          compressImage(file, THUMB_MAX, THUMB_BYTES),
        ]);
        update(key, { full: full.blob, thumb: thumb.blob, preview: URL.createObjectURL(thumb.blob) });
        await upload(key, full.blob, thumb.blob);
      } catch (e) {
        update(key, { status: "error", error: (e as Error).message || "Could not read this photo" });
      }
    }
  }

  function retry(p: Photo) {
    if (!p.full || !p.thumb) return;
    // Supabase: reuse the same paths (upsert). Cloudinary: a fresh signature/public_id each time.
    const same = p.provider === "supabase" && p.path && p.thumbPath ? { full: p.path, thumb: p.thumbPath } : undefined;
    upload(p.key, p.full, p.thumb, same);
  }

  function remove(key: string) {
    setPhotos((list) => list.filter((p) => p.key !== key));
  }

  function makeMain(key: string) {
    setPhotos((list) => {
      const p = list.find((x) => x.key === key);
      return p ? [p, ...list.filter((x) => x.key !== key)] : list;
    });
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-brand-700 font-semibold text-white"
        >
          <Icon name="camera" /> Take photo
        </button>
        <button
          type="button"
          onClick={() => galleryRef.current?.click()}
          className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-brand-700 bg-white font-semibold text-brand-700"
        >
          <Icon name="image" /> Gallery
        </button>
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid="photo-camera"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        data-testid="photo-gallery"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {photos.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p, i) => (
            <li key={p.key} className="relative overflow-hidden rounded-xl border-2 border-line bg-canvas" data-testid="photo-item" data-status={p.status}>
              <div className="aspect-square">
                {p.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.preview} alt="" className="size-full object-cover" />
                ) : (
                  <div className="skeleton size-full" />
                )}
              </div>
              {i === 0 && p.status === "done" && (
                <span className="absolute top-1 left-1 rounded-md bg-brand-700 px-1.5 text-xs font-bold text-white">Main</span>
              )}
              {(p.status === "uploading" || p.status === "processing") && (
                <div className="absolute inset-x-0 bottom-0 bg-black/60 p-1">
                  <div className="h-2 overflow-hidden rounded-full bg-white/30" role="progressbar" aria-valuenow={Math.round(p.progress * 100)}>
                    <div className="h-full bg-gold-300 transition-all" style={{ width: `${Math.round(p.progress * 100)}%` }} />
                  </div>
                  <p className="text-center text-xs text-white">
                    {p.status === "processing" ? "Preparing…" : `${Math.round(p.progress * 100)}%`}
                  </p>
                </div>
              )}
              {p.status === "error" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-red-900/80 p-1 text-center">
                  <span className="text-xs text-white">{p.error}</span>
                  {p.full && (
                    <button type="button" onClick={() => retry(p)} className="min-h-9 rounded-lg bg-white px-3 text-sm font-bold text-red-900">
                      Retry
                    </button>
                  )}
                </div>
              )}
              <div className={cx("flex", p.status !== "done" && "hidden")}>
                {i > 0 && (
                  <button type="button" onClick={() => makeMain(p.key)} className="min-h-10 flex-1 text-xs font-semibold text-brand-700">
                    Main
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(p.key)}
                  aria-label="Remove photo"
                  className="min-h-10 flex-1 text-xs font-semibold text-red-700"
                >
                  Remove
                </button>
              </div>
              {p.status === "error" && (
                <button type="button" onClick={() => remove(p.key)} className="min-h-10 w-full text-xs font-semibold text-red-700">
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
