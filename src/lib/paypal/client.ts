import "server-only";
import { serverEnv } from "@/lib/env";

/**
 * PayPal, for international subscriptions.
 *
 * WHY PAYPAL AT ALL, given Razorpay is already here. Two hard limits meet in
 * the middle and leave exactly one shape that works:
 *
 *   * Razorpay Subscriptions accepts cards, UPI Autopay and eMandate. Its own
 *     PayPal integration is a WALLET, and a wallet cannot hold a recurring
 *     mandate — so PayPal-via-Razorpay cannot do autopay, however it is linked.
 *   * PayPal India business accounts are EXPORT-ONLY since April 2021 and
 *     cannot take a domestic INR payment.
 *
 * So: PayPal bills international customers directly through its own
 * Subscriptions API (which DOES do real recurring autopay), Razorpay bills
 * Indian ones. Neither can do the other's half.
 *
 * THE OBJECT MODEL, which is three levels deep and easy to get wrong:
 *
 *     Product  (what you sell)        -> created once
 *       Plan   (price + cycle)        -> one per tier-and-cycle, six total
 *         Subscription (one customer) -> created per checkout
 *
 * A plan hard-codes amount, currency AND interval, exactly like Razorpay's, so
 * six plan objects are needed and their ids live in env vars.
 *
 * MONEY IS A DECIMAL STRING HERE, not an integer of minor units. Razorpay takes
 * paise as an integer; PayPal takes `"19.00"`. Passing cents to PayPal would
 * charge 100x. `usdFromCents` is the only place that conversion happens.
 */

/** PayPal's two environments. Ids, secrets and plans are per-environment. */
function apiBase(): string {
  return serverEnv().PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

/**
 * Cents to PayPal's decimal string. `1900` -> `"19.00"`.
 *
 * The whole app stores money as integer cents precisely so no arithmetic ever
 * happens in floating point. This is the boundary where that has to become a
 * string, and it is the only place allowed to do it.
 */
export function usdFromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly debugId: string | null = null,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

/**
 * An access token, fetched per call rather than cached.
 *
 * PayPal tokens last ~9 hours, so caching looks tempting. It is not worth it
 * here: serverless instances are short-lived and shared-nothing, so a cache
 * would mostly miss, and a STALE token produces a 401 halfway through creating
 * a subscription — which is the one moment an extra 200ms is cheaper than an
 * ambiguous failure.
 */
async function accessToken(): Promise<string> {
  const env = serverEnv();
  const credentials = Buffer.from(
    `${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`,
  ).toString("base64");

  const response = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!response.ok) {
    // Names the environment, because the single most common cause is live
    // credentials against the sandbox host or the reverse, and the raw message
    // ("invalid_client") says nothing about which.
    throw new PayPalError(
      `PayPal rejected the credentials for the ${env.PAYPAL_ENV} environment.`,
      response.status,
    );
  }

  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new PayPalError("PayPal returned no access token.", response.status);
  }

  return json.access_token;
}

/** One authenticated call. Throws PayPalError with PayPal's own debug id. */
async function call<T>(
  path: string,
  init: { method: string; body?: unknown; requestId?: string },
): Promise<T> {
  const token = await accessToken();

  const response = await fetch(`${apiBase()}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // PayPal's idempotency key. A retried create must not produce a second
      // subscription — that would be a second mandate on the same card.
      ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });

  const text = await response.text();

  if (!response.ok) {
    // `paypal-debug-id` is what PayPal support asks for first. Losing it makes
    // an unexplained failure unresolvable.
    const debugId = response.headers.get("paypal-debug-id");
    let detail = text.slice(0, 300);

    try {
      const parsed = JSON.parse(text) as {
        message?: string;
        details?: { description?: string; issue?: string }[];
      };
      const issue = parsed.details?.[0];
      detail = issue?.description ?? issue?.issue ?? parsed.message ?? detail;
    } catch {
      // Not JSON — an HTML error page from a proxy. Keep the truncated text.
    }

    throw new PayPalError(detail, response.status, debugId);
  }

  return (text ? JSON.parse(text) : {}) as T;
}

export interface PayPalSubscription {
  id: string;
  status: string;
  plan_id?: string;
  subscriber?: { payer_id?: string };
  billing_info?: { next_billing_time?: string };
  links?: { href: string; rel: string; method?: string }[];
}

/**
 * Start a subscription. NOTHING IS CHARGED HERE.
 *
 * PayPal returns an `approve` link; the customer authorises the mandate there
 * and the webhook tells us it happened. Exactly the same shape as the Razorpay
 * path, so `/api/billing/checkout` can treat the two symmetrically.
 *
 * `custom_id` carries our owner id through to every webhook. PayPal echoes it
 * back on the subscription and on each payment, which is what lets a webhook
 * with no session find the right user — the same job Razorpay's `notes` do.
 */
export async function createSubscription({
  planId,
  ownerId,
  returnUrl,
  cancelUrl,
  requestId,
}: {
  planId: string;
  ownerId: string;
  returnUrl: string;
  cancelUrl: string;
  requestId: string;
}): Promise<PayPalSubscription> {
  return call<PayPalSubscription>("/v1/billing/subscriptions", {
    method: "POST",
    requestId,
    body: {
      plan_id: planId,
      custom_id: ownerId,
      application_context: {
        brand_name: "TubePulse",
        // The customer already has a TubePulse account, so asking them to
        // re-enter a shipping address would be asking for something we neither
        // need nor store.
        shipping_preference: "NO_SHIPPING",
        // Finish the mandate in one step rather than returning them to a second
        // "confirm" screen they have already effectively agreed to.
        user_action: "SUBSCRIBE_NOW",
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    },
  });
}

/** Read one subscription. The sync path, and the truth after an approval. */
export async function getSubscription(id: string): Promise<PayPalSubscription> {
  return call<PayPalSubscription>(`/v1/billing/subscriptions/${id}`, {
    method: "GET",
  });
}

/**
 * Cancel at PayPal. Idempotent from our side: cancelling an already-cancelled
 * subscription returns 422, which the caller treats as success, because the
 * end state the user asked for is the one they now have.
 */
export async function cancelSubscription(id: string, reason: string): Promise<void> {
  await call<void>(`/v1/billing/subscriptions/${id}/cancel`, {
    method: "POST",
    body: { reason: reason.slice(0, 127) },
  });
}

/**
 * Verify a webhook came from PayPal.
 *
 * PayPal signs asymmetrically (SHA256withRSA over a certificate chain), NOT
 * with an HMAC of a shared secret the way Razorpay and Apify do. Verifying that
 * locally means fetching and validating their certificate, checking the chain,
 * and computing a CRC32 of the raw body — every step of which is a place to be
 * subtly wrong in a way that still returns `true`.
 *
 * So this posts the transmission back to PayPal and lets THEM verify it. It
 * costs a round trip and removes an entire class of silent security bug.
 *
 * A webhook that fails this must be rejected, not merely logged: the payload
 * grants paid access, so an unverified one is an unauthenticated request to
 * upgrade an account for free.
 */
export async function verifyWebhook({
  headers,
  rawBody,
}: {
  headers: Headers;
  rawBody: string;
}): Promise<boolean> {
  const env = serverEnv();
  if (env.PAYPAL_WEBHOOK_ID === "") return false;

  const transmissionId = headers.get("paypal-transmission-id");
  const transmissionTime = headers.get("paypal-transmission-time");
  const transmissionSig = headers.get("paypal-transmission-sig");
  const certUrl = headers.get("paypal-cert-url");
  const authAlgo = headers.get("paypal-auth-algo");

  // A missing header means this did not come from PayPal at all.
  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
    return false;
  }

  /**
   * `webhook_event` must be the PARSED body, not the raw string — PayPal
   * re-serialises it their side. This is also why the caller reads the raw body
   * first: it is needed verbatim for nothing here, but reading the stream twice
   * is impossible, so the parse happens once and both uses share it.
   */
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return false;
  }

  try {
    const result = await call<{ verification_status?: string }>(
      "/v1/notifications/verify-webhook-signature",
      {
        method: "POST",
        body: {
          auth_algo: authAlgo,
          cert_url: certUrl,
          transmission_id: transmissionId,
          transmission_sig: transmissionSig,
          transmission_time: transmissionTime,
          webhook_id: env.PAYPAL_WEBHOOK_ID,
          webhook_event: event,
        },
      },
    );

    return result.verification_status === "SUCCESS";
  } catch {
    // A failure to REACH the verifier is not a verified webhook. Fail closed.
    return false;
  }
}
