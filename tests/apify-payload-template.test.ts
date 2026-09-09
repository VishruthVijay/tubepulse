import { describe, expect, it } from "vitest";
import { payloadTemplate } from "@/lib/apify/payload-template";

/**
 * The webhook payload template Apify fills in.
 *
 * This guards a bug that made every SUCCESSFUL scrape look like a failure in
 * production. The template was built with JSON.stringify, which quotes every
 * value — and Apify only substitutes UNQUOTED `{{...}}` tokens. So the app
 * received the literal string `{{eventtype}}` instead of `ACTOR.RUN.SUCCEEDED`,
 * the webhook took its failure branch, and the user saw "Scrape {{eventtype}}."
 * on a run that had genuinely worked.
 *
 * The distinction is the entire point of this file: OUR values are quoted,
 * APIFY's tokens are not.
 */
describe("payloadTemplate", () => {
  const template = payloadTemplate("job-123", "s3cret");

  it("leaves Apify's tokens unquoted so they get substituted", () => {
    expect(template).toContain('"eventType": {{eventType}}');
    expect(template).toContain('"runId": {{resource.id}}');
    expect(template).toContain('"defaultDatasetId": {{resource.defaultDatasetId}}');
    expect(template).toContain('"status": {{resource.status}}');
  });

  it("never quotes a token — the bug that shipped", () => {
    expect(template).not.toContain('"{{');
    expect(template).not.toContain('}}"');
  });

  it("quotes our own literal values, which are not tokens", () => {
    expect(template).toContain('"jobId": "job-123"');
    expect(template).toContain('"secret": "s3cret"');
  });

  it("is valid JSON once Apify has substituted the tokens", () => {
    const substituted = template
      .replace("{{eventType}}", '"ACTOR.RUN.SUCCEEDED"')
      .replace("{{resource.id}}", '"run-1"')
      .replace("{{resource.defaultDatasetId}}", '"ds-1"')
      .replace("{{resource.status}}", '"SUCCEEDED"');

    expect(JSON.parse(substituted)).toEqual({
      jobId: "job-123",
      secret: "s3cret",
      eventType: "ACTOR.RUN.SUCCEEDED",
      runId: "run-1",
      defaultDatasetId: "ds-1",
      status: "SUCCEEDED",
    });
  });

  it("escapes a secret containing quotes rather than breaking the JSON", () => {
    const risky = payloadTemplate("job-1", 'a"b');
    expect(risky).toContain('"secret": "a\\"b"');
  });
});
