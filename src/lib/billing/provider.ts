import type { BillingCycle, PaidPlanKey } from "@/lib/billing/plans";

/**
 * Which payment provider charges a given customer.
 *
 * Pure — no network, no env reads, no database — so the rule that decides who
 * can pay at all is unit tested rather than inferred from a checkout that
 * failed in production.
 *
 * THE SPLIT IS FORCED, not chosen. Each provider covers exactly the half the
 * other legally or technically cannot:
 *
 *   INDIA -> RAZORPAY. PayPal India business accounts have been export-only
 *   since April 2021 and cannot accept a domestic INR payment at all. Razorpay
 *   also reaches UPI Autopay, which is most of Indian digital payment volume
 *   (500M+ UPI users against ~95M credit cards).
 *
 *   EVERYONE ELSE -> PAYPAL. Razorpay needs International Payments approval
 *   for USD, and its own PayPal integration is a wallet that cannot hold a
 *   recurring mandate. PayPal's Subscriptions API does real autopay.
 *
 * So this is not a preference that can be flipped later without breaking one
 * side or the other.
 */
export type PaymentProvider = "razorpay" | "paypal";

/** ISO 3166-1 alpha-2 for India. The only country Razorpay serves here. */
export const INDIA = "IN";

/**
 * Pick the provider for a country code.
 *
 * UNKNOWN COUNTRY FALLS TO PAYPAL, deliberately. The country comes from a
 * geo-IP header that is absent on localhost, absent behind some proxies, and
 * wrong for anyone on a VPN. Defaulting to Razorpay would offer an Indian-only
 * checkout to a customer who may be anywhere; defaulting to PayPal offers a
 * checkout that works from every country including India (Indian cards do work
 * on PayPal — they are simply not the best path). The wrong guess is therefore
 * inconvenient rather than impossible, which is the right way round.
 *
 * `null` and `""` are treated the same as an unknown country.
 */
export function providerForCountry(country: string | null | undefined): PaymentProvider {
  if (!country) return "paypal";
  return country.trim().toUpperCase() === INDIA ? "razorpay" : "paypal";
}

/**
 * The env var holding a PayPal plan id, mirroring `PLAN_PRICES[].envVar`.
 *
 * NOTE THE `AGENCY`. The top tier is DISPLAYED as "Max" but its internal key
 * is still `agency`, because renaming it would orphan live subscriptions. Env
 * names follow the key, never the label — the same rule as the Razorpay ids.
 */
export function paypalPlanEnvVar(plan: PaidPlanKey, cycle: BillingCycle): string {
  return `PAYPAL_PLAN_ID_${plan.toUpperCase()}_${cycle.toUpperCase()}`;
}

/**
 * The country of the person checking out, from the platform's geo header.
 *
 * Vercel sets `x-vercel-ip-country`. Cloudflare sets `cf-ipcountry`. Both are
 * read because the domain sits behind Cloudflare DNS in front of Vercel, and
 * which one arrives depends on the proxy mode — trusting only one produced an
 * empty country in exactly the setup this app runs in.
 *
 * These headers are set by the PLATFORM and cannot be spoofed by the browser
 * on Vercel. Even so, nothing security-relevant hangs on the answer: it picks
 * a payment method, not an entitlement. The tier a customer receives always
 * comes from a verified webhook, never from a header.
 */
export function countryFromHeaders(headers: Headers): string | null {
  const country =
    headers.get("x-vercel-ip-country") ?? headers.get("cf-ipcountry") ?? null;

  // Cloudflare sends "XX" for unknown, and "T1" for Tor. Neither is a country.
  if (!country || country === "XX" || country === "T1") return null;
  return country.toUpperCase();
}
