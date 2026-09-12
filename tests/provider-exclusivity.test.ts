import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * A subscription row must never carry two providers' ids at once.
 *
 * WHY THIS TEST EXISTS. A real row on the live database ended up as
 * `provider: 'paypal'` while still holding `razorpay_subscription_id`, because
 * the two upserts each wrote only their OWN ids and the upsert keys on
 * owner_id. The billing page reads `state.provider` to decide which gateway to
 * check, so it asked whether PayPal was configured on a rupee-only deploy and
 * told the customer five PAYPAL_* variables were missing.
 *
 * The 0016 constraint is supposed to make this impossible, but it exempts
 * `status = 'created'` — a row legitimately holds no id between checkout
 * opening and approval — and an abandoned checkout sits at 'created' forever.
 * So the database cannot be the only guard; the writes have to be exclusive
 * themselves. That is what these assertions pin.
 */

const upsert = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ upsert }) }),
}));

vi.mock("server-only", () => ({}));

const { recordSubscription, recordPaypalSubscription } = await import("@/lib/billing/store");

beforeEach(() => upsert.mockClear());

describe("a row belongs to exactly one provider", () => {
  it("recording a Razorpay subscription clears every PayPal id", async () => {
    await recordSubscription("owner-1", {
      id: "sub_live_1",
      status: "active",
      plan_id: "plan_x",
    } as never, "studio", "monthly");

    const row = upsert.mock.calls[0][0];
    expect(row.provider).toBe("razorpay");
    expect(row.razorpay_subscription_id).toBe("sub_live_1");
    // The half that actually regressed: nulls, not absent keys. An absent key
    // leaves the old value in place on an upsert, which is the whole bug.
    expect(row.paypal_subscription_id).toBeNull();
    expect(row.paypal_plan_id).toBeNull();
    expect(row.paypal_payer_id).toBeNull();
  });

  it("recording a PayPal subscription clears every Razorpay id", async () => {
    await recordPaypalSubscription("owner-1", {
      id: "I-LIVE1",
      status: "ACTIVE",
      plan_id: "P-x",
    } as never, "studio", "monthly");

    const row = upsert.mock.calls[0][0];
    expect(row.provider).toBe("paypal");
    expect(row.paypal_subscription_id).toBe("I-LIVE1");
    expect(row.razorpay_subscription_id).toBeNull();
    expect(row.razorpay_customer_id).toBeNull();
    expect(row.razorpay_plan_id).toBeNull();
  });

  it("switching provider on the same owner leaves no id from the old one", async () => {
    await recordSubscription("owner-1", {
      id: "sub_live_1", status: "active", plan_id: "plan_x",
    } as never, "studio", "monthly");
    await recordPaypalSubscription("owner-1", {
      id: "I-LIVE1", status: "ACTIVE", plan_id: "P-x",
    } as never, "studio", "monthly");

    // This is the exact shape the live row had: both ids, one provider.
    const second = upsert.mock.calls[1][0];
    expect(second.provider).toBe("paypal");
    expect(second.razorpay_subscription_id).toBeNull();
    expect(second.paypal_subscription_id).toBe("I-LIVE1");
  });
});
