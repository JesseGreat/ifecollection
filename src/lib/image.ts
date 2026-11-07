"use client";
// Shrink phone photos BEFORE upload: saves the admin's data and makes the shop app fast for staff.

export type Compressed = { blob: Blob; type: string; width: number; height: number };

let webpOk: boolean | null = null;
function supportsWebp() {
  if (webpOk === null) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    webpOk = c.toDataURL("image/webp").startsWith("data:image/webp");
  }
  return webpOk;
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall back to <img> (older Safari) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process photo"))), type, quality),
  );
}

/**
 * Resize so the longest side is at most `maxDim`, then lower quality (and if needed size)
 * until the file is about `targetBytes`.
 */
export async function compressImage(file: Blob, maxDim: number, targetBytes: number): Promise<Compressed> {
  const src = await decode(file);
  const w0 = "naturalWidth" in src ? src.naturalWidth : src.width;
  const h0 = "naturalHeight" in src ? src.naturalHeight : src.height;
  const type = supportsWebp() ? "image/webp" : "image/jpeg";
  let scale = Math.min(1, maxDim / Math.max(w0, h0));

  for (let attempt = 0; attempt < 4; attempt++) {
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; // transparent PNGs -> white background
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, w, h);

    let quality = 0.82;
    let blob = await toBlob(canvas, type, quality);
    while (blob.size > targetBytes && quality > 0.5) {
      quality -= 0.08;
      blob = await toBlob(canvas, type, quality);
    }
    if (blob.size <= targetBytes * 1.15 || attempt === 3) {
      if ("close" in src) src.close();
      return { blob, type, width: w, height: h };
    }
    scale *= 0.8;
  }
  throw new Error("Could not process photo");
}

export const FULL_MAX = 1200;
export const FULL_BYTES = 200 * 1024;
export const THUMB_MAX = 320;
export const THUMB_BYTES = 30 * 1024;
