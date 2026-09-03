import { describe, expect, it } from "vitest";
import {
  needsClarification,
  obviousChannel,
  repairIntent,
  type Intent,
} from "@/lib/agent/intent";

/**
 * The voice button's worst failure: a clear request answered with "What would
 * you like researched?".
 *
 * `json_object` mode constrains JSON syntax and nothing else, so the model may
 * return {"kind":"niche","niche":null} — self-contradictory, yet valid against
 * the schema because both fields are legitimately nullable. Nothing downstream
 * noticed, so the route found no channel and no niche and asked a question at
 * someone who had just answered it.
 *
 * It was observed live, intermittently, on "Research the YouTube channel
 * Marques Brownlee" — a request the prompt names as an example. Intermittent is
 * worse than broken here: the feature looks unreliable rather than unfinished,
 * and it cannot be caught by calling the real API, because the same input
 * usually succeeds. Hence a unit test over the repair.
 */

function intent(over: Partial<Intent> = {}): Intent {
  return {
    kind: "niche",
    channel: null,
    niche: "home espresso",
    platform: null,
    question: null,
    confidence: 80,
    ...over,
  };
}

describe("repairIntent", () => {
  it("leaves a well-formed niche alone", () => {
    const good = intent({ kind: "niche", niche: "home espresso" });
    expect(repairIntent(good, "home espresso")).toEqual(good);
  });

  it("leaves a well-formed channel alone", () => {
    const good = intent({ kind: "channel", channel: "MKBHD", niche: null });
    expect(repairIntent(good, "research MKBHD")).toEqual(good);
  });

  it("fills a null niche from what the person actually said", () => {
    // The exact observed failure.
    const broken = intent({ kind: "niche", niche: null });
    const fixed = repairIntent(broken, "Research the YouTube channel Marques Brownlee");

    expect(fixed.kind).toBe("niche");
    expect(fixed.niche).toBe("Research the YouTube channel Marques Brownlee");
  });

  it("demotes a channel with no name to a niche rather than inventing one", () => {
    // Guessing a handle here would spend a run scraping something nobody named.
    const broken = intent({ kind: "channel", channel: null, niche: null });
    const fixed = repairIntent(broken, "that tech reviewer everyone watches");

    expect(fixed.kind).toBe("niche");
    expect(fixed.niche).toBe("that tech reviewer everyone watches");
    expect(fixed.channel).toBeNull();
  });

  it("degrades to unclear when there is genuinely nothing to work with", () => {
    // An empty request has no words to fall back on. Asking is then correct,
    // and `needsClarification` must agree so the route actually asks.
    for (const said of ["", "   "]) {
      const fixed = repairIntent(intent({ kind: "niche", niche: null }), said);
      expect(fixed.kind).toBe("unclear");
      expect(needsClarification(fixed)).toBe(true);
    }
  });

  it("caps the fallback niche at the schema's limit", () => {
    // The raw request is untrusted length; `niche` is max(200) in the schema,
    // so an over-long fallback would fail validation somewhere downstream.
    const fixed = repairIntent(intent({ kind: "niche", niche: null }), "a".repeat(500));
    expect(fixed.niche).toHaveLength(200);
  });

  it("leaves an unclear intent untouched", () => {
    const unclear = intent({ kind: "unclear", niche: null, confidence: 0 });
    expect(repairIntent(unclear, "mmm").kind).toBe("unclear");
  });

  it("produces an intent the route will act on rather than question", () => {
    // The point of the whole repair: the repaired intent must stop triggering
    // the "What would you like researched?" branch.
    const fixed = repairIntent(
      intent({ kind: "niche", niche: null, confidence: 80, question: null }),
      "Research the YouTube channel Marques Brownlee",
    );
    expect(needsClarification(fixed)).toBe(false);
  });
});

/**
 * The other half of the same failure: a bare "@MKBHD" was seen coming back as a
 * NICHE, which turns "research this account" into "which platform?" and then a
 * discovery call that rediscovers the handle the person typed.
 *
 * A lone handle or channel URL is not a judgement call, so it no longer depends
 * on one.
 */
describe("obviousChannel", () => {
  it("recognises a bare handle", () => {
    expect(obviousChannel("@MKBHD")).toEqual({ channel: "MKBHD", platform: null });
  });

  it("recognises a channel URL and the platform it names", () => {
    expect(obviousChannel("youtube.com/@mkbhd")).toEqual({
      channel: "mkbhd",
      platform: "youtube",
    });
    expect(obviousChannel("https://www.instagram.com/nasa/")).toEqual({
      channel: "nasa",
      platform: "instagram",
    });
  });

  it("ignores surrounding whitespace", () => {
    expect(obviousChannel("  @nasa  ")?.channel).toBe("nasa");
  });

  it("defers to the model whenever there is any context", () => {
    // These are genuine requests, not bare handles. "channels like @mkbhd" asks
    // for discovery, and answering it with @mkbhd itself would be wrong.
    for (const said of [
      "channels like @mkbhd",
      "@mkbhd and @veritasium",
      "research @mkbhd",
      "find me home cooking channels",
    ]) {
      expect(obviousChannel(said)).toBeNull();
    }
  });

  it("refuses anything that is not a handle or a known platform URL", () => {
    for (const said of ["", "   ", "mkbhd", "cooking", "example.com/@mkbhd"]) {
      expect(obviousChannel(said)).toBeNull();
    }
  });
});
