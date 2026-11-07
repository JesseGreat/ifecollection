// Demo data: 1 admin, 2 sales staff, categories and sample products with photos.
// Usage: npm run seed            (safe to run twice; existing users/products are skipped)
// Passwords can be set with SEED_ADMIN_PASSWORD / SEED_STAFF_PASSWORD.
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { cloudinaryConfig, cloudinaryUpload } from "../src/lib/cloudinary";

config({ path: ".env.local" });
config();

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "IfeAdmin2026!";
const STAFF_PASSWORD = process.env.SEED_STAFF_PASSWORD ?? "IfeStaff2026!";
const email = (u: string) => `${u}@staff.ifecollection.app`;

const USERS = [
  { username: "ife", full_name: "Ife (Owner)", role: "admin", password: ADMIN_PASSWORD },
  { username: "amaka", full_name: "Amaka Obi", role: "staff", password: STAFF_PASSWORD },
  { username: "tunde", full_name: "Tunde Bakare", role: "staff", password: STAFF_PASSWORD },
];

const CATEGORIES = ["Gowns", "Shirts", "Trousers", "Ankara"];

const PRODUCTS = [
  { name: "Ankara wrap gown", category: "Ankara", price: 18500, colour: "#b45309", sizes: ["S", "M", "L", "XL"], colours: ["Orange", "Blue"] },
  { name: "Lace evening gown", category: "Gowns", price: 35000, colour: "#7e22ce", sizes: ["M", "L", "XL"], colours: ["Purple", "Gold"] },
  { name: "Adire shirt", category: "Shirts", price: 9500, colour: "#1d4ed8", sizes: ["M", "L", "XL", "XXL"], colours: ["Blue"] },
  { name: "Plain senator shirt", category: "Shirts", price: 12000, colour: "#0f766e", sizes: ["M", "L", "XL"], colours: ["White", "Black"] },
  { name: "Palazzo trousers", category: "Trousers", price: 8000, colour: "#be123c", sizes: ["S", "M", "L"], colours: ["Black", "Red"] },
  { name: "Ankara head wrap", category: "Ankara", price: 3500, colour: "#ca8a04", sizes: [""], colours: ["Multi"] },
];

async function photo(text: string, bg: string, size: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="100%" height="100%" fill="${bg}"/>
    <circle cx="${size * 0.8}" cy="${size * 0.2}" r="${size * 0.25}" fill="#ffffff22"/>
    <text x="50%" y="52%" text-anchor="middle" font-family="DejaVu Sans, Arial" font-weight="700"
      font-size="${size * 0.075}" fill="#fff">${text}</text>
    <text x="50%" y="62%" text-anchor="middle" font-family="DejaVu Sans, Arial" font-size="${size * 0.045}" fill="#ffffffcc">IfeCollection</text>
  </svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 75 }).toBuffer();
}

async function ensureUser(admin: SupabaseClient, u: (typeof USERS)[number]) {
  const { error } = await admin.auth.admin.createUser({
    email: email(u.username),
    password: u.password,
    email_confirm: true,
    app_metadata: { username: u.username, full_name: u.full_name, role: u.role },
  });
  if (error && !/already|exists|registered/i.test(error.message)) throw error;
  console.log(`${error ? "•" : "✓"} ${u.role.padEnd(5)} ${u.username.padEnd(6)} ${error ? "(already existed)" : `password: ${u.password}`}`);
}

async function main() {
  if (!URL_ || !ANON || !SERVICE) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.");
  const service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  for (const u of USERS) await ensureUser(service, u);

  // Act as the admin from here on, through the same RPCs and RLS the app uses.
  const sb = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error: loginErr } = await sb.auth.signInWithPassword({ email: email("ife"), password: ADMIN_PASSWORD });
  if (loginErr) throw new Error(`Could not log in as the seed admin: ${loginErr.message}`);

  const catIds: Record<string, string> = {};
  for (const [i, name] of CATEGORIES.entries()) {
    await sb.from("categories").upsert({ name, sort_order: i }, { onConflict: "name", ignoreDuplicates: true });
  }
  const { data: cats } = await sb.from("categories").select("id,name");
  cats?.forEach((c) => (catIds[c.name] = c.id));

  const { data: existing } = await sb.from("products").select("name");
  const have = new Set(existing?.map((p) => p.name));
  for (const p of PRODUCTS) {
    if (have.has(p.name)) {
      console.log(`• product ${p.name} (already existed)`);
      continue;
    }
    const variants = p.colours.flatMap((colour, ci) =>
      p.sizes.map((size, si) => ({ size, colour, quantity: (ci + si) % 4 === 3 ? 2 : 4 + si + ci })),
    );
    const { data: id, error } = await sb.rpc("save_product", {
      p: { name: p.name, category_id: catIds[p.category], price: p.price, variants },
    });
    if (error) throw error;
    const cloud = cloudinaryConfig();
    if (cloud) {
      const img = await photo(p.name, p.colour, 1000);
      const up = await cloudinaryUpload(cloud, new Blob([new Uint8Array(img)], { type: "image/webp" }), `seed-${id}`);
      const { error: imgErr } = await sb.from("product_images").insert({
        product_id: id, provider: "cloudinary", path: up.secureUrl, external_id: up.publicId, sort_order: 0,
      });
      if (imgErr) throw imgErr;
    } else {
      const stamp = Date.now();
      const full = `seed/${stamp}-${id}.webp`;
      const thumb = `seed/${stamp}-${id}-t.webp`;
      const up1 = await sb.storage.from("product-images").upload(full, await photo(p.name, p.colour, 1000), { contentType: "image/webp", upsert: true });
      const up2 = await sb.storage.from("product-images").upload(thumb, await photo(p.name, p.colour, 320), { contentType: "image/webp", upsert: true });
      if (up1.error || up2.error) throw up1.error ?? up2.error;
      await sb.from("product_images").insert({ product_id: id, path: full, thumb_path: thumb, sort_order: 0 });
    }
    console.log(`✓ product ${p.name} (${variants.length} variants, photo on ${cloud ? "Cloudinary" : "Supabase Storage"})`);
  }
  console.log("\nDone. Log in as admin: ife / staff: amaka, tunde (staff only between the working hours).");
}

main().catch((e) => {
  console.error(`✗ ${e.message ?? e}`);
  process.exit(1);
});
