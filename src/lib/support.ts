/**
 * How a customer reaches a human, defined once.
 *
 * Written here rather than typed into each footer because it appears in two
 * places that are easy to forget in opposite directions: the public footer,
 * which signed-out visitors read while deciding whether to trust a paid tool,
 * and the workspace, where the people who have already paid need it most. A
 * literal in both is how one of them ends up pointing at a dead mailbox after
 * the address changes.
 *
 * NOT AN ENV VAR, deliberately. It is printed on a public page, so it is not a
 * secret, and it must be identical in every environment — a support address
 * that differs between preview and production is a support address that
 * silently loses mail.
 *
 * Pure module, no imports. Safe from a client component and from a server one.
 *
 * ---------------------------------------------------------------------------
 * THIS ADDRESS MUST ACTUALLY RECEIVE MAIL before it ships. It is a promise
 * printed on the page, and an address that bounces is worse than none at all:
 * the customer believes they have been in touch and is waiting for an answer
 * nobody will ever send. Routing is set up at the DNS provider — see the
 * go-live runbook — and it is separate from the SENDING address that delivers
 * verification codes, which is `noreply@` and accepts no replies.
 * ---------------------------------------------------------------------------
 */
export const SUPPORT_EMAIL = "support@tube-pulse.org";

/**
 * The address verification codes are sent FROM.
 *
 * Here only so that nothing else in the app is tempted to invite a reply to
 * it. Configured in the Supabase dashboard, not read from this constant — it
 * is written down so the two addresses cannot be confused for each other.
 */
export const NOREPLY_EMAIL = "noreply@tube-pulse.org";
