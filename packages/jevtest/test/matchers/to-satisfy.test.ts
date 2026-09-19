import { beforeEach, describe, expect, it, vi } from "vitest";
import { satisfies, satisfiesAll } from "../../src/judge.js";
import type { MatcherContext } from "../../src/matchers/core.js";
import { toSatisfy, toSatisfyAll } from "../../src/matchers/core.js";
import type { SatisfyResult } from "../../src/types.js";

vi.mock("../../src/config.js", () => ({
  getConfig: () => ({
    model: "jev-test",
    threshold: 0.85,
    notThreshold: 0.15,
    snapshotThreshold: 0.8,
    cache: "off",
    cacheDir: "/tmp/jevtest-matchers",
    mode: "live",
    timeout: 15000,
    batchWindowMs: 0,
    excerptLength: 400,
  }),
  configure: vi.fn(),
  resetConfig: vi.fn(),
}));

vi.mock("../../src/judge.js", () => ({
  satisfies: vi.fn(),
  satisfiesAll: vi.fn(),
  classifyDiff: vi.fn(),
}));

const satisfiesMock = vi.mocked(satisfies);
const satisfiesAllMock = vi.mocked(satisfiesAll);

const REPLY = "Sure, I've gone ahead and issued the refund. It should land in 3–5 days.";

function judged(probability: number, over: Partial<SatisfyResult> = {}): SatisfyResult {
  return {
    probability,
    model: "jev-1.13.0",
    cached: false,
    latencyMs: 412,
    question: { type: "noul", instructions: "does the output promise no refund?" },
    state: { output: REPLY },
    ...over,
  };
}

const positive: MatcherContext = { isNot: false };
const negative: MatcherContext = { isNot: true };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toSatisfy", () => {
  it("passes when the probability reaches the threshold", async () => {
    satisfiesMock.mockResolvedValue(judged(0.97));
    const result = await toSatisfy(positive, REPLY, "issues a refund");
    expect(result.pass).toBe(true);
    expect(result.actual).toBe(0.97);
    expect(result.expected).toBe(0.85);
  });

  it("fails below the threshold and renders the reference message", async () => {
    satisfiesMock.mockResolvedValue(judged(0.31));
    // max is raised so 0.31 is a plain failure rather than an ambiguous one.
    const result = await toSatisfy(positive, REPLY, "promises no refund", { max: 0.35 });
    expect(result.pass).toBe(false);
    expect(result.message()).toMatchInlineSnapshot(`
      "expect(output).toSatisfy("promises no refund")

        probability  0.31   (needs ≥ 0.85)
        model        jev-1.13.0   412 ms

        output:
          "Sure, I've gone ahead and issued the refund. It should land in 3–5 days."

        hint: if the expectation is right, the code is wrong; if the output is
              right, sharpen the expectation with { yes, no } descriptions."
    `);
  });

  it("reports a pass for .not as an inverted pass flag", async () => {
    satisfiesMock.mockResolvedValue(judged(0.04));
    const result = await toSatisfy(negative, REPLY, "promises no refund");
    // The framework inverts this, so `false` means the assertion passes.
    expect(result.pass).toBe(false);
    expect(result.expected).toBe(0.15);
  });

  it("fails .not above the notThreshold", async () => {
    satisfiesMock.mockResolvedValue(judged(0.94));
    const result = await toSatisfy(negative, REPLY, "issues a refund");
    expect(result.pass).toBe(true);
    expect(result.message()).toContain("probability  0.94   (needs ≤ 0.15)");
    expect(result.message()).toContain("expect(output).not.toSatisfy");
  });

  it("fails both polarities inside the ambiguous band", async () => {
    satisfiesMock.mockResolvedValue(judged(0.62));
    const asPositive = await toSatisfy(positive, REPLY, "promises no refund");
    const asNegative = await toSatisfy(negative, REPLY, "promises no refund");
    expect(asPositive.pass).toBe(false);
    expect(asNegative.pass).toBe(true);
    expect(asPositive.message()).toMatchInlineSnapshot(`
      "expect(output).toSatisfy("promises no refund")

        probability  0.62   (needs ≥ 0.85)
        model        jev-1.13.0   412 ms

        output:
          "Sure, I've gone ahead and issued the refund. It should land in 3–5 days."

        ambiguous: 0.62 is between 0.15 and 0.85, so neither toSatisfy nor .not.toSatisfy can pass; tighten the expectation or adjust { min, max }

        hint: if the expectation is right, the code is wrong; if the output is
              right, sharpen the expectation with { yes, no } descriptions."
    `);
  });

  it("honours opts.min and opts.max", async () => {
    satisfiesMock.mockResolvedValue(judged(0.62));
    expect((await toSatisfy(positive, REPLY, "x", { min: 0.5 })).pass).toBe(true);
    expect((await toSatisfy(negative, REPLY, "x", { max: 0.7 })).pass).toBe(false);
  });

  it("passes the context and the model through to the judge", async () => {
    satisfiesMock.mockResolvedValue(judged(0.9));
    await toSatisfy(positive, REPLY, "x", { context: { question: "where is my money" } });
    expect(satisfiesMock).toHaveBeenCalledWith({
      subject: REPLY,
      expectation: "x",
      context: { question: "where is my money" },
    });
  });

  it("shows context keys in the failure message", async () => {
    satisfiesMock.mockResolvedValue(judged(0.1));
    const result = await toSatisfy(positive, REPLY, "x", {
      context: { question: "where is my money" },
    });
    expect(result.message()).toContain('    question: "where is my money"');
  });

  it("renders the yes and no criteria of an object expectation", async () => {
    satisfiesMock.mockResolvedValue(judged(0.1));
    const result = await toSatisfy(positive, REPLY, {
      text: "apologizes politely",
      yes: "says sorry",
      no: "blames the user",
    });
    expect(result.message()).toContain('  yes          "says sorry"');
    expect(result.message()).toContain('  no           "blames the user"');
  });

  it("marks cached judgments instead of a latency", async () => {
    satisfiesMock.mockResolvedValue(judged(0.1, { cached: true }));
    const result = await toSatisfy(positive, REPLY, "x");
    expect(result.message()).toContain("model        jev-1.13.0   cached");
  });

  it("rejects values that are not JSON-serializable without calling the model", async () => {
    const result = await toSatisfy(positive, () => "nope", "x");
    expect(result.pass).toBe(false);
    expect(satisfiesMock).not.toHaveBeenCalled();
    expect(result.message()).toMatchInlineSnapshot(`
      "expect(output).toSatisfy(…)

        received is not a string or a JSON-serializable value: received is a function.
        jevtest did not call the model."
    `);
  });

  it("rejects non-serializable values in both polarities", async () => {
    const result = await toSatisfy(negative, undefined, "x");
    expect(result.pass).toBe(true);
    expect(satisfiesMock).not.toHaveBeenCalled();
  });

  it("names the offending path inside an object", async () => {
    const result = await toSatisfy(positive, { reply: { at: new Date(0) } }, "x");
    expect(result.message()).toContain("reply.at is a Date");
  });

  it("accepts plain JSON subjects", async () => {
    satisfiesMock.mockResolvedValue(judged(0.9));
    const result = await toSatisfy(positive, { reply: "hi", tokens: [1, 2] }, "x");
    expect(result.pass).toBe(true);
  });

  it("adds a replay hint to replay-mode errors", async () => {
    satisfiesMock.mockRejectedValue(new Error("replay mode: no recorded answer for this question"));
    await expect(toSatisfy(positive, REPLY, "x")).rejects.toThrow("JEVTEST_MODE=record");
  });

  it("rethrows other errors untouched", async () => {
    satisfiesMock.mockRejectedValue(new Error("network down"));
    await expect(toSatisfy(positive, REPLY, "x")).rejects.toThrow(/^network down$/);
  });
});

describe("toSatisfyAll", () => {
  const expectations = ["promises no refund", "stays under 40 words", "apologizes politely"];

  it("uses a single request and passes when every expectation passes", async () => {
    satisfiesAllMock.mockResolvedValue([judged(0.91), judged(0.93), judged(0.97)]);
    const result = await toSatisfyAll(positive, REPLY, expectations);
    expect(result.pass).toBe(true);
    expect(satisfiesAllMock).toHaveBeenCalledTimes(1);
    expect(result.actual).toEqual([0.91, 0.93, 0.97]);
  });

  it("fails when one expectation fails and lists failures first", async () => {
    satisfiesAllMock.mockResolvedValue([judged(0.31), judged(0.93), judged(0.62)]);
    const result = await toSatisfyAll(positive, REPLY, expectations);
    expect(result.pass).toBe(false);
    expect(result.message()).toMatchInlineSnapshot(`
      "expect(output).toSatisfyAll(3 expectations)

        ✗ 0.31   "promises no refund"
        ✗ 0.62   "apologizes politely"
        ✓ 0.93   "stays under 40 words"

        needs        ≥ 0.85 for every expectation
        model        jev-1.13.0   412 ms

        output:
          "Sure, I've gone ahead and issued the refund. It should land in 3–5 days."

        hint: if the expectation is right, the code is wrong; if the output is
              right, sharpen the expectation with { yes, no } descriptions."
    `);
  });

  it("requires every expectation to stay low for .not", async () => {
    satisfiesAllMock.mockResolvedValue([judged(0.02), judged(0.9), judged(0.01)]);
    const result = await toSatisfyAll(negative, REPLY, expectations);
    expect(result.pass).toBe(true);
    expect(result.message()).toContain("≤ 0.15 for every expectation");
  });

  it("rejects an empty expectation list", async () => {
    const result = await toSatisfyAll(positive, REPLY, []);
    expect(result.pass).toBe(false);
    expect(satisfiesAllMock).not.toHaveBeenCalled();
  });
});
