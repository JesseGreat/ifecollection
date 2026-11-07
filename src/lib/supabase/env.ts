export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const PRODUCT_BUCKET = "product-images";

/** Staff log in with a username; Supabase Auth needs an email, so we build one that is never emailed. */
export const LOGIN_EMAIL_DOMAIN = "staff.ifecollection.app";

export function usernameToEmail(username: string) {
  return `${username.trim().toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;
}

export function isValidUsername(username: string) {
  return /^[a-z0-9._-]{3,30}$/.test(username.trim().toLowerCase());
}

export function publicImageUrl(path: string | null | undefined) {
  if (!path) return "";
  return `${SUPABASE_URL}/storage/v1/object/public/${PRODUCT_BUCKET}/${path}`;
}
