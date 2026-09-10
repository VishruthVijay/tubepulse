"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

/**
 * Finishes a PayPal checkout when the customer comes back from approving it.
 *
 * WHY THIS IS NEEDED AT ALL. The Razorpay flow is a modal: its handler fires in
 * the same page the moment the mandate is authorised, and `useUpgrade` syncs
 * right there. PayPal instead REDIRECTS away and back, so nothing in the app is
 * listening when approval completes. Without this component the customer
 * returns to a billing page that still says "free" and reasonably concludes
 * their payment failed.
 *
 * The webhook usually arrives within a second or two, but "usually" is not good
 * enough at the exact moment somebody has just paid — and on a machine the
 * webhook cannot reach, it never arrives at all. So this asks our own sync
 * route, which asks PayPal directly.
 *
 * NOTHING HERE IS TRUSTED TO GRANT ANYTHING. `?paypal=return` is a URL a
 * stranger can type; all it does is trigger a server-side reconcile. The tier
 * comes from PayPal's own API, exactly as it does on the Razorpay path.
 */
export function PaypalReturn() {
  const params = useSearchParams();
  const router = useRouter();
  // StrictMode double-invokes effects in development. Without this guard the
  // sync fires twice and the customer gets two toasts.
  const done = useRef(false);

  const returned = params.get("paypal") === "return";

  useEffect(() => {
    if (!returned || done.current) return;
    done.current = true;

    void (async () => {
      try {
        const response = await fetch("/api/billing/sync", { method: "POST" });

        if (response.ok) {
          toast.success("You're all set. Your plan is active and renews by itself.");
        } else {
          // The subscription may still be moments away from activating at
          // PayPal. Say what to do rather than declaring a failure that
          // probably has not happened.
          toast("Payment received. Give it a moment, then press Refresh.");
        }
      } catch {
        toast("Payment received. Give it a moment, then press Refresh.");
      } finally {
        // Drop the query parameter so a refresh does not re-run this, and so
        // the URL stops advertising where the customer came from.
        router.replace("/billing");
        router.refresh();
      }
    })();
  }, [returned, router]);

  return null;
}
