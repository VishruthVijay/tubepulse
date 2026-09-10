import { describe, expect, it } from "vitest";
import {
  countryFromHeaders,
  paypalPlanEnvVar,
  providerForCountry,
} from "@/lib/billing/provider";

/**
 * Which provider charges which customer.
 *
 * This decides whether somebody can pay at all, so the cases below are the ones
 * where getting it wrong is silent: an Indian customer sent to a PayPal-only
 * flow that legally cannot take their domestic payment, or an international one
 * sent to a Razorpay flow with no approved USD path.
 */
describe("providerForCountry", () => {
  it("sends India to Razorpay", () => {
    // PayPal India is export-only and cannot take a domestic INR payment.
    expect(providerForCountry("IN")).toBe("razorpay");
  });

  it("sends everyone else to PayPal", () => {
    for (const country of ["US", "GB", "DE", "AU", "SG", "AE", "CA"]) {
      expect(providerForCountry(country)).toBe("paypal");
    }
  });

  it("is case and whitespace insensitive", () => {
    // Headers are not guaranteed to arrive normalised.
    expect(providerForCountry("in")).toBe("razorpay");
    expect(providerForCountry(" In ")).toBe("razorpay");
  });

  describe("an unknown country", () => {
    /**
     * Falls to PayPal ON PURPOSE. Razorpay's checkout serves India only, so
     * guessing Razorpay for an unknown visitor can leave them unable to pay.
     * PayPal works from everywhere, including India — so the wrong guess is
     * merely suboptimal instead of a dead end.
     */
    it("falls back to PayPal rather than Razorpay", () => {
      expect(providerForCountry(null)).toBe("paypal");
      expect(providerForCountry(undefined)).toBe("paypal");
      expect(providerForCountry("")).toBe("paypal");
    });
  });
});

describe("countryFromHeaders", () => {
  const withHeaders = (init: Record<string, string>) => new Headers(init);

  it("reads Vercel's geo header", () => {
    expect(countryFromHeaders(withHeaders({ "x-vercel-ip-country": "IN" }))).toBe("IN");
  });

  it("reads Cloudflare's geo header", () => {
    // The domain sits behind Cloudflare DNS in front of Vercel, so which header
    // arrives depends on proxy mode. Reading only one produced an empty country.
    expect(countryFromHeaders(withHeaders({ "cf-ipcountry": "US" }))).toBe("US");
  });

  it("prefers Vercel's when both are present", () => {
    expect(
      countryFromHeaders(
        withHeaders({ "x-vercel-ip-country": "IN", "cf-ipcountry": "US" }),
      ),
    ).toBe("IN");
  });

  it("treats Cloudflare's unknown and Tor markers as no country", () => {
    // "XX" and "T1" are not countries, and uppercasing them would produce a
    // confident wrong answer rather than a fallback.
    expect(countryFromHeaders(withHeaders({ "cf-ipcountry": "XX" }))).toBeNull();
    expect(countryFromHeaders(withHeaders({ "cf-ipcountry": "T1" }))).toBeNull();
  });

  it("returns null when no geo header is present, as on localhost", () => {
    expect(countryFromHeaders(withHeaders({}))).toBeNull();
  });

  it("uppercases a lowercase header value", () => {
    expect(countryFromHeaders(withHeaders({ "cf-ipcountry": "gb" }))).toBe("GB");
  });

  it("routes an unknown country to PayPal end to end", () => {
    const country = countryFromHeaders(withHeaders({}));
    expect(providerForCountry(country)).toBe("paypal");
  });
});

describe("paypalPlanEnvVar", () => {
  it("builds the variable name for each tier and cycle", () => {
    expect(paypalPlanEnvVar("creator", "monthly")).toBe("PAYPAL_PLAN_ID_CREATOR_MONTHLY");
    expect(paypalPlanEnvVar("studio", "yearly")).toBe("PAYPAL_PLAN_ID_STUDIO_YEARLY");
  });

  it("uses the INTERNAL key for the top tier, not its label", () => {
    // The tier is displayed as "Max" but its key is still `agency`, because
    // renaming it would orphan live subscriptions. A variable named
    // PAYPAL_PLAN_ID_MAX_MONTHLY would silently never be found.
    expect(paypalPlanEnvVar("agency", "monthly")).toBe("PAYPAL_PLAN_ID_AGENCY_MONTHLY");
    expect(paypalPlanEnvVar("agency", "monthly")).not.toContain("MAX");
  });
});
