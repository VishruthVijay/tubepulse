"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PLANS,
  PLAN_PRICES,
  formatUsd,
  perMonthUsd,
  plansAbove,
  yearlySavingPercent,
  yearlySavingUsd,
  type BillingCycle,
  type PaidPlanKey,
} from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import { PromoDisclosure } from "./promo-disclosure";
import { PromoField, type AppliedPromo } from "./promo-field";
import { useUpgrade } from "./use-upgrade";

/**
 * Upgrading from inside the app: pick a tier and a cycle, optionally add a
 * code, pay.
 *
 * The workspace equivalent of the pricing page's plan cards, minus the
 * marketing. Same hook, same routes — only the styling differs, which is the
 * rule this project keeps re-learning about duplicated flows.
 *
 * Both numbers are always visible on the yearly option: what it works out at
 * per month, and the amount that actually leaves the account. Quoting only the
 * first is how someone expecting $40 gets a $490 debit.
 */
export function UpgradeChoice({
  canYearly,
  currentPlan = null,
  provider = "razorpay",
}: {
  canYearly: boolean;
  /** The tier they are on, so it is not offered back to them. */
  currentPlan?: PaidPlanKey | null;
  /** Which gateway this customer checks out through. Decided server-side. */
  provider?: "razorpay" | "paypal";
}) {
  /**
   * ONLY the tiers above the one they already pay for.
   *
   * Someone on Creator sees Studio and Max; someone on Max sees nothing and
   * this component renders nothing at all. Showing the current tier as a
   * disabled card was the old behaviour and it was worse than useless: it
   * spent a third of the panel advertising something they had already bought.
   *
   * The reason it must be a FILTER rather than a disabled state is that
   * Razorpay would happily create a SECOND mandate on the same card for the
   * same tier — two charges a month, and the customer finds out before we do.
   */
  const offered = plansAbove(currentPlan);

  // Default to the recommended tier when it is actually on offer, otherwise
  // the cheapest upgrade available — never a tier that is not rendered, which
  // would leave the pay button buying something invisible.
  const [plan, setPlan] = useState<PaidPlanKey>(
    () => offered.find((key) => key === "studio") ?? offered[0] ?? "studio",
  );
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [promo, setPromo] = useState<AppliedPromo | null>(null);
  const { busy, start } = useUpgrade();

  const price = PLAN_PRICES[plan][cycle];
  const options: BillingCycle[] = canYearly ? ["monthly", "yearly"] : ["monthly"];

  /**
   * A code is priced against ONE tier on ONE cycle, so changing either
   * invalidates it. Dropped rather than left showing a stale discount.
   */
  function changePlan(next: PaidPlanKey) {
    setPlan(next);
    setPromo(null);
  }

  function changeCycle(next: BillingCycle) {
    setCycle(next);
    setPromo(null);
  }

  // Already on the top tier: there is nothing to sell, so the panel removes
  // itself rather than showing a heading above an empty grid. The billing page
  // decides what to say in its place.
  if (offered.length === 0) return null;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-[0.68rem] tracking-[0.18em] uppercase">
        {currentPlan ? "Upgrade your plan" : "Choose a plan"}
      </p>

      <div
        className={cn(
          "grid gap-3",
          offered.length >= 3
            ? "sm:grid-cols-3"
            : offered.length === 2
              ? "sm:grid-cols-2"
              : "sm:grid-cols-1",
        )}
      >
        {offered.map((key) => {
          const option = PLANS[key];
          const selected = plan === key;

          return (
            <button
              key={key}
              type="button"
              onClick={() => changePlan(key)}
              aria-pressed={selected}
              className={cn(
                "rounded-xl border p-4 text-left transition-colors",
                "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                "disabled:cursor-not-allowed disabled:opacity-50",
                selected
                  ? "border-[var(--brand-2)] bg-[var(--brand-2)]/5"
                  : "border-border/60 hover:bg-muted/30",
              )}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{option.name}</span>
              </span>

              <span className="mt-2 block text-xl font-semibold tabular-nums">
                {formatUsd(option.priceUsd)}
                <span className="text-muted-foreground ml-1 text-xs font-normal">
                  /mo
                </span>
              </span>

              <span className="text-muted-foreground/70 mt-1 block text-xs">
                {option.runs} runs a month
              </span>
            </button>
          );
        })}
      </div>

      {canYearly && (
        <div className="grid gap-3 sm:grid-cols-2">
          {options.map((option) => {
            const optionPrice = PLAN_PRICES[plan][option];
            const selected = cycle === option;

            return (
              <button
                key={option}
                type="button"
                onClick={() => changeCycle(option)}
                aria-pressed={selected}
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors",
                  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                  selected
                    ? "border-[var(--brand-2)] bg-[var(--brand-2)]/5"
                    : "border-border/60 hover:bg-muted/30",
                )}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">
                    {option === "monthly" ? "Monthly" : "Yearly"}
                  </span>
                  {option === "yearly" && (
                    <span className="text-xs font-medium text-[var(--brand-2)]">
                      save {yearlySavingPercent()}%
                    </span>
                  )}
                </span>

                <span className="mt-2 block text-xl font-semibold tabular-nums">
                  {formatUsd(Math.round(perMonthUsd(optionPrice) * 100) / 100)}
                  <span className="text-muted-foreground ml-1 text-xs font-normal">
                    /month
                  </span>
                </span>

                <span className="text-muted-foreground/70 mt-1 block text-xs">
                  {option === "yearly"
                    ? `${formatUsd(optionPrice.priceUsd)} once a year`
                    : `${formatUsd(optionPrice.priceUsd)} every month`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {promo && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--brand-2)]">
            {promo.label} applied — {formatUsd(promo.originalCents / 100)} →{" "}
            <strong>{formatUsd(promo.finalCents / 100)}</strong>
            {/* How many cycles, read from the code itself rather than assumed.
                Hardcoding "your first month" here silently misdescribed a
                two-month promo as a one-month one. */}
            {promo.cyclesCovered === null
              ? ""
              : promo.cyclesCovered === 1
                ? ` on your first ${cycle === "yearly" ? "year" : "month"}.`
                : ` for your first ${promo.cyclesCovered} ${
                    cycle === "yearly" ? "years" : "months"
                  }.`}
          </p>

          {/* The full before/after breakdown. Not optional and not dim: this
              is what makes taking a card before the price rises an informed
              agreement rather than a surprise. */}
          <PromoDisclosure
            cyclesCovered={promo.cyclesCovered}
            discountedCents={promo.finalCents}
            renewsAtCents={promo.renewsAtCents ?? price.priceCents}
            cycle={cycle}
          />
        </div>
      )}

      {/*
        SWITCHING TIER IS NOT AN EDIT — it is a new mandate.

        Razorpay hard-codes the amount into the plan object, so moving from
        Creator to Studio cannot change the existing mandate's price. The old
        mandate has to stop and a new one start. Saying so here, before the
        button, is the difference between an informed switch and a customer
        discovering on their statement that two things happened.

        The checkout route refuses outright while a subscription is active, so
        without this notice the button would simply return an error the
        customer could do nothing about.
      */}
      {currentPlan && (
        <div className="border-border/60 bg-muted/30 space-y-2 rounded-lg border px-3 py-3">
          <p className="text-xs leading-relaxed">
            <strong>Moving from {PLANS[currentPlan].name} to {PLANS[plan].name}.</strong>{" "}
            Your {PLANS[currentPlan].name} mandate has to be cancelled before the
            new one can start — Razorpay fixes the amount to the plan, so it
            cannot simply be changed.
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            You keep {PLANS[currentPlan].name} until the period you have already
            paid for runs out. Nothing is charged twice, and the new plan is set
            up in the same window.
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Cancel {PLANS[currentPlan].name} on the button below this panel
            first, then come back and start {PLANS[plan].name}.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Button
          type="button"
          disabled={busy || Boolean(currentPlan)}
          onClick={() => start({ plan, cycle, promoCode: promo?.code, provider })}
        >
          {busy && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
          {busy
            ? "Opening Razorpay…"
            : `Get ${PLANS[plan].name} — ${formatUsd(
                (promo ? promo.finalCents : price.priceCents) / 100,
              )}${cycle === "yearly" ? "/yr" : "/mo"}`}
        </Button>

        <PromoField
          target="subscription"
          plan={plan}
          cycle={cycle}
          applied={promo}
          onApplied={setPromo}
          disabled={busy}
        />
      </div>

      {canYearly && cycle === "yearly" && (
        <p className="text-muted-foreground/70 text-xs">
          Twelve months for the price of ten — {formatUsd(yearlySavingUsd(plan))} less
          than paying monthly. Charged once, then again next year.
        </p>
      )}
    </div>
  );
}
