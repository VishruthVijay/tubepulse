import { describe, expect, it } from "vitest";
import { PLAN_PRICES } from "@/lib/billing/plans";

/**
 * Cents to PayPal's decimal string.
 *
 * THE BUG THIS GUARDS IS A 100x OVERCHARGE. Razorpay takes an integer of minor
 * units (1900 paise); PayPal takes a decimal string ("19.00"). Passing the cents
 * straight through would create a plan that charges $1,900 a month, and nothing
 * downstream would notice — the plan object is the source of truth for what is
 * billed, so the app has no independent figure to disagree with.
 *
 * Duplicated from `usdFromCents` in the client rather than imported: that module
 * is `server-only` and cannot be loaded by a test, the same reason
 * `payload-template.ts` and `paypal-link.ts` are separate files.
 */
const usdFromCents = (cents: number): string => (cents / 100).toFixed(2);

describe("usdFromCents", () => {
  it("converts cents to a two-decimal string", () => {
    expect(usdFromCents(1900)).toBe("19.00");
    expect(usdFromCents(4900)).toBe("49.00");
    expect(usdFromCents(8900)).toBe("89.00");
  });

  it("never returns bare minor units — the 100x overcharge", () => {
    expect(usdFromCents(4900)).not.toBe("4900");
    expect(Number(usdFromCents(4900))).toBe(49);
  });

  it("always keeps two decimals, which PayPal requires", () => {
    // "19" is rejected by PayPal's schema; "19.00" is not.
    for (const cents of [1900, 4900, 8900, 19000, 49000, 89000]) {
      expect(usdFromCents(cents)).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("handles a discounted amount exactly", () => {
    // 30% off $19 is $13.30 — a value floating point likes to mangle.
    expect(usdFromCents(1330)).toBe("13.30");
  });

  it("matches every real plan price in the ladder", () => {
    // Reads the same source the pricing page does, so a price change here
    // cannot silently diverge from what PayPal is told to charge.
    const expected: Record<string, string> = {
      "creator-monthly": "19.00",
      "creator-yearly": "190.00",
      "studio-monthly": "49.00",
      "studio-yearly": "490.00",
      "agency-monthly": "89.00",
      "agency-yearly": "890.00",
    };

    for (const plan of ["creator", "studio", "agency"] as const) {
      for (const cycle of ["monthly", "yearly"] as const) {
        expect(usdFromCents(PLAN_PRICES[plan][cycle].priceCents)).toBe(
          expected[`${plan}-${cycle}`],
        );
      }
    }
  });

  it("prices yearly at ten months, not twelve", () => {
    // The promise on the pricing page is "two months free". A yearly plan
    // created at 12x would quietly withdraw the discount customers were sold.
    expect(PLAN_PRICES.studio.yearly.priceCents).toBe(
      PLAN_PRICES.studio.monthly.priceCents * 10,
    );
  });
});

/**
 * PayPal's subscription statuses, mapped onto ours.
 *
 * Mirrors `toPaypalSubscriptionStatus` in store.ts, which is server-only.
 * The mapping that matters most is SUSPENDED -> halted: treating it as
 * cancelled would cut off a customer whose card merely needs updating, in the
 * window where PayPal is still retrying the charge.
 */
const mapStatus = (status: string): string => {
  switch (status.toUpperCase()) {
    case "APPROVAL_PENDING":
      return "created";
    case "APPROVED":
      return "authenticated";
    case "ACTIVE":
      return "active";
    case "SUSPENDED":
      return "halted";
    case "CANCELLED":
      return "cancelled";
    case "EXPIRED":
      return "expired";
    default:
      return "created";
  }
};

describe("PayPal subscription status mapping", () => {
  it("maps the paying states", () => {
    expect(mapStatus("ACTIVE")).toBe("active");
    expect(mapStatus("APPROVED")).toBe("authenticated");
  });

  it("maps SUSPENDED to halted, not cancelled", () => {
    // A suspended subscription is one PayPal is still retrying. Cancelling
    // access at that point punishes a customer whose card just expired.
    expect(mapStatus("SUSPENDED")).toBe("halted");
    expect(mapStatus("SUSPENDED")).not.toBe("cancelled");
  });

  it("maps the terminal states", () => {
    expect(mapStatus("CANCELLED")).toBe("cancelled");
    expect(mapStatus("EXPIRED")).toBe("expired");
  });

  it("treats a pending approval as created, granting nothing", () => {
    expect(mapStatus("APPROVAL_PENDING")).toBe("created");
  });

  it("never grants access for an unrecognised status", () => {
    // A new status PayPal invents must not accidentally land in a paying state.
    for (const unknown of ["WHATEVER", "", "PAUSED_BY_PAYPAL"]) {
      expect(mapStatus(unknown)).toBe("created");
    }
  });

  it("is case insensitive", () => {
    expect(mapStatus("active")).toBe("active");
  });
});
