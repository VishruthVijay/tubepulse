-- ============================================================================
-- 0017_inr_launch_code.sql — one launch code, one flat rate, in rupees
--
-- Pricing moved from USD to INR (see the header of src/lib/billing/plans.ts).
-- The launch codes moved with it, and the shape changed:
--
--   BEFORE  QUEEN30 + LAUNCH30, tiered 30/40/50% by plan
--   AFTER   LAUNCH20, a flat 20% on every tier
--
-- WHY FLAT, AND WHY 20. At rupee prices the tiered version took Max to roughly
-- 30% worst-case margin, which is too thin for a tier whose per-run costs are
-- real (it runs the premium model on the largest allowance). A flat 20% leaves
-- 76/54/52% across the ladder. It is also one sentence to explain instead of
-- three, which matters for a code that gets pasted into DMs.
--
-- WHY ONE CODE. Two codes meant two sets of Razorpay offers to create and keep
-- in step — six objects, each needing its own cycle limit. One code halves that
-- and removes the "which code do I send this person" question entirely.
--
-- QUEEN30 is renamed rather than deleted, so any redemption history follows the
-- row. LAUNCH30 is deactivated rather than deleted for the same reason: a
-- deleted promo row orphans its redemptions, and a code someone has already
-- been given should fail closed, not vanish into "that code does not exist".
--
-- ============ THE TRAP, RESTATED, BECAUSE IT COSTS REAL MONEY ============
-- A Razorpay Offer discounts EVERY cycle of a subscription unless it is created
-- with an explicit cycle limit. This code promises TWO discounted monthly
-- cycles. Three offers are needed (one per tier) and every one needs a limit of
-- 2. Miss one and that tier's discount runs forever for everyone who used it,
-- with no way to claw it back from a live mandate.
--
-- The app cannot enforce the cycle limit — Razorpay does not report it in a way
-- checkout can verify. What it CAN do, and does, is refuse any subscription
-- code whose tier has no offer id (`promo.ts`), so a half-finished activation
-- fails loudly instead of quietly overcharging.
-- ============================================================================

-- QUEEN30 -> LAUNCH20, flat 20%, and the rupee-era renewal price.
update public.promo_codes
   set code           = 'LAUNCH20',
       value          = 20,
       tier_percents  = '{"creator":20,"studio":20,"agency":20}'::jsonb,
       -- Cleared deliberately: any offer ids here were created for the USD
       -- plans and point at objects that no longer price anything correctly.
       tier_offer_ids = null,
       active         = false,
       description    = 'Launch invite. 20% off the first two monthly cycles.'
 where code = 'QUEEN30'
   and not exists (select 1 from public.promo_codes where code = 'LAUNCH20');

-- If QUEEN30 was never applied (the rename in 0015 did not run), fall back to
-- converting LAUNCH30 instead, so this migration works from either state.
update public.promo_codes
   set code           = 'LAUNCH20',
       value          = 20,
       tier_percents  = '{"creator":20,"studio":20,"agency":20}'::jsonb,
       tier_offer_ids = null,
       active         = false,
       description    = 'Launch invite. 20% off the first two monthly cycles.'
 where code = 'LAUNCH30'
   and not exists (select 1 from public.promo_codes where code = 'LAUNCH20');

-- Any other launch-era code is retired rather than left live at a USD rate.
update public.promo_codes
   set active      = false,
       description = coalesce(description, '') || ' (retired: USD-era pricing)'
 where code in ('QUEEN30', 'LAUNCH30', 'LAUNCH', 'FOUNDER')
   and code <> 'LAUNCH20';

-- Seed LAUNCH20 if none of the above found a row to rename.
insert into public.promo_codes (
  code, kind, value, scope, tier_percents, applies_to_cycles,
  active, starts_at, expires_at, max_redemptions, repeatable, description
)
select
  'LAUNCH20', 'percent', 20, 'subscription_monthly',
  '{"creator":20,"studio":20,"agency":20}'::jsonb, 'first_two_cycles',
  false, null, null, 25, false,
  'Launch invite. 20% off the first two monthly cycles.'
where not exists (select 1 from public.promo_codes where code = 'LAUNCH20');

-- PROOF. Expect exactly one row, inactive, with three 20s and no offer ids.
select code, value, active, tier_percents, tier_offer_ids
  from public.promo_codes
 where code = 'LAUNCH20';
