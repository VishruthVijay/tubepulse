/**
 * Config that is safe to ship to the browser.
 *
 * This file is deliberately separate from `env.ts`, which is `server-only` and
 * cannot be imported from a client component. Anything you add here ends up in
 * the client bundle: if it should not be on a billboard, it does not go here.
 *
 * The values must be referenced as full literals (`process.env.NEXT_PUBLIC_X`)
 * so that Next.js can inline them at build time.
 */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",

  /**
   * Razorpay's PUBLISHABLE key id (rzp_live_… / rzp_test_…).
   *
   * This one genuinely belongs in the browser: Razorpay's checkout script
   * cannot open without it. The secret half, RAZORPAY_KEY_SECRET, is what must
   * never leave the server — it lives in env.ts, which is `server-only`.
   */
  razorpayKeyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? "",

  /**
   * A PayPal link for customers Razorpay cannot charge yet. A URL, nothing
   * secret — a payment link is meant to be handed out.
   *
   * WHY THIS EXISTS, AND WHY IT IS NOT A SECOND CHECKOUT.
   *
   * Razorpay Subscriptions accepts CARDS, UPI AUTOPAY and EMANDATE — and
   * nothing else. PayPal is a wallet, and a wallet cannot hold a recurring
   * mandate, so PayPal can never be the subscription path however it is
   * connected on the Razorpay side. Verified against Razorpay's own
   * supported-payment-methods docs, 2026-09-09.
   *
   * What it CAN do is stop an international visitor hitting a dead end while
   * Razorpay's International Payments approval is pending. Without this, a
   * signed-in overseas customer presses "Choose Studio" and is sent to
   * /billing, where there is nothing they can pay with.
   *
   * So this is a MANUAL fallback, and the UI says so plainly rather than
   * dressing it up as instant access: they pay, it is reconciled by hand, the
   * tier is granted by hand. It is a bridge, not a billing system.
   *
   * Leave it UNSET and every trace of it disappears — which is exactly what
   * should happen the day International Payments is approved.
   */
  paypalLink: process.env.NEXT_PUBLIC_PAYPAL_LINK ?? "",
};

/** True when Supabase is configured. Lets the UI explain itself before setup. */
export const isSupabaseConfigured =
  publicEnv.supabaseUrl !== "" && publicEnv.supabaseAnonKey !== "";

/**
 * True when checkout can open at all. The browser only knows about the key id;
 * whether the SERVER has its secret and plan id is a separate question, and the
 * checkout route answers that one with requireBillingEnv().
 */
export const isCheckoutConfigured = publicEnv.razorpayKeyId !== "";

/**
 * True when a PayPal fallback should be offered.
 *
 * Deliberately independent of `isCheckoutConfigured`: the point is to cover
 * the case where Razorpay checkout CANNOT run. The UI only reaches for this
 * once the normal path is unavailable.
 */
export const isPaypalFallbackConfigured = publicEnv.paypalLink !== "";
