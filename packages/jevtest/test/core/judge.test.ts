import { AuthenticationError } from "@typesafe-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetBatch } from "../../src/batch.js";
import { resetCache } from "../../src/cache.js";
import { setFetchForTesting } from "../../src/client.js";
import { configure, resetConfig } from "../../src/config.js";
import { JevtestAPIError } from "../../src/errors.js";
import { classifyDiff, satisfies, satisfiesAll } from "../../src/judge.js";
import { getStats, resetStats } from "../../src/stats.js";
import { fakeFetch } from "./fake.js";

beforeEach(() => {
  resetConfig();
  configure({ apiKey: "test-key", cache: "off" });
  resetCache();
  resetBatch();
  resetStats();
});

afterEach(() => {
  setFetchForTesting(undefined);
  resetConfig();
  resetCache();
});

describe("satisfies", () => {
  it("returns the probability with the question and state it sent", async () => {
    const fake = fakeFetch({ noul: 0.98 });
    setFetchForTesting(fake.fetch);
    const result = await satisfies({
      subject: "Sorry about that.",
      expectation: "apologizes politely",
    });
    expect(result.probability).toBe(0.98);
    expect(result.model).toBe("jev-test");
    expect(result.cached).toBe(false);
    expect(result.state).toEqual({ output: "Sorry about that." });
    expect(result.question.type).toBe("noul");
    expect(fake.calls[0]?.questions.q0).toEqual(result.question);
  });

  it("passes JSON subjects through as JSON", async () => {
    const fake = fakeFetch();
    setFetchForTesting(fake.fetch);
    await satisfies({ subject: { items: [1, 2] }, expectation: "has two items" });
    expect(fake.calls[0]?.state).toEqual({ output: { items: [1, 2] } });
  });

  it("uses the per-call model override", async () => {
    const fake = fakeFetch();
    setFetchForTesting(fake.fetch);
    await satisfies({ subject: "hi", expectation: "greets", model: "jev-1.13.0" });
    expect(fake.calls[0]?.model).toBe("jev-1.13.0");
  });
});

describe("classifyDiff", () => {
  it("maps the choice and fills missing probabilities", async () => {
    const fake = fakeFetch({
      choice: { choice: "behavioral", confidence: 0.81, probabilities: { behavioral: 0.81 } },
    });
    setFetchForTesting(fake.fetch);
    const result = await classifyDiff({
      previous: "Refund issued.",
      current: "No refund is possible.",
      intent: "whether a refund happens",
    });
    expect(result.kind).toBe("behavioral");
    expect(result.confidence).toBe(0.81);
    expect(result.probabilities).toEqual({ behavioral: 0.81, cosmetic: 0, unclear: 0 });
    expect(fake.calls[0]?.state).toEqual({
      previous: "Refund issued.",
      current: "No refund is possible.",
    });
    expect(result.question.type).toBe("choice");
  });

  it("falls back to unclear for an unknown label", async () => {
    const fake = fakeFetch({
      choice: { choice: "something-else", confidence: 0.3, probabilities: {} },
    });
    setFetchForTesting(fake.fetch);
    const result = await classifyDiff({ previous: "a", current: "b" });
    expect(result.kind).toBe("unclear");
  });
});

describe("stats", () => {
  it("counts requests, questions, tokens and cache hits", async () => {
    configure({ cache: "memory" });
    resetCache();
    const fake = fakeFetch();
    setFetchForTesting(fake.fetch);
    await satisfiesAll("hello", ["greets", "is short"]);
    await satisfies({ subject: "hello", expectation: "greets" });
    const stats = getStats();
    expect(stats.requests).toBe(1);
    expect(stats.questions).toBe(2);
    expect(stats.cacheHits).toBe(1);
    expect(stats.inputTokens).toBe(10);
    expect(stats.outputTokens).toBe(2);
    expect(stats.totalLatencyMs).toBeGreaterThanOrEqual(0);
    resetStats();
    expect(getStats().requests).toBe(0);
  });
});

describe("api errors", () => {
  it("maps a 401 to a helpful JevtestAPIError with the SDK error as cause", async () => {
    const fake = fakeFetch({ status: 401 });
    setFetchForTesting(fake.fetch);
    const error = await satisfies({ subject: "hi", expectation: "greets" }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(JevtestAPIError);
    const apiError = error as JevtestAPIError;
    expect(apiError.status).toBe(401);
    expect(apiError.message).toMatch(/API key/);
    expect(apiError.message).toMatch(/TYPESAFE_API_KEY/);
    expect(apiError.cause).toBeInstanceOf(AuthenticationError);
  });

  it("rejects every judgment in a failed batch", async () => {
    const fake = fakeFetch({ status: 500 });
    setFetchForTesting(fake.fetch);
    const results = await Promise.allSettled([
      satisfies({ subject: "hi", expectation: "greets" }),
      satisfies({ subject: "hi", expectation: "is short" }),
    ]);
    expect(fake.calls).toHaveLength(1);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toBeInstanceOf(JevtestAPIError);
    }
  });
});
