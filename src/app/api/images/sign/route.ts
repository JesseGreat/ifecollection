import { NextResponse } from "next/server";
import { cloudinaryConfig, signedUpload } from "@/lib/cloudinary";
import { requireAdmin } from "@/lib/supabase/server";
import { uuid } from "@/lib/uuid";

// The phone asks here before uploading a product photo.
// Admin only. Returns a one-photo Cloudinary signature, or { provider: "supabase" } when Cloudinary is not set up.
// The Cloudinary API secret never leaves the server.
export async function POST() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "ADMIN_ONLY" }, { status: 403 });
  }
  const cfg = cloudinaryConfig();
  if (!cfg) return NextResponse.json({ provider: "supabase" }, { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(
    { provider: "cloudinary", ...signedUpload(cfg, uuid()) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
