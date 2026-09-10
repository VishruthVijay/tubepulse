#!/usr/bin/env node
/**
 * Creates the PayPal product and six subscription plans, and prints their ids.
 *
 * WHY THIS EXISTS
 *
 * The same reason its Razorpay twin does: creating plans by hand means typing
 * an amount into a dashboard, and getting it wrong charges the wrong price with
 * no warning — the app cannot notice, because the plan object is the source of
 * truth for what is billed.
 *
 * So the amounts are parsed out of `src/lib/billing/plans.ts`, the same file the
 * pricing page reads. One number, one place.
 *
 * PAYPAL'S OBJECT MODEL IS THREE DEEP, unlike Razorpay's two:
 *
 *     Product      what you sell            -> created once, reused by all six
 *       Plan       price + interval          -> six, one per tier-and-cycle
 *         Subscription  one customer         -> created at checkout, not here
 *
 * SIX PLANS, because a PayPal plan hard-codes amount, currency AND interval:
 *
 *   Creator $19    monthly + yearly
 *   Studio  $49    monthly + yearly
 *   Max     $89    monthly + yearly   (env vars say AGENCY — see below)
 *
 * THE AGENCY VARIABLES ARE MAX. The tier is displayed as "Max" but its internal
 * key stayed `agency`, because renaming it would orphan live subscriptions. The
 * env names follow the key, not the label.
 *
 * YEARLY IS TEN MONTHS' MONEY FOR TWELVE MONTHS' ACCESS (YEARLY_MONTHS_CHARGED).
 *
 * USAGE
 *
 *   npm run paypal:plan            # create the product and all six plans
 *   npm run paypal:plan -- --dry   # print what it WOULD create, call nothing
 *
 * It reads credentials from .env.local and prints the lines to paste back.
 *
 * SANDBOX AND LIVE ARE SEPARATE WORLDS. Credentials, products, plans and
 * webhook ids all exist per-environment, so a sandbox plan id next to live
 * credentials fails with "resource not found". PAYPAL_ENV decides which host
 * this talks to, and the script says which one it used.
 *
 * Running it again creates DUPLICATES, which is harmless but only the ids you
 * paste are ever used. PayPal plans cannot be deleted, only deactivated.
 */

import { readFileSync } from "node:fs";

const ENV_FILE = ".env.local";
const PLANS_FILE = "src/lib/billing/plans.ts";
const DRY_RUN = process.argv.includes("--dry");

/** Mirrors YEARLY_MONTHS_CHARGED in plans.ts, and is cross-checked against it. */
const YEARLY_MONTHS_CHARGED = 10;

const TIERS = [
  { key: "creator", label: "Creator" },
  { key: "studio", label: "Studio" },
  { key: "agency", label: "Max" },
];

main().catch((error) => {
  console.error(`\n✗ ${error.message}\n`);
  process.exit(1);
});

async function main() {
  const prices = readPricesFromPlansFile();
  const plans = buildPlans(prices);

  if (DRY_RUN) {
    console.log(`\nDRY RUN — nothing is created, no API call is made.\n`);
    for (const plan of plans) {
      console.log(
        `  ${plan.name.padEnd(28)} $${(plan.amountCents / 100)
          .toFixed(2)
          .padStart(7)}  ${plan.interval.padEnd(7)}  ${plan.envVar}`,
      );
    }
    console.log(`\n${plans.length} plans would be created in USD.\n`);
    return;
  }

  const env = readEnvLocal();
  const clientId = env.PAYPAL_CLIENT_ID;
  const secret = env.PAYPAL_CLIENT_SECRET;
  const paypalEnv = (env.PAYPAL_ENV || "sandbox").toLowerCase();

  if (!clientId || !secret) {
    throw new Error(
      `PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set in ${ENV_FILE}.\n` +
        `  Get them from developer.paypal.com -> Apps & Credentials.\n` +
        `  Make sure you are on the ${paypalEnv.toUpperCase()} tab — the two sets\n` +
        `  of credentials are completely separate.`,
    );
  }

  if (paypalEnv !== "sandbox" && paypalEnv !== "live") {
    throw new Error(`PAYPAL_ENV must be "sandbox" or "live", not "${paypalEnv}".`);
  }

  const base =
    paypalEnv === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

  console.log(`\nUsing the ${paypalEnv.toUpperCase()} environment (${base}).`);

  if (paypalEnv === "sandbox") {
    console.log(
      `! These are SANDBOX plans. No real money moves, and these ids will NOT\n` +
        `  work with live credentials. Re-run with PAYPAL_ENV=live when ready.`,
    );
  }

  const token = await accessToken(base, clientId, secret);

  // One product, reused by all six plans. Created fresh each run; PayPal has no
  // "get or create", and a duplicate product is harmless.
  const productId = await createProduct(base, token);
  console.log(`\nProduct: ${productId}\n`);

  const created = [];

  for (const plan of plans) {
    console.log(
      `  ${plan.name.padEnd(28)} $${(plan.amountCents / 100).toFixed(2).padStart(7)}  ${plan.interval}`,
    );

    const id = await createPlan(base, token, productId, plan);
    created.push({ envVar: plan.envVar, id });
  }

  console.log(`\n✓ Created ${created.length} plans.\n`);
  console.log(`Paste these into ${ENV_FILE} (and into Vercel for production):\n`);
  for (const { envVar, id } of created) {
    console.log(`${envVar}=${id}`);
  }
  console.log(
    `\nThen set PAYPAL_ENV=${paypalEnv}, and create the webhook — see\n` +
      `docs/paypal-setup.md for the endpoint URL and which events to tick.\n`,
  );
}

/** Every plan to create: three tiers x two cycles. */
function buildPlans(prices) {
  const plans = [];

  for (const tier of TIERS) {
    const monthlyCents = prices[tier.key];

    plans.push({
      name: `TubePulse ${tier.label} — monthly`,
      amountCents: monthlyCents,
      interval: "MONTH",
      envVar: `PAYPAL_PLAN_ID_${tier.key.toUpperCase()}_MONTHLY`,
    });

    plans.push({
      name: `TubePulse ${tier.label} — yearly`,
      amountCents: monthlyCents * YEARLY_MONTHS_CHARGED,
      interval: "YEAR",
      envVar: `PAYPAL_PLAN_ID_${tier.key.toUpperCase()}_YEARLY`,
    });
  }

  return plans;
}

async function accessToken(base, clientId, secret) {
  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");

  const response = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    throw new Error(
      `PayPal rejected those credentials (${response.status}).\n` +
        `  The usual cause is credentials from the OTHER environment — check\n` +
        `  PAYPAL_ENV matches the tab you copied them from.`,
    );
  }

  const json = await response.json();
  if (!json.access_token) throw new Error("PayPal returned no access token.");
  return json.access_token;
}

async function createProduct(base, token) {
  const response = await fetch(`${base}/v1/catalogs/products`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "TubePulse",
      description: "YouTube research and idea generation",
      // SERVICE, not a physical good — this suppresses shipping entirely.
      type: "SERVICE",
      category: "SOFTWARE",
    }),
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(describe("Could not create the product", response, json));
  }

  return json.id;
}

async function createPlan(base, token, productId, plan) {
  const response = await fetch(`${base}/v1/billing/plans`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // Without this a retry creates a second identical plan.
      "PayPal-Request-Id": `plan-${plan.envVar}-${plan.amountCents}`,
    },
    body: JSON.stringify({
      product_id: productId,
      name: plan.name,
      status: "ACTIVE",
      billing_cycles: [
        {
          frequency: { interval_unit: plan.interval, interval_count: 1 },
          // REGULAR, not TRIAL. A trial cycle here would give away a free
          // period nobody agreed to.
          tenure_type: "REGULAR",
          sequence: 1,
          // 0 means "forever, until cancelled", which is what a subscription is.
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: {
              // A DECIMAL STRING, not minor units. PayPal takes "19.00" where
              // Razorpay takes 1900 — passing cents here would charge 100x.
              value: (plan.amountCents / 100).toFixed(2),
              currency_code: "USD",
            },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee: { value: "0.00", currency_code: "USD" },
        setup_fee_failure_action: "CONTINUE",
        // After three failed attempts PayPal suspends the subscription, which
        // the webhook maps to `halted` — access survives the paid period.
        payment_failure_threshold: 3,
      },
    }),
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(describe(`Could not create ${plan.envVar}`, response, json));
  }

  return json.id;
}

/** PayPal nests its useful message two deep, and the debug id is in a header. */
function describe(prefix, response, json) {
  const issue = json?.details?.[0];
  const detail = issue?.description ?? issue?.issue ?? json?.message ?? "unknown error";
  const debugId = response.headers.get("paypal-debug-id");
  return `${prefix} (${response.status}): ${detail}${debugId ? `\n  debug id: ${debugId}` : ""}`;
}

function readPricesFromPlansFile() {
  let source;
  try {
    source = readFileSync(PLANS_FILE, "utf8");
  } catch {
    throw new Error(`${PLANS_FILE} not found. Run this from the repository root.`);
  }

  const prices = {};
  const blocks = source.matchAll(
    /key:\s*"(creator|studio|agency)"[\s\S]{0,600}?priceCents:\s*([\d_]+)/g,
  );
  for (const match of blocks) {
    prices[match[1]] = Number(match[2].replace(/_/g, ""));
  }

  const missing = TIERS.filter((t) => prices[t.key] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Could not read prices for ${missing.map((t) => t.key).join(", ")} from ${PLANS_FILE}.\n` +
        `  The file's shape may have changed — check priceCents is still there.`,
    );
  }

  // Cross-check the yearly multiplier rather than trusting the copy above.
  const declared = source.match(/YEARLY_MONTHS_CHARGED\s*=\s*(\d+)/);
  if (declared && Number(declared[1]) !== YEARLY_MONTHS_CHARGED) {
    throw new Error(
      `YEARLY_MONTHS_CHARGED is ${declared[1]} in ${PLANS_FILE} but ${YEARLY_MONTHS_CHARGED} in this script.\n` +
        `  Fix the script rather than the plans file — the app reads the latter.`,
    );
  }

  return prices;
}

function readEnvLocal() {
  let source;
  try {
    source = readFileSync(ENV_FILE, "utf8");
  } catch {
    throw new Error(`${ENV_FILE} not found. Copy .env.example to it first.`);
  }

  const values = {};
  // Split on \r?\n. A CRLF file otherwise leaves a trailing \r on every value,
  // and a client id ending in an invisible carriage return fails auth with a
  // 401 that looks exactly like a wrong credential.
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }

  return values;
}
