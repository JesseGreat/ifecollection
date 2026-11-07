// Turn a product_images row into a URL, wherever the photo is stored. Safe on server and phone.
import { publicImageUrl } from "@/lib/supabase/env";

export type ImageRef = { provider?: string | null; path: string; thumb_path?: string | null };

// Cloudinary resizes on the fly and picks WebP/AVIF for the phone (f_auto), at good-enough quality (q_auto).
const CLOUDINARY_SIZES = {
  thumb: "c_fill,g_auto,w_320,h_320,f_auto,q_auto",
  full: "c_limit,w_1200,h_1200,f_auto,q_auto",
} as const;

export function imageUrl(img: ImageRef | null | undefined, size: "thumb" | "full"): string {
  if (!img) return "";
  if (img.provider === "cloudinary") {
    return img.path.replace("/image/upload/", `/image/upload/${CLOUDINARY_SIZES[size]}/`);
  }
  return publicImageUrl(size === "thumb" ? (img.thumb_path ?? img.path) : img.path);
}

/** Columns to select from product_images so imageUrl() works. */
export const IMAGE_COLUMNS = "provider,path,thumb_path,sort_order";
