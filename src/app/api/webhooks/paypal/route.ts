import { NextResponse } from "next/server";
import { z } from "zod";
import { toBillingCycle, toPaidPlanKey } from "@/lib/billing/plans";
import { recordPaypalSubscription } from "@/lib/billing/store";
import { getSubscription, verifyWebhook } from "@/lib/paypal/client";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * PayPal's subscription webhooks — how an international customer's tier is
 * actually granted.
 *
 * THE SAME FOUR RULES AS THE RAZORPAY WEBHOOK, for the same reasons:
 *
 *   1. VERIFY BEFORE ACTING. This payload grants paid access, so an unverified
 *      one is an unauthenticated request to upgrade an account for free.
 *   2. IDENTITY FROM OUR OWN FIELD. The owner comes from `custom_id`, which we
 *      set at checkout, or from the subscription id we already stored — never
 *      from an arbitrary email in the body.
 *   3. THE PROVIDER IS THE SOURCE OF TRUTH. On an ambiguous event the
 *      subscription is re-read from PayPal rather than inferred from the
 *      payload, because a webhook can arrive out of order.
 *   4. ALWAYS 200 ONCE VERIFIED, even on internal failure. PayPal retries for
 *      three days, and a 500 on a bug we cannot fix in that window turns one
 *      broken row into thousands of retries.
 *
 * WHY VERIFICATION IS A ROUND TRIP rather than an HMAC: PayPal signs
 * asymmetrically over a certificate chain, and hand-rolling that check is a
 * place to be subtly wrong in a way that still returns true. See
 * `verifyWebhook` in the client.
 */

export const runtime = "nodejs";

const eventSchema = z.object({
  id: z.string().optional(),
  event_type: z.string(),
  resource: z
    .object({
      id: z.string().optional(),
      status: z.string().optional(),
      plan_id: z.string().optional(),
      custom_id: z.string().optional(),
      // On PAYMENT.SALE.COMPLETED the subscription id arrives here instead.
      billing_agreement_id: z.string().optional(),
      subscriber: z.object({ payer_id: z.string().optional() }).optional(),
      billing_info: z.object({ next_billing_time: z.string().optional() }).optional(),
    })
    .optional(),
});

/** Events that change a subscription's state. Everything else is ignored. */
const SUBSCRIPTION_EVENTS = new Set([
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.SUSPENDED",
  "BILLING.SUBSCRIPTION.EXPIRED",
  "BILLING.SUBSCRIPTION.UPDATED",
  "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
]);

export async function POST(request: Request) {
  // Rule 1: raw text, verified, and only then acted on.
  const rawBody = await request.text();

  const verified = await verifyWebhook({ headers: request.headers, rawBody });
  if (!verified) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }

  const parsed = eventSchema.safeParse(safeJson(rawBody));
  if (!parsed.success) {
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  const { event_type: eventType, resource } = parsed.data;

  try {
    if (SUBSCRIPTION_EVENTS.has(eventType) && resource?.id) {
      await handleSubscription(resource.id, resource.custom_id ?? null);
      return NextResponse.json({ ok: true });
    }

    /**
     * A successful recurring charge. The subscription id lives in
     * `billing_agreement_id` on this event, not `id` — `id` is the sale's own
     * id. Getting that wrong looks up a subscription that does not exist and
     * silently never extends anyone's period.
     */
    if (eventType === "PAYMENT.SALE.COMPLETED" && resource?.billing_agreement_id) {
      await handleSubscription(resource.billing_agreement_id, resource.custom_id ?? null);
      return NextResponse.json({ ok: true });
    }
  } catch (error) {
    // Rule 4. Logged rather than retried into a loop.
    console.error("[paypal webhook]", eventType, error);
    return NextResponse.json({ ok: true, failed: true });
  }

  // Something we do not act on. 200 so PayPal stops retrying.
  return NextResponse.json({ ok: true, ignored: eventType });
}

/**
 * Bring one subscription's row in line with PayPal.
 *
 * Rule 3: the subscription is RE-READ from PayPal rather than trusted from the
 * payload. Webhooks can arrive out of order — a CANCELLED delivered after a
 * retry could otherwise overwrite a state that has since moved on — and the
 * re-read also supplies `next_billing_time`, which several events omit.
 */
async function handleSubscription(
  subscriptionId: string,
  customId: string | null,
): Promise<void> {
  const ownerId = await resolveOwnerId(subscriptionId, customId);

  if (!ownerId) {
    // A subscription we have never seen — most likely created by hand in the
    // PayPal dashboard, or belonging to another environment. Nothing to do,
    // and inventing an owner would grant somebody else's plan.
    console.warn("[paypal webhook] no owner for subscription", subscriptionId);
    return;
  }

  const subscription = await getSubscription(subscriptionId);

  // The tier and cycle are not in PayPal's payload — it has no `notes`. They
  // come from the row written at checkout, so an update never overwrites them
  // with a guess.
  const existing = await createAdminClient()
    .from("subscriptions")
    .select("plan_key, billing_cycle")
    .eq("paypal_subscription_id", subscriptionId)
    .maybeSingle();

  await recordPaypalSubscription(
    ownerId,
    subscription,
    toPaidPlanKey(existing.data?.plan_key ?? "") ?? undefined,
    toBillingCycle(existing.data?.billing_cycle ?? "") ?? undefined,
  );
}

/**
 * Whose subscription this is.
 *
 * Two sources, in order of trust:
 *   1. The row we already wrote at checkout, found by subscription id.
 *   2. `custom_id`, which we set to the owner id when creating the
 *      subscription and PayPal echoes back unchanged.
 *
 * Both are OUR values. Nothing here trusts an email or a payer id from the
 * body — that would let anyone who can forge a payload name any account.
 */
async function resolveOwnerId(
  subscriptionId: string,
  customId: string | null,
): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("subscriptions")
    .select("owner_id")
    .eq("paypal_subscription_id", subscriptionId)
    .maybeSingle();

  if (data?.owner_id) return data.owner_id;

  // A uuid, or it did not come from us. Checked rather than assumed, because
  // this value is about to decide which account gets a paid tier.
  if (customId && /^[0-9a-f-]{36}$/i.test(customId)) return customId;

  return null;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
