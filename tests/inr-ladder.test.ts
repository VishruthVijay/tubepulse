import { describe, expect, it } from "vitest";
import { PLANS, PLAN_PRICES, perRunInr, formatInr } from "@/lib/billing/plans";

/**
 * The rupee ladder, pinned.
 *
 * `billing-status.test.ts` proves the ECONOMICS hold (margins, worst cases).
 * This file proves the NUMBERS are the agreed ones and the invariants between
 * them survive an edit — a price changed in one place and not another is the
 * failure mode that put "30 scrapes for Rs 399" on a page selling 15.
 *
 * The per-run test is the subtle one. The pricing page badges Studio "best
 * value", so Studio must genuinely cost less per run than Creator. Raising an
 * allowance without raising its price breaks that silently, and the badge
 * becomes a claim the arithmetic contradicts.
 */

describe("the INR ladder, end to end", () => {
  it("charges the agreed prices", () => {
    expect(PLANS.creator.priceInr).toBe(499);
    expect(PLANS.studio.priceInr).toBe(1299);
    expect(PLANS.agency.priceInr).toBe(3499);
    expect(PLANS.free.priceInr).toBe(0);
  });

  it("grants the agreed allowances", () => {
    expect(PLANS.free.runs).toBe(3);
    expect(PLANS.creator.runs).toBe(12);
    expect(PLANS.studio.runs).toBe(32);
    expect(PLANS.agency.runs).toBe(90);
  });

  it("keeps paise exactly 100x rupees on every tier and cycle", () => {
    for (const k of ["creator","studio","agency"] as const) {
      expect(PLANS[k].pricePaise).toBe(PLANS[k].priceInr * 100);
      for (const c of ["monthly","yearly"] as const) {
        expect(PLAN_PRICES[k][c].pricePaise).toBe(PLAN_PRICES[k][c].priceInr * 100);
      }
    }
  });

  it("prices yearly at ten months, not twelve", () => {
    for (const k of ["creator","studio","agency"] as const) {
      expect(PLAN_PRICES[k].yearly.priceInr).toBe(PLAN_PRICES[k].monthly.priceInr * 10);
    }
  });

  it("makes per-run price FALL as tiers rise, so 'best value' is true", () => {
    expect(perRunInr(PLANS.studio)).toBeLessThan(perRunInr(PLANS.creator));
    expect(perRunInr(PLANS.agency)).toBeLessThan(perRunInr(PLANS.studio));
  });

  it("caps daily spend below a third of the month on every tier", () => {
    for (const k of ["creator","studio","agency"] as const) {
      expect(PLANS[k].dailyCap * 3).toBeLessThan(PLANS[k].runs);
    }
  });

  it("formats with Indian grouping and the rupee sign", () => {
    expect(formatInr(PLANS.studio.priceInr)).toBe("₹1,299");
    expect(formatInr(PLAN_PRICES.agency.yearly.priceInr)).toBe("₹34,990");
  });

  it("never shows a dollar sign", () => {
    for (const k of ["creator","studio","agency"] as const) {
      expect(formatInr(PLANS[k].priceInr)).not.toContain("$");
    }
  });
});
