-- ============================================================================
-- 0015_launch_codes_rename.sql — the launch codes get their real names
--
-- 0013 seeded the two launch codes as LAUNCH and FOUNDER, which were
-- placeholders. The codes actually being handed out are QUEEN30 and LAUNCH30,
-- so they are renamed here rather than seeded as a second pair — two more rows
-- would leave LAUNCH and FOUNDER live-but-forgotten, and a forgotten code with
-- a 50% tier rate is exactly the row you do not want sitting in the table.
--
-- NOTE THE COLLISION. The old code `LAUNCH` and the new code `LAUNCH30` are
-- different strings, so there is no conflict between them. But renaming
-- LAUNCH -> LAUNCH30 while a row named LAUNCH30 could already exist would
-- violate the unique index, so each rename is guarded by a `not exists`.
--
-- STILL INACTIVE. This migration changes NAMES ONLY. `active` stays false,
-- `tier_offer_ids` stays null, and the dates stay null, because the six
-- Razorpay offers do not exist yet. Activation is a separate, deliberate step
-- — see 0016 when it is written, and the trap restated below.
--
-- ============ THE TRAP, RESTATED BECAUSE IT COSTS REAL MONEY ============
-- A Razorpay Offer discounts EVERY cycle of a subscription unless it is
-- created with an explicit cycle limit. These codes promise TWO discounted
-- monthly cycles. Six offers are needed (two codes x three tiers) and every
-- single one needs a limit of 2. Miss one and that tier's discount runs
-- forever for everyone who used that code on it, with no way to claw it back
-- from an existing mandate.
--
-- The application cannot enforce the cycle limit — Razorpay does not report it
-- in a way the app can check at checkout. What the app CAN do, and does, is
-- refuse any subscription code whose tier has no offer id (`promo.ts`), so a
-- half-finished activation fails loudly instead of quietly overcharging.
-- ============================================================================

-- QUEEN30 — was FOUNDER.
update public.promo_codes
   set code        = 'QUEEN30',
       description = 'Launch invite. 30/40/50% off the first two monthly cycles by tier.'
 where code = 'FOUNDER'
   and not exists (select 1 from public.promo_codes where code = 'QUEEN30');

-- LAUNCH30 — was LAUNCH.
update public.promo_codes
   set code        = 'LAUNCH30',
       description = 'Launch invite. 30/40/50% off the first two monthly cycles by tier.'
 where code = 'LAUNCH'
   and not exists (select 1 from public.promo_codes where code = 'LAUNCH30');

-- NOTHING TO DO FOR REDEMPTIONS. `promo_redemptions` references the promo by
-- `promo_id` (a uuid foreign key), not by the code string, so the rename
-- carries the redemption history with it automatically and the once-per-user
-- unique index on (promo_id, owner_id) keeps holding. This note exists because
-- the opposite is the obvious assumption, and acting on it would mean an
-- update against a column that does not exist.
