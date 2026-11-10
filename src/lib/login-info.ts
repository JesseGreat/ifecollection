// Where/how a login happened. Pure helpers (unit-tested); the login action fills them in.

export type GeoFields = { lat?: number; lng?: number; accuracy?: number; location_error?: string };

/** "Android 14 · Chrome", "iPhone · Safari", "Windows · Edge" … from the browser's User-Agent. */
export function describeDevice(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const os = /Android (\d+)/.exec(ua)
    ? `Android ${/Android (\d+)/.exec(ua)![1]}`
    : /Android/.test(ua)
      ? "Android"
      : /iPhone/.test(ua)
        ? "iPhone"
        : /iPad/.test(ua)
          ? "iPad"
          : /Windows/.test(ua)
            ? "Windows"
            : /Mac OS X|Macintosh/.test(ua)
              ? "Mac"
              : /CrOS/.test(ua)
                ? "Chromebook"
                : /Linux/.test(ua)
                  ? "Linux"
                  : "Unknown OS";
  const browser = /SamsungBrowser/.test(ua)
    ? "Samsung Internet"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Edg\//.test(ua)
        ? "Edge"
        : /Firefox|FxiOS/.test(ua)
          ? "Firefox"
          : /CriOS|Chrome\//.test(ua)
            ? "Chrome"
            : /Safari/.test(ua)
              ? "Safari"
              : "Browser";
  return `${os} · ${browser}`;
}

/** Read the GPS fields the login form attached (strings from FormData). */
export function readGeo(form: FormData): GeoFields {
  const num = (k: string) => {
    const v = Number(form.get(k));
    return form.get(k) != null && form.get(k) !== "" && Number.isFinite(v) ? v : undefined;
  };
  const lat = num("lat");
  const lng = num("lng");
  const ok = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const err = String(form.get("geo_error") ?? "");
  return ok ? { lat, lng, accuracy: num("accuracy") } : { location_error: err || "not_shared" };
}

/** Network location from Vercel's request headers (approximate; city-level at best). */
export function networkLocation(h: { get(name: string): string | null }) {
  const dec = (v: string | null) => {
    if (!v) return undefined;
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined,
    city: dec(h.get("x-vercel-ip-city")),
    region: dec(h.get("x-vercel-ip-country-region")),
    country: dec(h.get("x-vercel-ip-country")),
  };
}

export const LOCATION_MESSAGES: Record<string, string> = {
  denied:
    "IfeCollection needs your location to log in. Allow location for this site (tap the lock icon next to the address, then Location → Allow) and try again.",
  unavailable: "Could not get your location. Turn on Location (GPS) on your phone and try again.",
  timeout: "Getting your location took too long. Turn on Location (GPS), move near a window or door, and try again.",
  unsupported: "This browser cannot share your location. Please use Chrome on your phone.",
  not_shared: "IfeCollection needs your location to log in. Turn on Location (GPS) and allow it for this site, then try again.",
};
