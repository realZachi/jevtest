/**
 * Configuration resolution: explicit `configure()` values win over environment
 * variables, which win over defaults. The environment is read lazily inside
 * `getConfig()` so tests can change `process.env` and call `resetConfig()`.
 */
import path from "node:path";
import { JevtestConfigError } from "./errors.js";
import type { CacheMode, JevtestConfig, RunMode } from "./types.js";

const CACHE_MODES = ["memory", "file", "off"] as const;
const RUN_MODES = ["live", "record", "replay"] as const;

const DEFAULTS = {
  model: "jev-latest",
  threshold: 0.85,
  snapshotThreshold: 0.8,
  cache: "memory" as CacheMode,
  mode: "live" as RunMode,
  timeout: 15_000,
  batchWindowMs: 0,
  excerptLength: 400,
} as const;

let overrides: Partial<JevtestConfig> = {};

/**
 * Merge explicit configuration. Values set here take precedence over the
 * environment for the rest of the process, or until `resetConfig()`.
 *
 * @throws {JevtestConfigError} A value is out of range or not a valid enum member.
 */
export function configure(next: Partial<JevtestConfig>): void {
  const candidate = { ...overrides, ...next };
  resolve(candidate); // validates before storing
  overrides = candidate;
}

/** The fully resolved, frozen configuration. */
export function getConfig(): JevtestConfig {
  return Object.freeze(resolve(overrides));
}

/** Forget every explicit override. Environment and defaults apply again. */
export function resetConfig(): void {
  overrides = {};
}

/**
 * The error thrown at the first live judgment when no API key is available.
 * Never thrown at import or `configure()` time.
 */
export function missingApiKeyError(): JevtestConfigError {
  return new JevtestConfigError(
    "No TypeSafe API key. Set TYPESAFE_API_KEY (get one at https://typesafe.ai) " +
      "or configure({ apiKey }). To run without a key, record the answers once with " +
      'JEVTEST_MODE=record and then run with mode: "replay".',
  );
}

function resolve(explicit: Partial<JevtestConfig>): JevtestConfig {
  const env = process.env;
  const apiKey = explicit.apiKey ?? nonEmpty(env.TYPESAFE_API_KEY);
  const baseURL = explicit.baseURL ?? nonEmpty(env.TYPESAFE_BASE_URL);
  const threshold = clampCheck(
    "threshold",
    explicit.threshold ?? num("JEVTEST_THRESHOLD", env.JEVTEST_THRESHOLD) ?? DEFAULTS.threshold,
  );
  const notThreshold = clampCheck(
    "notThreshold",
    explicit.notThreshold ??
      num("JEVTEST_NOT_THRESHOLD", env.JEVTEST_NOT_THRESHOLD) ??
      round(1 - threshold),
  );
  if (notThreshold > threshold) {
    throw new JevtestConfigError(
      `notThreshold (${notThreshold}) must be less than or equal to threshold (${threshold}).`,
    );
  }
  const config: JevtestConfig = {
    model: explicit.model ?? nonEmpty(env.JEVTEST_MODEL) ?? DEFAULTS.model,
    threshold,
    notThreshold,
    snapshotThreshold: clampCheck(
      "snapshotThreshold",
      explicit.snapshotThreshold ??
        num("JEVTEST_SNAPSHOT_THRESHOLD", env.JEVTEST_SNAPSHOT_THRESHOLD) ??
        DEFAULTS.snapshotThreshold,
    ),
    cache: oneOf(
      "cache",
      "JEVTEST_CACHE",
      explicit.cache,
      env.JEVTEST_CACHE,
      CACHE_MODES,
      DEFAULTS.cache,
    ),
    cacheDir:
      explicit.cacheDir ?? nonEmpty(env.JEVTEST_CACHE_DIR) ?? path.join(process.cwd(), ".jevtest"),
    mode: oneOf("mode", "JEVTEST_MODE", explicit.mode, env.JEVTEST_MODE, RUN_MODES, DEFAULTS.mode),
    timeout: positive(
      "timeout",
      explicit.timeout ?? num("JEVTEST_TIMEOUT", env.JEVTEST_TIMEOUT) ?? DEFAULTS.timeout,
    ),
    batchWindowMs: nonNegative(
      "batchWindowMs",
      explicit.batchWindowMs ??
        num("JEVTEST_BATCH_WINDOW_MS", env.JEVTEST_BATCH_WINDOW_MS) ??
        DEFAULTS.batchWindowMs,
    ),
    excerptLength: positive(
      "excerptLength",
      explicit.excerptLength ??
        num("JEVTEST_EXCERPT_LENGTH", env.JEVTEST_EXCERPT_LENGTH) ??
        DEFAULTS.excerptLength,
    ),
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(baseURL === undefined ? {} : { baseURL }),
  };
  return config;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function num(name: string, value: string | undefined): number | undefined {
  const raw = nonEmpty(value);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new JevtestConfigError(`${name} must be a number, received ${JSON.stringify(raw)}.`);
  }
  return parsed;
}

function clampCheck(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new JevtestConfigError(
      `${name} must be a probability between 0 and 1, received ${value}.`,
    );
  }
  return value;
}

function positive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new JevtestConfigError(`${name} must be greater than 0, received ${value}.`);
  }
  return value;
}

function nonNegative(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new JevtestConfigError(`${name} must be 0 or greater, received ${value}.`);
  }
  return value;
}

function oneOf<T extends string>(
  name: string,
  envName: string,
  explicit: T | undefined,
  fromEnv: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = explicit ?? nonEmpty(fromEnv) ?? fallback;
  if (!allowed.includes(value as T)) {
    const source = explicit === undefined ? envName : name;
    throw new JevtestConfigError(
      `${source} must be one of ${allowed.join(", ")}, received ${JSON.stringify(value)}.`,
    );
  }
  return value as T;
}

/** Avoid 1 - 0.85 = 0.15000000000000002 showing up in messages and cache keys. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
