import { NextResponse } from "next/server";
import { billingStateFrom, formatDate } from "@/lib/billing/status";
import { markCancelling, recordPaypalSubscription, recordSubscription } from "@/lib/billing/store";
import { cancelSubscription, RazorpayError } from "@/lib/razorpay/client";
import {
  cancelSubscription as cancelPaypalSubscription,
  getSubscription as getPaypalSubscription,
  PayPalError,
} from "@/lib/paypal/client";
import { createServerClient } from "@/lib/supabase/server";

/**
 * POST /api/billing/cancel — stop the autopay mandate.
 *
 * The order of operations is the whole point. Razorpay is cancelled FIRST, and
 * only if that succeeds is the local row updated. Doing it the other way round
 * produces the worst possible bug in a billing system: an app that says
 * "cancelled" while the customer's UPI mandate keeps taking ₹499 every month.
 *
 * Cancellation is at the end of the paid cycle, not immediate. The pricing page
 * promises "you keep Pro until the period you already paid for runs out", and
 * cutting access on the 2nd for a month billed on the 1st would be taking money
 * for nothing.
 */

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const { data: row } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("owner_id", user.id)
    .maybeSingle();

  const state = billingStateFrom(row ?? null);

  // EITHER provider's id. Checking only Razorpay's meant a PayPal customer was
  // told there was nothing to cancel while still being charged every month.
  if (!row || !(state.razorpaySubscriptionId ?? state.paypalSubscriptionId)) {
    return NextResponse.json(
      { error: "There is no subscription to cancel." },
      { status: 404 },
    );
  }

  if (!state.canCancel) {
    return NextResponse.json(
      {
        error: state.cancelAtPeriodEnd
          ? "This subscription is already set to cancel."
          : "This subscription is not active.",
      },
      { status: 409 },
    );
  }

  /**
   * PAYPAL CANCELS DIFFERENTLY, and the difference matters.
   *
   * Razorpay's cancel returns the updated subscription, so the row can be
   * rewritten from the response. PayPal's returns 204 No Content, so the
   * subscription has to be re-read to learn when the paid period actually
   * ends — and that date is what the customer is promised on screen.
   */
  if (state.provider === "paypal" && state.paypalSubscriptionId) {
    try {
      await cancelPaypalSubscription(
        state.paypalSubscriptionId,
        "Cancelled from the TubePulse billing page.",
      );
    } catch (error) {
      const message =
        error instanceof PayPalError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Could not reach PayPal.";
      return NextResponse.json(
        { error: `PayPal refused the cancellation: ${message}` },
        { status: 502 },
      );
    }

    // Re-read rather than assume. If this fails the mandate is still stopped,
    // so the stored period end is used and the cancellation is not lost.
    let endsAt = row.current_period_end;
    try {
      const fresh = await getPaypalSubscription(state.paypalSubscriptionId);
      await recordPaypalSubscription(user.id, fresh);
      endsAt = fresh.billing_info?.next_billing_time ?? endsAt;
    } catch {
      // Nothing to do — the cancel itself succeeded, which is what matters.
    }

    await markCancelling(user.id, endsAt);

    return NextResponse.json({
      ok: true,
      endsAt,
      message: endsAt
        ? `Cancelled. Autopay is off and you keep your plan until ${formatDate(endsAt)}.`
        : "Cancelled. Autopay is off at PayPal.",
    });
  }

  let cancelled;
  try {
    cancelled = await cancelSubscription(state.razorpaySubscriptionId!);
  } catch (error) {
    const message =
      error instanceof RazorpayError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Could not reach Razorpay.";
    return NextResponse.json(
      { error: `Razorpay refused the cancellation: ${message}` },
      { status: 502 },
    );
  }

  // Razorpay has stopped the mandate. Now our row can safely agree.
  const endsAt = cancelled.current_end ?? row.current_period_end;
  await recordSubscription(user.id, cancelled);
  await markCancelling(user.id, endsAt);

  return NextResponse.json({
    ok: true,
    endsAt,
    message: endsAt
      ? `Cancelled. Autopay is off and you keep Pro until ${formatDate(endsAt)}.`
      : "Cancelled. Autopay is off at Razorpay.",
  });
}
