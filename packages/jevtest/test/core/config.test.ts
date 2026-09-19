import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetCache } from "../../src/cache.js";
import { resetClient, setFetchForTesting } from "../../src/client.js";
import { configure, getConfig, resetConfig } from "../../src/config.js";
import { JevtestConfigError } from "../../src/errors.js";
import { satisfies } from "../../src/judge.js";

const ENV_KEYS = [
  "TYPESAFE_API_KEY",
  "TYPESAFE_BASE_URL",
  "JEVTEST_MODEL",
  "JEVTEST_THRESHOLD",
  "JEVTEST_NOT_THRESHOLD",
  "JEVTEST_SNAPSHOT_THRESHOLD",
  "JEVTEST_CACHE",
  "JEVTEST_CACHE_DIR",
  "JEVTEST_MODE",
  "JEVTEST_TIMEOUT",
  "JEVTEST_BATCH_WINDOW_MS",
  "JEVTEST_EXCERPT_LENGTH",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  resetConfig();
  resetCache();
  resetClient();
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfig();
  resetCache();
  setFetchForTesting(undefined);
});

describe("defaults", () => {
  it("resolves the documented defaults", () => {
    const config = getConfig();
    expect(config).toMatchObject({
      model: "jev-latest",
      threshold: 0.85,
      notThreshold: 0.15,
      snapshotThreshold: 0.8,
      cache: "memory",
      cacheDir: path.join(process.cwd(), ".jevtest"),
      mode: "live",
      timeout: 15000,
      batchWindowMs: 0,
      excerptLength: 400,
    });
    expect(config.apiKey).toBeUndefined();
  });

  it("returns a frozen copy", () => {
    const config = getConfig();
    expect(Object.isFrozen(config)).toBe(true);
    expect(getConfig()).not.toBe(config);
  });
});

describe("resolution order", () => {
  it("reads the environment lazily", () => {
    expect(getConfig().model).toBe("jev-latest");
    process.env.JEVTEST_MODEL = "jev-1.13.0";
    process.env.JEVTEST_THRESHOLD = "0.6";
    process.env.JEVTEST_CACHE = "off";
    process.env.JEVTEST_MODE = "record";
    const config = getConfig();
    expect(config.model).toBe("jev-1.13.0");
    expect(config.threshold).toBe(0.6);
    expect(config.notThreshold).toBe(0.4);
    expect(config.cache).toBe("off");
    expect(config.mode).toBe("record");
  });

  it("lets configure() win over the environment", () => {
    process.env.JEVTEST_MODEL = "from-env";
    configure({ model: "explicit" });
    expect(getConfig().model).toBe("explicit");
    resetConfig();
    expect(getConfig().model).toBe("from-env");
  });

  it("merges successive configure() calls", () => {
    configure({ threshold: 0.9 });
    configure({ excerptLength: 40 });
    expect(getConfig().threshold).toBe(0.9);
    expect(getConfig().excerptLength).toBe(40);
  });
});

describe("validation", () => {
  it("rejects out-of-range thresholds", () => {
    expect(() => configure({ threshold: 1.5 })).toThrow(JevtestConfigError);
    expect(() => configure({ snapshotThreshold: -1 })).toThrow(/probability between 0 and 1/);
  });

  it("rejects notThreshold above threshold", () => {
    expect(() => configure({ threshold: 0.5, notThreshold: 0.9 })).toThrow(
      /must be less than or equal to threshold/,
    );
  });

  it("rejects unknown enum values", () => {
    expect(() => configure({ cache: "disk" as never })).toThrow(/memory, file, off/);
    process.env.JEVTEST_MODE = "dry-run";
    expect(() => getConfig()).toThrow(/JEVTEST_MODE must be one of live, record, replay/);
  });

  it("rejects non-numeric numeric env values", () => {
    process.env.JEVTEST_TIMEOUT = "soon";
    expect(() => getConfig()).toThrow(/JEVTEST_TIMEOUT must be a number/);
  });

  it("keeps a bad configure() call from changing the config", () => {
    configure({ model: "kept" });
    expect(() => configure({ threshold: 2 })).toThrow(JevtestConfigError);
    expect(getConfig().model).toBe("kept");
  });
});

describe("missing api key", () => {
  it("does not throw at configure or getConfig time", () => {
    expect(() => configure({ model: "jev-latest" })).not.toThrow();
    expect(() => getConfig()).not.toThrow();
  });

  it("throws a helpful error at the first live judgment", async () => {
    await expect(satisfies({ subject: "hi", expectation: "greets" })).rejects.toThrow(
      /TYPESAFE_API_KEY/,
    );
    await expect(satisfies({ subject: "hi", expectation: "greets" })).rejects.toThrow(
      /https:\/\/typesafe\.ai/,
    );
    await expect(satisfies({ subject: "hi", expectation: "greets" })).rejects.toThrow(/replay/);
  });
});
