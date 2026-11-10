// Turn database error codes (raised in our SQL functions) into plain words for shop staff.

export type FriendlyError = { code: string; message: string };

const MESSAGES: Record<string, string> = {
  STORE_CLOSED: "IfeCollection is closed now. Sales cannot be recorded.",
  ACCOUNT_INACTIVE: "Your account is turned off. Please ask the admin.",
  SESSION_REPLACED: "Your account was used to log in on another device. Please log in again.",
  NOT_AUTHENTICATED: "Please log in again.",
  OPENING_COUNT_REQUIRED: "Count the stock first. Sales start after your opening count.",
  DAY_CLOSED: "You have closed for today (closing count done). No more sales until tomorrow's count.",
  COUNT_INCOMPLETE: "Some items are not counted yet. Count every item before submitting.",
  COUNT_ALREADY_DONE: "This count was already submitted.",
  COUNT_NOT_FOUND: "This count is not available any more. Open the Count page again.",
  NOTHING_TO_RESOLVE: "This item has no difference to fix.",
  ALREADY_RESOLVED: "This difference was already handled.",
  ADMIN_ONLY: "Only the admin can do this.",
  EMPTY_CART: "The cart is empty.",
  INVALID_ITEM: "Something is wrong with an item in the cart. Remove it and add it again.",
  VARIANT_NOT_FOUND: "One item no longer exists. Remove it from the cart.",
  PRODUCT_UNAVAILABLE: "One item is no longer for sale.",
  INSUFFICIENT_STOCK: "Not enough stock.",
  PRICE_CHANGED: "A price has changed. Check the new total and try again.",
  PAYMENT_REQUIRED: "Choose how the customer paid.",
  PAYMENT_MISMATCH: "The payment amounts must add up to the total.",
  INVALID_PAYMENT: "Check the payment amounts.",
  IDEMPOTENCY_KEY_REQUIRED: "Please try again.",
  REASON_REQUIRED: "Please type a reason.",
  ALREADY_VOIDED: "This sale was already voided.",
  SALE_NOT_FOUND: "Sale not found.",
  INVALID_QTY: "Enter a valid quantity.",
  NAME_REQUIRED: "Enter the product name.",
  INVALID_PRICE: "Enter a valid price.",
  VARIANTS_REQUIRED: "Add at least one size or colour.",
  INVALID_RANGE: "Choose a valid date range.",
  OFFLINE: "No internet – sale not saved. Your cart is kept; try again when you are online.",
};

export function friendlyError(err: unknown): FriendlyError {
  const raw =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "";
  if (isNetworkError(err)) return { code: "OFFLINE", message: MESSAGES.OFFLINE };
  const match = raw.match(/^([A-Z_]{4,})(?::\s*(.*))?$/);
  if (match && MESSAGES[match[1]]) {
    const detail = match[2];
    const base = MESSAGES[match[1]];
    return { code: match[1], message: detail && match[1] === "INSUFFICIENT_STOCK" ? `Not enough stock: ${detail}` : base };
  }
  if (/permission denied|JWT|row-level security/i.test(raw)) {
    return { code: "FORBIDDEN", message: "You are not allowed to do this. Please log in again." };
  }
  return { code: "UNKNOWN", message: raw || "Something went wrong. Please try again." };
}

export function isNetworkError(err: unknown): boolean {
  const msg = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "";
  return (
    (typeof navigator !== "undefined" && navigator.onLine === false) ||
    /Failed to fetch|NetworkError|Load failed|network request failed|fetch failed|ERR_INTERNET/i.test(msg)
  );
}
