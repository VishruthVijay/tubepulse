/**
 * The webhook payload Apify sends back when a run finishes.
 *
 * In its own file rather than in `client.ts`, for the same reason
 * `reachable.ts` is — that module is `server-only` and cannot be imported by a
 * test. This string decides whether a finished scrape is recorded as a success,
 * so it needs to be testable.
 *
 * Built as a STRING, not via JSON.stringify, and that is the whole point:
 * Apify only substitutes `{{...}}` tokens that are UNQUOTED. `JSON.stringify`
 * quotes every string value, so `eventType: "{{eventType}}"` shipped the
 * literal text `{{eventtype}}` back to us (lowercased by their parser). The
 * webhook then took its failure branch and the user saw
 * "Scrape {{eventtype}}." on a run that had genuinely SUCCEEDED. Compare
 * Apify's own default template, which is unquoted:
 *
 *     { "eventType": {{eventType}}, "resource": {{resource}} }
 *
 * `jobId` and `secret` ARE quoted, because those are our own literal values
 * rather than tokens for Apify to fill in.
 */
export function payloadTemplate(jobId: string, secret: string): string {
  return `{
  "jobId": ${JSON.stringify(jobId)},
  "secret": ${JSON.stringify(secret)},
  "eventType": {{eventType}},
  "runId": {{resource.id}},
  "defaultDatasetId": {{resource.defaultDatasetId}},
  "status": {{resource.status}}
}`;
}
