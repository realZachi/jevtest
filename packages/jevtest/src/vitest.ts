/**
 * Vitest adapter. Registers the semantic matchers on vitest's `expect`.
 *
 * Every matcher is asynchronous, so assertions must be awaited:
 *
 * ```ts
 * await expect(reply).toSatisfy("apologizes politely");
 * await expect(reply).not.toSatisfy("promises a refund");
 * await expect(reply).toMatchSemanticSnapshot({ intent: "the refund policy" });
 * ```
 *
 * Forgetting the `await` makes the assertion a floating promise that vitest
 * cannot report on.
 */
import { beforeEach, expect } from "vitest";
import { configure } from "./config.js";
import type { MatcherContext } from "./matchers/core.js";
import {
  toMatchSemanticSnapshot as coreToMatchSemanticSnapshot,
  toSatisfy as coreToSatisfy,
  toSatisfyAll as coreToSatisfyAll,
} from "./matchers/core.js";
import { resetSnapshotCounters } from "./snapshot/store.js";
import type {
  Expectation,
  JevtestConfig,
  MatcherResult,
  SatisfyMatcherOptions,
  SnapshotMatcherOptions,
} from "./types.js";

type UpdateSnapshot = "all" | "new" | "none";

/** The parts of vitest's `MatcherState` this adapter reads. */
interface VitestMatcherState {
  isNot: boolean;
  currentTestName?: string | undefined;
  testPath?: string | undefined;
  snapshotState?: unknown;
}

function isUpdateSnapshot(value: unknown): value is UpdateSnapshot {
  return value === "all" || value === "new" || value === "none";
}

/**
 * Vitest 5 exposes the update mode as the public getter
 * `snapshotState.snapshotUpdateState`; older versions only had the private
 * `_updateSnapshot`. When neither is readable, fall back to the environment.
 */
function updateModeOf(state: VitestMatcherState): UpdateSnapshot {
  const snapshotState = state.snapshotState as
    | { snapshotUpdateState?: unknown; _updateSnapshot?: unknown }
    | undefined;
  if (snapshotState !== null && typeof snapshotState === "object") {
    if (isUpdateSnapshot(snapshotState.snapshotUpdateState)) {
      return snapshotState.snapshotUpdateState;
    }
    if (isUpdateSnapshot(snapshotState._updateSnapshot)) return snapshotState._updateSnapshot;
  }
  if (process.env.JEVTEST_UPDATE === "1") return "all";
  if (process.env.CI) return "none";
  return "new";
}

function contextOf(state: VitestMatcherState): MatcherContext {
  return {
    isNot: state.isNot === true,
    currentTestName: state.currentTestName,
    testPath: state.testPath,
    updateSnapshot: updateModeOf(state),
  };
}

/** vitest 5 ships a built-in `toSatisfy(predicate)`; keep that form working. */
function predicateFallback(
  state: VitestMatcherState,
  received: unknown,
  predicate: (value: unknown) => boolean,
  customMessage?: string,
): MatcherResult {
  const pass = predicate(received) === true;
  return {
    pass,
    message: () =>
      customMessage ?? `expected value to ${state.isNot ? "not " : ""}satisfy the given predicate`,
    actual: received,
  };
}

/** The raw matcher object, for callers that want to register it themselves. */
export const jevtestMatchers = {
  toSatisfy(
    this: VitestMatcherState,
    received: unknown,
    expectation: Expectation | ((value: unknown) => boolean),
    opts?: SatisfyMatcherOptions | string,
  ): MatcherResult | Promise<MatcherResult> {
    if (typeof expectation === "function") {
      return predicateFallback(
        this,
        received,
        expectation,
        typeof opts === "string" ? opts : undefined,
      );
    }
    return coreToSatisfy(
      contextOf(this),
      received,
      expectation,
      typeof opts === "string" ? undefined : opts,
    );
  },
  toSatisfyAll(
    this: VitestMatcherState,
    received: unknown,
    expectations: Expectation[],
    opts?: SatisfyMatcherOptions,
  ): Promise<MatcherResult> {
    return coreToSatisfyAll(contextOf(this), received, expectations, opts);
  },
  toMatchSemanticSnapshot(
    this: VitestMatcherState,
    received: unknown,
    opts?: SnapshotMatcherOptions,
  ): Promise<MatcherResult> {
    return coreToMatchSemanticSnapshot(contextOf(this), received, opts);
  },
};

/** Register the matchers. Safe to call more than once. */
export function registerJevtestMatchers(): void {
  expect.extend(jevtestMatchers);
}

/**
 * Register the matchers and optionally override the configuration.
 * Call it once, usually from a vitest `setupFiles` entry.
 */
export function setupJevtest(overrides?: Partial<JevtestConfig>): void {
  if (overrides !== undefined) configure(overrides);
  registerJevtestMatchers();
}

// Snapshot call indexes are per test, so reset them before each one. Registering
// a hook is valid from a setup file or a test file; outside a runner it throws.
try {
  beforeEach(() => {
    resetSnapshotCounters();
  });
} catch {
  // No runner collecting hooks right now; counters simply stay global.
}

declare module "vitest" {
  interface Assertion<R extends void | Promise<void> = void, T = unknown> {
    /**
     * Assert that the value satisfies a plain-English expectation. Must be awaited.
     * The predicate form from vitest's own `toSatisfy` keeps working.
     */
    toSatisfy: ((expectation: Expectation, opts?: SatisfyMatcherOptions) => Promise<void>) &
      ((matcher: (value: unknown) => boolean, message?: string) => R);
    /** Assert several expectations about one value in a single request. Must be awaited. */
    toSatisfyAll: (expectations: Expectation[], opts?: SatisfyMatcherOptions) => Promise<void>;
    /** Compare with a stored baseline and fail only on behavioral changes. Must be awaited. */
    toMatchSemanticSnapshot: (opts?: SnapshotMatcherOptions) => Promise<void>;
  }
  interface AsymmetricMatchersContaining {
    toSatisfyAll: (expectations: Expectation[], opts?: SatisfyMatcherOptions) => unknown;
    toMatchSemanticSnapshot: (opts?: SnapshotMatcherOptions) => unknown;
  }
}
