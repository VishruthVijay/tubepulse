import { describe, expect, it } from "vitest";
import { paypalHref } from "@/lib/billing/paypal-link";

/**
 * The PayPal fallback link.
 *
 * This decides the AMOUNT a customer is asked for, so the cases that matter
 * are the ones where the amount silently goes missing or comes out wrong —
 * a customer paying $4.90 instead of $49.00 would not be caught by anything
 * else in the stack, because the payment happens off-site.
 */
describe("paypalHref", () => {
  const STUDIO_CENTS = 4900;

  describe("paypal.me links, where the amount is a path segment", () => {
    it("appends the amount to the path", () => {
      const href = paypalHref("https://paypal.me/vishruth", "Studio", STUDIO_CENTS, "monthly");
      expect(href).toBe("https://paypal.me/vishruth/49.00");
    });

    it("does not double the slash when the link has a trailing one", () => {
      const href = paypalHref("https://paypal.me/vishruth/", "Studio", STUDIO_CENTS, "monthly");
      expect(href).toBe("https://paypal.me/vishruth/49.00");
      expect(href).not.toContain("//49");
    });

    it("covers the www. form rather than treating it as a hosted link", () => {
      const href = paypalHref("https://www.paypal.me/vishruth", "Creator", 1900, "monthly");
      expect(href).toBe("https://www.paypal.me/vishruth/19.00");
    });

    it("never puts the amount in the query for a paypal.me link", () => {
      const href = paypalHref("https://paypal.me/vishruth", "Studio", STUDIO_CENTS, "monthly");
      expect(href).not.toContain("amount=");
    });
  });

  describe("hosted PayPal links, where the amount is a query parameter", () => {
    it("sets the amount and a readable note", () => {
      const url = new URL(
        paypalHref(
          "https://www.paypal.com/paypalme/x?country.x=IN",
          "Studio",
          STUDIO_CENTS,
          "monthly",
        ),
      );
      expect(url.searchParams.get("amount")).toBe("49.00");
      expect(url.searchParams.get("item_name")).toBe("TubePulse Studio (monthly)");
    });

    it("keeps parameters the link already carried", () => {
      const url = new URL(
        paypalHref("https://example.com/pay?business=me", "Creator", 1900, "monthly"),
      );
      expect(url.searchParams.get("business")).toBe("me");
      expect(url.searchParams.get("amount")).toBe("19.00");
    });

    it("overwrites a stale amount rather than appending a second one", () => {
      const href = paypalHref("https://example.com/pay?amount=1.00", "Max", 8900, "monthly");
      expect(href.match(/amount=/g)).toHaveLength(1);
      expect(new URL(href).searchParams.get("amount")).toBe("89.00");
    });
  });

  describe("the amount itself", () => {
    it("converts cents to a two-decimal amount", () => {
      // The bug this guards: passing cents straight through would ask for
      // $4900.00, and dividing without fixing the decimals would send "49".
      expect(paypalHref("https://paypal.me/x", "Studio", 4900, "monthly")).toContain("/49.00");
    });

    it("carries the yearly price, not the monthly one", () => {
      // Yearly is ten months' money — the caller passes the cycle's own cents.
      expect(paypalHref("https://paypal.me/x", "Studio", 49000, "yearly")).toContain("/490.00");
    });

    it("keeps a discounted amount exact", () => {
      // 30% off $19 is $13.30 — a value that floating point likes to mangle.
      expect(paypalHref("https://paypal.me/x", "Creator", 1330, "monthly")).toContain("/13.30");
    });
  });

  describe("a link that cannot be parsed", () => {
    it("is returned untouched rather than throwing inside a render", () => {
      expect(paypalHref("not a url", "Studio", STUDIO_CENTS, "monthly")).toBe("not a url");
    });

    it("survives an empty link", () => {
      expect(paypalHref("", "Studio", STUDIO_CENTS, "monthly")).toBe("");
    });
  });
});
