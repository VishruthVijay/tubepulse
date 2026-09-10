-- ============================================================================
-- 0016_paypal_subscriptions.sql — a second payment provider
--
-- PayPal handles INTERNATIONAL customers, Razorpay handles INDIAN ones. That
-- split is not a preference, it is forced from both directions:
--
--   * Razorpay Subscriptions accepts cards, UPI Autopay and eMandate only. Its
--     PayPal integration is a WALLET, and a wallet cannot hold a recurring
--     mandate — so PayPal-via-Razorpay can never do autopay.
--   * PayPal India business accounts have been EXPORT-ONLY since April 2021.
--     They legally cannot take a domestic INR payment.
--
-- So each provider covers exactly the half the other cannot.
--
-- WHY NEW COLUMNS RATHER THAN REUSING THE RAZORPAY ONES. `razorpay_subscription_id`
-- carries a unique index and is read by name in `billingStateFrom`, the webhook
-- and the sync route. Stuffing a PayPal id into it would work until the first
-- time someone had to debug which provider a row belonged to — and would make
-- the unique index span two id namespaces that have no reason to be distinct.
--
-- `provider` is the discriminator. It DEFAULTS TO 'razorpay' so every existing
-- row keeps its meaning without a backfill, and it is NOT NULL so no row can
-- ever be ambiguous about who is charging the customer.
-- ============================================================================

-- Which provider owns this subscription. 'razorpay' | 'paypal'.
-- Text, not an enum, for the same reason plan_key is text: adding a provider
-- should not need a migration on the table that holds money state.
alter table public.subscriptions
  add column if not exists provider text not null default 'razorpay'
    check (provider in ('razorpay', 'paypal'));

-- PayPal's subscription id (I-XXXXXXXXXXXX). Unique for the same reason the
-- Razorpay one is: a webhook must be able to find exactly one row from it, and
-- a duplicate would mean two users sharing one mandate.
alter table public.subscriptions
  add column if not exists paypal_subscription_id text unique;

-- PayPal's plan id (P-XXXXXXXXXXXX). Stored for support and reconciliation —
-- knowing WHICH plan object a live mandate points at is the first question
-- asked when a price looks wrong.
alter table public.subscriptions
  add column if not exists paypal_plan_id text;

-- PayPal's payer id. The analogue of razorpay_customer_id.
alter table public.subscriptions
  add column if not exists paypal_payer_id text;

comment on column public.subscriptions.provider is
  'Which gateway charges this subscription: razorpay (India) or paypal (international).';

-- Finding a row from a webhook is the hot path for both providers.
create index if not exists subscriptions_paypal_idx
  on public.subscriptions (paypal_subscription_id);

create index if not exists subscriptions_provider_idx
  on public.subscriptions (provider);

-- ---------------------------------------------------------------------------
-- THE INVARIANT: a row must carry the id of the provider that owns it, and
-- must not carry the other one's.
--
-- Without this, a bug that wrote a PayPal id onto a razorpay row would produce
-- a subscription nothing could cancel — the cancel route looks the id up by
-- provider, and would find nothing to call. Cheap to enforce, and the failure
-- it prevents is one where a customer keeps being charged for something they
-- asked to stop.
--
-- 'created' is exempt: a row exists briefly after checkout starts and before
-- approval, and at that moment the id may legitimately not be set yet.
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  drop constraint if exists subscriptions_provider_id_match;

alter table public.subscriptions
  add constraint subscriptions_provider_id_match check (
    status = 'created'
    or (provider = 'razorpay' and paypal_subscription_id is null)
    or (provider = 'paypal'
        and paypal_subscription_id is not null
        and razorpay_subscription_id is null)
  );
