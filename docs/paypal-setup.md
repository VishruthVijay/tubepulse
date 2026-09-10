# PayPal setup — international subscriptions

Razorpay charges Indian customers. PayPal charges everyone else. This is the
walkthrough for the PayPal half, in order, with nothing skipped.

**Do the whole of Part 1 in sandbox first.** It costs nothing, uses fake money,
and is the only way to see the full flow work before a real customer meets it.
Part 3 is the switch to live, and it is four values.

---

## Why it is split this way

Neither provider can do the other's half. This is worth knowing because it is
the answer to "can we just use one?".

| | Razorpay | PayPal |
| --- | --- | --- |
| Indian domestic (INR) | Yes — UPI Autopay, cards, eMandate | **No.** PayPal India business accounts have been export-only since April 2021 |
| International recurring (USD) | Needs International Payments approval | Yes, natively |
| PayPal as a payment method | Wallet only — **cannot** hold a recurring mandate | n/a |

The last row is the one that surprises people. Linking PayPal *inside* Razorpay
does not give you PayPal autopay: Razorpay Subscriptions accepts cards, UPI
Autopay and eMandate, and a wallet is none of those. PayPal's own Subscriptions
API is a separate thing, and that is what this integration uses.

UPI also matters: India has 500M+ UPI users against roughly 95M credit cards, so
routing Indian customers through a card-only path would lose most of them.

---

## Part 1 — Sandbox, end to end

### 1. Create the app and get credentials

1. Go to **developer.paypal.com** and log in with your PayPal account.
2. **Dashboard → Apps & Credentials**.
3. Make sure the toggle at the top says **Sandbox**.
4. **Create App**. Name it `TubePulse`. Type: **Merchant**.
5. Copy the **Client ID** and **Secret** (press *Show* next to the secret).

Put them in `.env.local`:

```
PAYPAL_CLIENT_ID=<the client id>
PAYPAL_CLIENT_SECRET=<the secret>
PAYPAL_ENV=sandbox
```

> Sandbox and Live credentials are completely separate. Copying from the wrong
> tab produces a 401 that says `invalid_client` and nothing about modes.

### 2. Create the product and six plans

One command, from the repository root:

```
npm run paypal:plan -- --dry     # shows what it would create, calls nothing
npm run paypal:plan              # actually creates them
```

It reads the prices out of `src/lib/billing/plans.ts` — the same file the
pricing page reads — so a plan can never disagree with the page selling it.
It prints six lines. Paste them into `.env.local`:

```
PAYPAL_PLAN_ID_CREATOR_MONTHLY=P-...
PAYPAL_PLAN_ID_CREATOR_YEARLY=P-...
PAYPAL_PLAN_ID_STUDIO_MONTHLY=P-...
PAYPAL_PLAN_ID_STUDIO_YEARLY=P-...
PAYPAL_PLAN_ID_AGENCY_MONTHLY=P-...
PAYPAL_PLAN_ID_AGENCY_YEARLY=P-...
```

**`AGENCY` is the tier shown as "Max".** The internal key never changed, because
renaming it would orphan live subscriptions. The env names follow the key.

Only the three **monthly** ids are required. Blank yearly ids hide the annual
toggle rather than breaking it, so you can switch annual on later.

### 3. Create the webhook

Renewals are recorded by webhook. Without this, the first payment works and
every renewal after it is invisible to the app.

1. **Apps & Credentials → your app → Webhooks → Add Webhook.**
2. URL: `https://tube-pulse.org/api/webhooks/paypal`
3. Tick exactly these events:
   - `BILLING.SUBSCRIPTION.ACTIVATED`
   - `BILLING.SUBSCRIPTION.CANCELLED`
   - `BILLING.SUBSCRIPTION.SUSPENDED`
   - `BILLING.SUBSCRIPTION.EXPIRED`
   - `BILLING.SUBSCRIPTION.UPDATED`
   - `BILLING.SUBSCRIPTION.PAYMENT.FAILED`
   - `PAYMENT.SALE.COMPLETED`  ← **this one records each renewal**
4. Save, then copy the **Webhook ID** it shows.

```
PAYPAL_WEBHOOK_ID=<the webhook id>
```

> A sandbox webhook cannot point at `localhost`. For local testing the app falls
> back to polling: the customer returns to `/billing`, which syncs against
> PayPal's API directly. That is why checkout still works on a laptop.

### 4. Test it with fake money

1. **Testing Tools → Sandbox Accounts.** PayPal created a *personal* test
   account for you. Copy its email, and use *Change password* if you need one.
2. Run the app: `npm.cmd run dev`
3. Open `/pricing`. Because your machine has no geo header, you will be offered
   the **PayPal** path — which is exactly the one to test.
4. Choose a plan → you are redirected to PayPal → log in as the **sandbox
   personal account** → *Agree & Subscribe*.
5. You land back on `/billing` and the plan should be active.

Check `Sandbox Accounts → the business account → the subscription exists`.

---

## Part 2 — What each piece does

| Variable | What breaks without it |
| --- | --- |
| `PAYPAL_CLIENT_ID` / `_SECRET` | Nothing works — no API call authenticates |
| `PAYPAL_ENV` | Wrong host; ids appear as "resource not found" |
| `PAYPAL_PLAN_ID_*_MONTHLY` (×3) | International checkout is hidden entirely |
| `PAYPAL_PLAN_ID_*_YEARLY` (×3) | Annual toggle hidden; monthly still fine |
| `PAYPAL_WEBHOOK_ID` | First payment works; **renewals never record** |

---

## Part 3 — Going live

Four steps, and every one of them is a *different value*, not the same value in
a different place.

1. Flip the toggle at **Apps & Credentials** to **Live**, create the app again,
   and copy the **live** Client ID and Secret.
2. Set `PAYPAL_ENV=live`.
3. Re-run `npm run paypal:plan`. **The sandbox plan ids do not work live.** This
   creates six new ones.
4. Create the webhook again on the **Live** tab, with the same URL and the same
   seven events, and copy the new **Webhook ID**.

Then put all eleven values into **Vercel → Settings → Environment Variables**,
and redeploy **with build cache off** — env vars are baked in at build time, so
an import alone changes nothing.

> A production build **refuses to start** on `PAYPAL_ENV=sandbox`. That guard
> exists because shipping sandbox credentials is silent: checkout succeeds, the
> customer sees a confirmation, and no money ever arrives. You find out the
> month a payout does not.

### Before you take a real payment

- Your PayPal account must be a **Business** account, not Personal.
- It must be able to **receive international payments** — for an Indian account
  that is the default, since domestic INR is the thing it cannot do.
- Confirm your bank account is linked for withdrawals.

---

## Troubleshooting

**"Not set: PAYPAL_..." on the billing page.** That banner names the exact
missing variables. It is telling the truth — check them one by one.

**`invalid_client` / 401.** Credentials from the other environment. Check
`PAYPAL_ENV` matches the tab you copied from.

**"Resource not found" on checkout.** A plan id from the other environment, or
a plan that was deactivated. Re-run `npm run paypal:plan`.

**First payment works, renewals never appear.** The webhook. Either
`PAYPAL_WEBHOOK_ID` is unset, or `PAYMENT.SALE.COMPLETED` was not ticked.

**A customer is charged but the app still says free.** They should press
**Refresh** on `/billing` — that syncs against PayPal's API directly and does
not depend on the webhook. If that fixes it, the webhook is the problem.

**Discount codes at international checkout.** They are refused, deliberately.
The launch codes are Razorpay Offer objects and have no PayPal equivalent, so
the honest options were "refuse" or "show a discount and charge full price".

---

## What the code does, in one paragraph

`/pricing` reads the visitor's country from the platform's geo header and shows
the matching provider's button. `/api/billing/checkout` creates the subscription
server-side — the browser never states a price — and returns PayPal's approval
URL. The customer approves at PayPal and returns to `/billing?paypal=return`,
where the page syncs against PayPal's API rather than trusting the redirect.
`/api/webhooks/paypal` records renewals; every payload is verified by posting it
back to PayPal, because their signature is an RSA certificate chain rather than
an HMAC and hand-rolling that check is a good way to be wrong in a way that
still returns `true`. Cancelling calls PayPal first and only then updates the
row, so a cancel that fails at the provider never looks successful in the app.
