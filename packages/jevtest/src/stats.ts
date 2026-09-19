/** Process-wide counters, updated by the batch flush and the cache lookups. */
import type { Stats } from "./types.js";

const counters: Stats = {
  requests: 0,
  questions: 0,
  cacheHits: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalLatencyMs: 0,
};

/** A copy of the counters collected so far. */
export function getStats(): Stats {
  return { ...counters };
}

/** Zero every counter. */
export function resetStats(): void {
  counters.requests = 0;
  counters.questions = 0;
  counters.cacheHits = 0;
  counters.inputTokens = 0;
  counters.outputTokens = 0;
  counters.totalLatencyMs = 0;
}

/** Called once per API request, whether or not it succeeded. */
export function recordRequest(request: {
  questions: number;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}): void {
  counters.requests += 1;
  counters.questions += request.questions;
  counters.totalLatencyMs += request.latencyMs;
  counters.inputTokens += request.inputTokens ?? 0;
  counters.outputTokens += request.outputTokens ?? 0;
}

/** Called once per judgment served from the cache. */
export function recordCacheHit(): void {
  counters.cacheHits += 1;
}
