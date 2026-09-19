// STUB — replaced by the core implementer. Signatures are the contract.
import type { Stats } from "./types.js";

export function getStats(): Stats {
  return { requests: 0, questions: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0, totalLatencyMs: 0 };
}
export function resetStats(): void {}
