// Money is whole naira. Times are always shown in Africa/Lagos, whatever the phone is set to.
export const TZ = "Africa/Lagos";

const naira = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 });

/** 12500 -> "₦12,500" */
export function formatNaira(amount: number | null | undefined): string {
  const n = Math.round(Number(amount ?? 0));
  return `${n < 0 ? "-" : ""}₦${naira.format(Math.abs(n))}`;
}

/** "12,500" / "₦12500" / "12 500" -> 12500 ; anything else -> null */
export function parseNaira(input: string): number | null {
  const digits = input.replace(/[₦,\s]/g, "");
  if (!/^\d{1,12}$/.test(digits)) return null;
  return Number(digits);
}

export function formatDateTime(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export function formatTime(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** Lagos calendar date (YYYY-MM-DD) of an instant. */
export function lagosDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** "08:00" -> "8:00am", "20:00" -> "8:00pm" */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

/** 125 -> "2:05" */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function variantLabel(size: string, colour: string): string {
  return [colour, size].filter(Boolean).join(" / ") || "One size";
}

export const METHOD_LABEL: Record<string, string> = { cash: "Cash", transfer: "Transfer", pos: "POS" };

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Read ?from=YYYY-MM-DD&to=YYYY-MM-DD, defaulting to today (Lagos, from the server). */
export function parseRange(sp: Record<string, string | string[] | undefined>, today: string) {
  const ok = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  let from = ok(sp.from) ? sp.from : today;
  let to = ok(sp.to) ? sp.to : from;
  if (to < from) [from, to] = [to, from];
  return { from, to };
}
