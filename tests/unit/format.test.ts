import { describe, expect, it } from "vitest";
import { friendlyError } from "@/lib/errors";
import { addDays, formatClock, formatCountdown, formatDateTime, formatNaira, lagosDate, parseNaira, variantLabel } from "@/lib/format";
import { receiptText, whatsappNumber } from "@/lib/receipt";

describe("money", () => {
  it("formats naira like ₦12,500", () => {
    expect(formatNaira(12500)).toBe("₦12,500");
    expect(formatNaira(0)).toBe("₦0");
    expect(formatNaira(1250000)).toBe("₦1,250,000");
    expect(formatNaira(-500)).toBe("-₦500");
  });
  it("parses typed amounts", () => {
    expect(parseNaira("12,500")).toBe(12500);
    expect(parseNaira("₦ 8000")).toBe(8000);
    expect(parseNaira("12.5")).toBeNull();
    expect(parseNaira("")).toBeNull();
    expect(parseNaira("abc")).toBeNull();
  });
});

describe("time is always Lagos", () => {
  it("formats in Africa/Lagos regardless of the machine time zone", () => {
    // 19:30 UTC = 20:30 in Lagos
    expect(formatDateTime("2026-11-07T19:30:00Z")).toContain("20:30");
    expect(lagosDate(new Date("2026-11-07T23:30:00Z"))).toBe("2026-11-08");
  });
  it("formats clock and countdown", () => {
    expect(formatClock("08:00")).toBe("8:00am");
    expect(formatClock("20:00")).toBe("8:00pm");
    expect(formatClock("12:30")).toBe("12:30pm");
    expect(formatClock("00:15")).toBe("12:15am");
    expect(formatCountdown(599)).toBe("9:59");
    expect(formatCountdown(-3)).toBe("0:00");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("labels & errors", () => {
  it("variant labels", () => {
    expect(variantLabel("M", "Red")).toBe("Red / M");
    expect(variantLabel("", "")).toBe("One size");
    expect(variantLabel("XL", "")).toBe("XL");
  });
  it("maps database errors to plain words", () => {
    expect(friendlyError({ message: "STORE_CLOSED" }).code).toBe("STORE_CLOSED");
    expect(friendlyError({ message: "INSUFFICIENT_STOCK: Red gown (only 1 left)" }).message).toBe(
      "Not enough stock: Red gown (only 1 left)",
    );
    expect(friendlyError({ message: "TypeError: Failed to fetch" }).code).toBe("OFFLINE");
    expect(friendlyError({ message: "TypeError: Failed to fetch" }).message).toMatch(/No internet – sale not saved/);
  });
});

describe("receipt sharing", () => {
  it("turns Nigerian numbers into WhatsApp numbers", () => {
    expect(whatsappNumber("0803 123 4567")).toBe("2348031234567");
    expect(whatsappNumber("+234 803 123 4567")).toBe("2348031234567");
    expect(whatsappNumber("12")).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
  });
  it("builds a text receipt headed IfeCollection", () => {
    const t = receiptText({
      id: "1", receipt_no: "IFE-261107-0001", created_at: "2026-11-07T10:00:00Z", total: 25000, status: "completed",
      void_reason: null, customer_name: null, customer_phone: null, staff_name: "Amaka",
      items: [{ product_name: "Ankara gown", size: "M", colour: "Red", unit_price: 12500, qty: 2, line_total: 25000 }],
      payments: [{ method: "cash", amount: 25000, reference: null }],
      store: { phone: null, address: null, footer: "Thank you!" },
    });
    expect(t.split("\n")[0]).toBe("*IfeCollection*");
    expect(t).toContain("2 × Ankara gown (Red / M) – ₦25,000");
    expect(t).toContain("Served by: Amaka");
  });
});
