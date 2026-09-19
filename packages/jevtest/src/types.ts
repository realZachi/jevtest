/**
 * Public types for jevtest. This file is the contract between the core
 * (judge/cache/batch/config) and the matcher layer (vitest/jest/snapshot).
 * Keep it dependency-free apart from SDK types.
 */
import type { ChoiceQuestion, JsonValue, NoulQuestion, Usage } from "@typesafe-ai/sdk";

export type { JsonValue, Usage };

/** Anything a test can assert on. Non-strings are serialized with stable key order. */
export type Subject = string | JsonValue;

/** Extra named state the model may need to judge the subject (e.g. the user's question). */
export type Context = Record<string, JsonValue>;

/**
 * An expectation written in plain English. The short string form is the common case;
 * the object form lets you sharpen the yes/no boundary.
 */
export type Expectation =
  | string
  | {
      /** The expectation, e.g. "apologizes politely". */
      text: string;
      /** What counts as satisfying the expectation. Maps to the Noul `true` criterion. */
      yes?: string;
      /** What counts as failing it. Maps to the Noul `false` criterion. */
      no?: string;
    };

export type CacheMode = "memory" | "file" | "off";

/**
 * live:   call the API, use cache for repeats.
 * record: call the API and persist every answer to the file cache.
 * replay: never call the API; a cache miss is an error. For CI without a key.
 */
export type RunMode = "live" | "record" | "replay";

export interface JevtestConfig {
  /** TypeSafe API key. Falls back to TYPESAFE_API_KEY. Resolved lazily at first judgment. */
  apiKey?: string;
  /** Falls back to TYPESAFE_BASE_URL. */
  baseURL?: string;
  /** Falls back to JEVTEST_MODEL, then "jev-latest". */
  model: string;
  /** Default minimum probability for toSatisfy. Falls back to JEVTEST_THRESHOLD, then 0.85. */
  threshold: number;
  /**
   * Maximum probability for `.not.toSatisfy`. Defaults to 1 - threshold.
   * Probabilities between notThreshold and threshold fail BOTH forms as "ambiguous".
   */
  notThreshold: number;
  /** Minimum probability of "cosmetic" for a semantic snapshot to pass. Default 0.8. */
  snapshotThreshold: number;
  /** Falls back to JEVTEST_CACHE, then "memory". */
  cache: CacheMode;
  /** Directory for the file cache and semantic snapshots. Default ".jevtest" in cwd. */
  cacheDir: string;
  /** Falls back to JEVTEST_MODE, then "live". */
  mode: RunMode;
  /** Per-request timeout in ms. Default 15000. */
  timeout: number;
  /** Coalescing window in ms for batching assertions on the same subject. Default 0 (next macrotask). */
  batchWindowMs: number;
  /** Max characters of the subject shown in failure messages. Default 400. */
  excerptLength: number;
}

export interface SatisfyRequest {
  subject: Subject;
  expectation: Expectation;
  context?: Context;
  /** Override the configured model for this judgment. */
  model?: string;
}

export interface SatisfyResult {
  /** Probability that the subject satisfies the expectation, 0..1. */
  probability: number;
  /** Model that answered, e.g. "jev-1.13.0". "cache" is never used here; see `cached`. */
  model: string;
  cached: boolean;
  latencyMs: number;
  /** The exact question sent, for debugging and failure messages. */
  question: NoulQuestion;
  /** The exact state sent. */
  state: { output: Subject } & Context;
  usage?: Usage;
}

export type DiffKind = "cosmetic" | "behavioral" | "unclear";

export interface DiffRequest {
  previous: Subject;
  current: Subject;
  /** What matters about this output, e.g. "the list of breaking changes and their versions". */
  intent?: string;
  context?: Context;
  model?: string;
}

export interface DiffClassification {
  kind: DiffKind;
  probabilities: Record<DiffKind, number>;
  confidence: number;
  model: string;
  cached: boolean;
  latencyMs: number;
  question: ChoiceQuestion;
  usage?: Usage;
}

export interface Stats {
  requests: number;
  questions: number;
  cacheHits: number;
  inputTokens: number;
  outputTokens: number;
  totalLatencyMs: number;
}

/** Options accepted by `toSatisfy` / `toSatisfyAll`. */
export interface SatisfyMatcherOptions {
  /** Minimum probability to pass. Overrides the configured threshold. */
  min?: number;
  /** Maximum probability for the `.not` form. Overrides the configured notThreshold. */
  max?: number;
  context?: Context;
  model?: string;
}

/** Options accepted by `toMatchSemanticSnapshot`. */
export interface SnapshotMatcherOptions {
  /** What matters about this output; sharpens the cosmetic/behavioral boundary. */
  intent?: string;
  /** Minimum probability of "cosmetic" to pass. Overrides snapshotThreshold. */
  min?: number;
  /** Explicit snapshot name; defaults to test name + call index. */
  name?: string;
  context?: Context;
  model?: string;
}

/** Framework-agnostic matcher result, compatible with vitest/jest `expect.extend`. */
export interface MatcherResult {
  pass: boolean;
  message: () => string;
  actual?: unknown;
  expected?: unknown;
}
