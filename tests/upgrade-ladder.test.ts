import { describe, expect, it } from "vitest";
import {
  PAID_PLAN_KEYS,
  PLANS,
  plansAbove,
  toPaidPlanKey,
  type PaidPlanKey,
} from "@/lib/billing/plans";

/**
 * What a customer is allowed to be sold next.
 *
 * The workspace upgrade panel and the sidebar prompt both ask plansAbove(), so
 * this is the file that stops them drifting apart. The failure this guards is
 * specific and expensive: offering someone a tier they already pay for creates
 * a SECOND Razorpay mandate on the same card rather than moving the first, and
 * the customer is charged twice a month until they notice.
 *
 * Offering a CHEAPER tier is the same bug wearing a friendlier face — it reads
 * as a downgrade and behaves as a double charge, which is why the ladder here
 * is strictly upward and tested as such.
 */

describe("plansAbove", () => {
  it("offers every paid tier to someone on the free plan", () => {
    // Null is the free tier: nothing is paid for, so nothing is excluded.
    expect(plansAbove(null)).toEqual([...PAID_PLAN_KEYS]);
  });

  it("offers only the tiers above the current one", () => {
    // The case from the brief: on $19, they should see $45 and $89 only.
    expect(plansAbove("creator")).toEqual(["studio", "agency"]);
    expect(plansAbove("studio")).toEqual(["agency"]);
  });

  it("offers nothing at the top of the ladder", () => {
    // The panel reads this emptiness as "hide yourself" rather than rendering
    // a heading over an empty grid.
    expect(plansAbove("agency")).toEqual([]);
  });

  it("never offers the tier the customer is already paying for", () => {
    // The double-mandate bug, asserted directly rather than implied by the
    // cases above, because this is the one that costs a refund.
    for (const key of PAID_PLAN_KEYS) {
      expect(plansAbove(key)).not.toContain(key);
    }
  });

  it("never offers a cheaper tier than the current one", () => {
    for (const key of PAID_PLAN_KEYS) {
      const current = PLANS[key].priceCents;
      for (const offered of plansAbove(key)) {
        expect(PLANS[offered].priceCents).toBeGreaterThan(current);
      }
    }
  });

  it("returns tiers in ascending ladder order", () => {
    // The panel renders in array order and does not sort, so the order here is
    // the order on screen.
    for (const key of [...PAID_PLAN_KEYS, null]) {
      const offered = plansAbove(key as PaidPlanKey | null);
      const positions = offered.map((k) => PAID_PLAN_KEYS.indexOf(k));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it("falls back to the whole ladder for an unrecognised tier", () => {
    // A row written by an older deploy, or a hand-edited database. Showing
    // every upgrade is recoverable; showing none is a dead end for a paying
    // customer who cannot work out why the button vanished.
    expect(plansAbove("legacy_pro" as PaidPlanKey)).toEqual([...PAID_PLAN_KEYS]);
  });

  it("agrees with toPaidPlanKey about what a paid tier is", () => {
    // Two narrowing functions over the same set. If a tier is added to one and
    // not the other, the upgrade panel silently stops offering it.
    for (const key of PAID_PLAN_KEYS) {
      expect(toPaidPlanKey(key)).toBe(key);
    }
    expect(toPaidPlanKey("free")).toBeNull();
  });
});
