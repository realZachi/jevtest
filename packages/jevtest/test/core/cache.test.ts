import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetBatch } from "../../src/batch.js";
import { FileCache, flushCache, getCache, resetCache } from "../../src/cache.js";
import { setFetchForTesting } from "../../src/client.js";
import { configure, resetConfig } from "../../src/config.js";
import { JevtestReplayMissError } from "../../src/errors.js";
import { satisfies } from "../../src/judge.js";
import { CACHE_VERSION } from "../../src/questions.js";
import { getStats, resetStats } from "../../src/stats.js";
import { fakeFetch } from "./fake.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "jevtest-cache-"));
  resetConfig();
  configure({ apiKey: "test-key", cacheDir: dir });
  resetCache();
  resetBatch();
  resetStats();
});

afterEach(() => {
  setFetchForTesting(undefined);
  resetCache();
  resetConfig();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("memory cache", () => {
  it("serves a repeated judgment without a request", async () => {
    const fake = fakeFetch();
    setFetchForTesting(fake.fetch);
    const first = await satisfies({ subject: "hello", expectation: "greets" });
    const second = await satisfies({ subject: "hello", expectation: "greets" });
    expect(fake.calls).toHaveLength(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.probability).toBe(first.probability);
    expect(second.latencyMs).toBe(0);
    expect(getStats().cacheHits).toBe(1);
  });

  it("does not cache when cache is off", async () => {
    configure({ cache: "off" });
    resetCache();
    const fake = fakeFetch();
    setFetchForTesting(fake.fetch);
    await satisfies({ subject: "hello", expectation: "greets" });
    await satisfies({ subject: "hello", expectation: "greets" });
    expect(fake.calls).toHaveLength(2);
  });
});

describe("record mode", () => {
  it("writes cache.json even when the configured cache is memory", async () => {
    configure({ mode: "record", cache: "memory" });
    resetCache();
    const fake = fakeFetch();
    setFetchForTesting(fake.fetch);
    await satisfies({ subject: "hello", expectation: "greets" });
    await flushCache();
    const file = path.join(dir, "cache.json");
    expect(fs.existsSync(file)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      version: number;
      entries: Record<string, { type: string; noul: number; model: string }>;
    };
    expect(parsed.version).toBe(CACHE_VERSION);
    expect(Object.values(parsed.entries)).toEqual([{ type: "noul", noul: 0.9, model: "jev-test" }]);
  });
});

describe("replay mode", () => {
  it("throws on a miss with the expectation text and how to record", async () => {
    configure({ mode: "replay" });
    resetCache();
    const error = await satisfies({ subject: "hello", expectation: "greets warmly" }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(JevtestReplayMissError);
    expect((error as Error).message).toContain("greets warmly");
    expect((error as Error).message).toContain("JEVTEST_MODE=record");
  });

  it("serves a recorded answer without a key", async () => {
    configure({ mode: "record" });
    resetCache();
    const fake = fakeFetch();
    setFetchForTesting(fake.fetch);
    await satisfies({ subject: "hello", expectation: "greets" });
    await flushCache();

    setFetchForTesting(undefined);
    resetCache();
    resetConfig();
    configure({ mode: "replay", cacheDir: dir });
    const replayed = await satisfies({ subject: "hello", expectation: "greets" });
    expect(replayed.cached).toBe(true);
    expect(replayed.probability).toBe(0.9);
  });
});

describe("FileCache", () => {
  it("merges entries written by another process", async () => {
    const cache = new FileCache(dir);
    cache.set("a", { type: "noul", noul: 0.1, model: "jev-test" });
    await cache.flush();

    fs.writeFileSync(
      path.join(dir, "cache.json"),
      JSON.stringify({
        version: CACHE_VERSION,
        entries: {
          a: { type: "noul", noul: 0.1, model: "jev-test" },
          b: { type: "noul", noul: 0.2, model: "jev-test" },
        },
      }),
    );

    cache.set("c", { type: "noul", noul: 0.3, model: "jev-test" });
    await cache.flush();
    cache.dispose();

    const parsed = JSON.parse(fs.readFileSync(path.join(dir, "cache.json"), "utf8")) as {
      entries: Record<string, unknown>;
    };
    expect(Object.keys(parsed.entries).sort()).toEqual(["a", "b", "c"]);
  });

  it("ignores a corrupt or stale file", () => {
    fs.writeFileSync(path.join(dir, "cache.json"), "{not json");
    const corrupt = new FileCache(dir);
    expect(corrupt.size()).toBe(0);
    corrupt.dispose();
    fs.writeFileSync(path.join(dir, "cache.json"), JSON.stringify({ version: 999, entries: {} }));
    const stale = new FileCache(dir);
    expect(stale.size()).toBe(0);
    stale.dispose();
  });

  it("uses the file cache when configured", () => {
    configure({ cache: "file" });
    resetCache();
    expect(getCache()).toBeInstanceOf(FileCache);
  });
});
