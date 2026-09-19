import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetBatch } from "../../src/batch.js";
import { resetCache } from "../../src/cache.js";
import { setFetchForTesting } from "../../src/client.js";
import { configure, resetConfig } from "../../src/config.js";
import { satisfies, satisfiesAll } from "../../src/judge.js";
import { resetStats } from "../../src/stats.js";
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

describe("batching", () => {
  it("sends three expectations about one subject as one request", async () => {
    const fake = fakeFetch();
    setFetchForTesting(fake.fetch);
    const results = await Promise.all([
      satisfies({ subject: "hello", expectation: "greets" }),
      satisfies({ subject: "hello", expectation: "is short" }),
      satisfies({ subject: "hello", expectation: "is in English" }),
    ]);
    expect(fake.calls).toHaveLength(1);
    expect(Object.keys(fake.calls[0]?.questions ?? {})).toEqual(["q0", "q1", "q2"]);
    expect(results.map((r) => r.probability)).toEqual([0.9, 0.9, 0.9]);
    expect(results.map((r) => r.model)).toEqual(["jev-test", "jev-test", "jev-test"]);
  });

  it("attributes usage to exactly one result of the batch", async () => {
    const fake = fakeFetch();
    setFetchForTesting(fake.fetch);
    const results = await satisfiesAll("hello", ["greets", "is short"]);
    expect(results.filter((r) => r.usage !== undefined)).toHaveLength(1);
    expect(results[0]?.usage).toEqual({ input_tokens: 10, output_tokens: 2 });
  });

  it("keeps satisfiesAll to a single request", async () => {
    const fake = fakeFetch();
    setFetchForTesting(fake.fetch);
    await satisfiesAll("hello", ["greets", "is short", "is polite"]);
    expect(fake.calls).toHaveLength(1);
    expect(Object.keys(fake.calls[0]?.questions ?? {})).toHaveLength(3);
  });

  it("splits different subjects into different requests", async () => {
    const fake = fakeFetch();
    setFetchForTesting(fake.fetch);
    await Promise.all([
      satisfies({ subject: "hello", expectation: "greets" }),
      satisfies({ subject: "goodbye", expectation: "greets" }),
    ]);
    expect(fake.calls).toHaveLength(2);
  });

  it("splits different models into different requests", async () => {
    const fake = fakeFetch();
    setFetchForTesting(fake.fetch);
    await Promise.all([
      satisfies({ subject: "hello", expectation: "greets" }),
      satisfies({ subject: "hello", expectation: "greets", model: "jev-1.13.0" }),
    ]);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls.map((c) => c.model).sort()).toEqual(["jev-1.13.0", "jev-latest"]);
  });

  it("asks an identical question only once", async () => {
    const fake = fakeFetch();
    setFetchForTesting(fake.fetch);
    const results = await Promise.all([
      satisfies({ subject: "hello", expectation: "greets" }),
      satisfies({ subject: "hello", expectation: "greets" }),
    ]);
    expect(fake.calls).toHaveLength(1);
    expect(Object.keys(fake.calls[0]?.questions ?? {})).toEqual(["q0"]);
    expect(results[0]?.probability).toBe(0.9);
    expect(results[1]?.probability).toBe(0.9);
  });

  it("flushes early past 32 questions", async () => {
    const fake = fakeFetch();
    setFetchForTesting(fake.fetch);
    const expectations = Array.from({ length: 33 }, (_, i) => `expectation ${i}`);
    const results = await satisfiesAll("hello", expectations);
    expect(results).toHaveLength(33);
    expect(fake.calls.map((c) => Object.keys(c.questions).length)).toEqual([32, 1]);
  });

  it("does not batch across ticks", async () => {
    const fake = fakeFetch();
    setFetchForTesting(fake.fetch);
    await satisfies({ subject: "hello", expectation: "greets" });
    await satisfies({ subject: "hello", expectation: "is short" });
    expect(fake.calls).toHaveLength(2);
  });

  it("sends only the documented state", async () => {
    const fake = fakeFetch();
    setFetchForTesting(fake.fetch);
    await satisfies({
      subject: "hello",
      expectation: "greets",
      context: { question: "say hi" },
    });
    expect(fake.calls[0]?.state).toEqual({ output: "hello", question: "say hi" });
  });
});
