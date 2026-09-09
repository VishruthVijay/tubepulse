/**
 * Building the PayPal fallback link, with the amount attached correctly.
 *
 * Pure, and in its own module rather than inside `pro-plans.tsx`, for the same
 * reason `payload-template.ts` is separate from `client.ts`: this decides how
 * much money a customer is asked for, so it needs to be testable without
 * rendering a client component.
 *
 * WHY A FALLBACK EXISTS AT ALL. Razorpay Subscriptions accepts cards, UPI
 * Autopay and eMandate only — a PayPal wallet cannot hold a recurring mandate,
 * so PayPal can never be the subscription path however it is connected on the
 * Razorpay side. This is the bridge for international customers while
 * Razorpay's International Payments approval is pending, and it is openly
 * manual: they pay, the tier is granted by hand, nothing auto-renews.
 */

/**
 * TWO SHAPES OF LINK, and they carry the amount differently:
 *
 *   paypal.me/name        -> amount is a PATH segment    (/paypal.me/name/49.00)
 *   any hosted PayPal URL -> amount is a QUERY parameter (?amount=49.00)
 *
 * Guessing wrong lands the customer on a page with no amount filled in, which
 * is how the wrong money gets paid. So the paypal.me form is detected rather
 * than assumed.
 *
 * A link that will not parse is returned UNTOUCHED. This runs inside a render,
 * and a link that goes somewhere plain beats a pricing page that throws.
 */
export function paypalHref(
  link: string,
  planName: string,
  cents: number,
  cycle: string,
): string {
  const amount = (cents / 100).toFixed(2);
  const note = `TubePulse ${planName} (${cycle})`;

  try {
    const url = new URL(link);

    // `endsWith` rather than `===` so www.paypal.me is covered too.
    if (url.hostname.endsWith("paypal.me")) {
      // Trailing slashes would otherwise yield `//49.00` and lose the amount.
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/${amount}`;
      return url.toString();
    }

    // The tier and cycle ride along so reconciling a payment by hand is not
    // archaeology — whoever grants the plan can see what was bought.
    url.searchParams.set("amount", amount);
    url.searchParams.set("item_name", note);
    return url.toString();
  } catch {
    return link;
  }
}
