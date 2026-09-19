export type { CachedAnswer, JudgmentCache } from "./cache.js";
export { flushCache, resetCache } from "./cache.js";
export { resetClient, setFetchForTesting } from "./client.js";
export { configure, getConfig, resetConfig } from "./config.js";
export {
  JevtestAPIError,
  JevtestConfigError,
  JevtestError,
  JevtestReplayMissError,
} from "./errors.js";
export { classifyDiff, satisfies, satisfiesAll } from "./judge.js";
export { CACHE_VERSION, normalizeExpectation, serializeSubject } from "./questions.js";
export { getStats, resetStats } from "./stats.js";
export * from "./types.js";
