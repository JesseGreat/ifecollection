"use server";
import { cloudinaryConfig, cloudinaryDestroy } from "@/lib/cloudinary";
import { requireAdmin } from "@/lib/supabase/server";

/** Delete removed product photos from Cloudinary (admin only, best effort). */
export async function deleteCloudinaryImages(publicIds: string[]): Promise<void> {
  await requireAdmin();
  const cfg = cloudinaryConfig();
  const ids = publicIds.filter((id) => typeof id === "string" && id.startsWith("ifecollection/"));
  if (!cfg || !ids.length) return;
  const failed = await cloudinaryDestroy(cfg, ids);
  if (failed) console.warn(`Cloudinary: ${failed} photo(s) could not be deleted`);
}
