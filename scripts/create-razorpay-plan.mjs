#!/usr/bin/env node
/**
 * Creates the six subscription plans at Razorpay and prints their ids.
 *
 * WHY THIS EXISTS
 *
 * Razorpay autopay needs a Plan object that lives in your Razorpay account, not
 * in this repo. Creating one by hand means six dashboard fields per plan, and
 * getting the amount wrong there charges the wrong price with no warning — the
 * app has no way to notice, because the plan is the source of truth for what is
 * billed.
 *
 * So the amounts are parsed out of `src/lib/billing/plans.ts`, the same file the
 * pricing page reads. One number, one place, and a plan physically cannot
 * disagree with the page that sells it.
 *
 * SIX PLANS, not two. A Razorpay plan hard-codes period AND amount AND
 * currency, so every tier-and-cycle pair is its own object:
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
 *   npm run razorpay:plan            # create all six
 *   npm run razorpay:plan -- --dry   # print what it WOULD create, call nothing
 *
 * It reads your keys from .env.local, creates the plans, and prints the lines to
 * paste back. Running it again creates DUPLICATES, which is harmless but only
 * the ids you paste are ever used.
 *
 * Plans cannot be edited or deleted at Razorpay once created. To change a price,
 * create a new plan and repoint the env var; existing subscribers stay on the
 * old plan until they resubscribe, which is exactly how it should behave.
 */

import { readFileSync } from "node:fs";

const ENV_FILE = ".env.local";
const PLANS_FILE = "src/lib/billing/plans.ts";
const DRY_RUN = process.argv.includes("--dry");

/**
 * Months of subscription bought by one yearly charge. Mirrors
 * YEARLY_MONTHS_CHARGED in plans.ts, and is cross-checked against it below.
 */
const YEARLY_MONTHS_CHARGED = 10;

/**
 * The three paid tiers, keyed by their INTERNAL key (which is what the env var
 * names are built from). `label` is what the customer sees.
 *
 * Prices are NOT written here — they are read out of plans.ts, so this script
 * cannot drift from the pricing page.
 */
const TIERS = [
  { key: "creator", label: "Creator", blurb: "For one channel, taken seriously" },
  { key: "studio", label: "Studio", blurb: "For a channel that ships weekly" },
  { key: "agency", label: "Max", blurb: "Every tool, no ceilings" },
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
        `  ${plan.name.padEnd(28)} Rs ${(plan.amountPaise / 100)
          .toFixed(2)
          .padStart(7)}  ${plan.period.padEnd(7)}  ${plan.envVar}`,
      );
    }
    console.log(`\n${plans.length} plans would be created in INR.\n`);
    return;
  }

  const env = readEnvLocal();
  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error(
      `RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in ${ENV_FILE}.\n` +
        `  Get them from the Razorpay dashboard, in LIVE mode:\n` +
        `  Account & Settings -> API Keys -> Generate Live Key.\n` +
        `  Copy the secret before closing that dialog — it is shown once.`,
    );
  }

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const mode = keyId.startsWith("rzp_live_") ? "LIVE" : "TEST";

  if (mode === "TEST") {
    console.log(
      `\n! These are TEST keys, so the plans will be created in test mode.\n` +
        `  A production build refuses to start on test keys, so these ids\n` +
        `  cannot be used in production. Re-run with live keys when ready.`,
    );
  }

  console.log(`\nCreating ${plans.length} plans in ${mode} mode, in INR...\n`);

  const created = [];

  for (const plan of plans) {
    console.log(
      `  ${plan.name.padEnd(28)} Rs ${(plan.amountPaise / 100).toFixed(2).padStart(7)}  ${plan.period}`,
    );

    const response = await fetch("https://api.razorpay.com/v1/plans", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        period: plan.period,
        interval: 1,
        item: {
          name: plan.name,
          description: plan.description,
          amount: plan.amountPaise,
          currency: "INR",
        },
        notes: { created_by: "scripts/create-razorpay-plan.mjs", tier: plan.key },
      }),
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const description = body?.error?.description ?? `HTTP ${response.status}`;

      // Do not throw away work: print whatever already succeeded so the run is
      // not wasted and no id has to be recovered by hand from the dashboard.
      if (created.length > 0) printResults(created);

      throw new Error(
        `Razorpay refused while creating "${plan.name}": ${description}\n` +
          explainFailure(response.status, description),
      );
    }

    created.push({ envVar: plan.envVar, id: body.id });
  }

  printResults(created);
}

function explainFailure(status, description) {
  if (status === 401) {
    return (
      `  A 401 means the key id and secret do not match, or a test secret is\n` +
      `  sitting next to a live key id. Check both in ${ENV_FILE}.`
    );
  }
  if (/currenc/i.test(description)) {
    return (
      `  Razorpay accounts bill in INR by default. USD plans need\n` +
      `  INTERNATIONAL PAYMENTS enabled on the account — request it from\n` +
      `  the dashboard (Account & Settings -> Payment methods) and wait for\n` +
      `  approval, then re-run. Nothing else here needs to change.`
    );
  }
  if (/subscription/i.test(description)) {
    return (
      `  If it mentions Subscriptions not being enabled, request access from\n` +
      `  the Razorpay dashboard first — it is off by default on new accounts.`
    );
  }
  return `  Nothing was rolled back; re-running creates duplicates, which is harmless.`;
}

function buildPlans(prices) {
  const plans = [];
  for (const tier of TIERS) {
    const monthlyCents = prices[tier.key];
    if (monthlyCents === undefined) {
      throw new Error(
        `No price found for tier "${tier.key}" in ${PLANS_FILE}.\n` +
          `  Found: ${JSON.stringify(prices)}`,
      );
    }
    const upper = tier.key.toUpperCase();

    plans.push({
      key: tier.key,
      envVar: `RAZORPAY_PLAN_ID_${upper}_MONTHLY`,
      name: `TubePulse ${tier.label} — Monthly`,
      description: tier.blurb,
      amountPaise: monthlyCents,
      period: "monthly",
    });

    plans.push({
      key: tier.key,
      envVar: `RAZORPAY_PLAN_ID_${upper}_YEARLY`,
      name: `TubePulse ${tier.label} — Yearly`,
      description: `${tier.blurb}. Two months free.`,
      amountPaise: monthlyCents * YEARLY_MONTHS_CHARGED,
      period: "yearly",
    });
  }
  return plans;
}

/**
 * Pull each paid tier's monthly price out of plans.ts.
 *
 * Deliberately parsed rather than duplicated: a price typed twice is a price
 * that will eventually disagree with itself, and the failure mode is charging
 * a customer an amount the pricing page never showed them.
 */
function readPricesFromPlansFile() {
  let source;
  try {
    source = readFileSync(PLANS_FILE, "utf8");
  } catch {
    throw new Error(
      `${PLANS_FILE} not found. Run this from the repository root.`,
    );
  }

  // Each tier appears as   key: "creator",  ... pricePaise: 49_900,
  const prices = {};
  const blocks = source.matchAll(
    /key:\s*"(creator|studio|agency)"[\s\S]{0,600}?pricePaise:\s*([\d_]+)/g,
  );
  for (const match of blocks) {
    prices[match[1]] = Number(match[2].replace(/_/g, ""));
  }

  const missing = TIERS.filter((t) => prices[t.key] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Could not read prices for ${missing
        .map((t) => t.key)
        .join(", ")} from ${PLANS_FILE}.\n` +
        `  The file's shape may have changed — check priceCents is still there.`,
    );
  }

  // Cross-check the yearly multiplier rather than trusting the copy above.
  const declared = source.match(/YEARLY_MONTHS_CHARGED\s*=\s*(\d+)/);
  if (declared && Number(declared[1]) !== YEARLY_MONTHS_CHARGED) {
    throw new Error(
      `YEARLY_MONTHS_CHARGED is ${declared[1]} in ${PLANS_FILE} but ` +
        `${YEARLY_MONTHS_CHARGED} in this script.\n` +
        `  Update the script to match, or every yearly plan bills the wrong amount.`,
    );
  }

  return prices;
}

function printResults(created) {
  console.log(`\n✓ ${created.length} plan(s) created.\n`);
  console.log(`Paste these into ${ENV_FILE} AND into Vercel:\n`);
  for (const { envVar, id } of created) {
    console.log(`  ${envVar}=${id}`);
  }
  console.log(
    `\nRemember Vercel bakes env vars in at BUILD time — redeploy with the\n` +
      `cache off, or the new ids will not be live.\n`,
  );
}

/** Read .env.local without a dotenv dependency. */
function readEnvLocal() {
  let source;
  try {
    source = readFileSync(ENV_FILE, "utf8");
  } catch {
    throw new Error(`${ENV_FILE} not found. Copy .env.example to it first.`);
  }

  const values = {};
  // Split on \r?\n, not \n. A CRLF file otherwise leaves a trailing \r on every
  // value, and a key id ending in an invisible carriage return fails auth with
  // a 401 that looks exactly like a wrong key.
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return values;
}
