/**
 * Jest adapter. Jest is a secondary target, so this file stays thin and does
 * not import from jest at all: pass in the `expect` you already have.
 *
 * ```ts
 * import { expect } from "@jest/globals";
 * import { setupJevtestJest } from "jevtest/jest";
 *
 * setupJevtestJest(expect);
 * ```
 *
 * Every matcher is asynchronous, so assertions must be awaited.
 */
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

/** The subset of jest's matcher state the adapter reads. */
interface JestMatcherState {
  isNot?: boolean;
  currentTestName?: string | undefined;
  testPath?: string | undefined;
  snapshotState?: unknown;
}

/** Anything with an `extend` method: jest's `expect`, or a stub in tests. */
export interface ExpectLike {
  extend(matchers: Record<string, unknown>): void;
}

function updateModeOf(state: JestMatcherState): "all" | "new" | "none" {
  const snapshotState = state.snapshotState as { _updateSnapshot?: unknown } | undefined;
  const mode = snapshotState?._updateSnapshot;
  if (mode === "all" || mode === "new" || mode === "none") return mode;
  if (process.env.JEVTEST_UPDATE === "1") return "all";
  if (process.env.CI) return "none";
  return "new";
}

function contextOf(state: JestMatcherState): MatcherContext {
  return {
    isNot: state.isNot === true,
    currentTestName: state.currentTestName,
    testPath: state.testPath,
    updateSnapshot: updateModeOf(state),
  };
}

/** The raw matcher object, for callers that register it themselves. */
export const jevtestJestMatchers = {
  toSatisfy(
    this: JestMatcherState,
    received: unknown,
    expectation: Expectation,
    opts?: SatisfyMatcherOptions,
  ): Promise<MatcherResult> {
    return coreToSatisfy(contextOf(this), received, expectation, opts);
  },
  toSatisfyAll(
    this: JestMatcherState,
    received: unknown,
    expectations: Expectation[],
    opts?: SatisfyMatcherOptions,
  ): Promise<MatcherResult> {
    return coreToSatisfyAll(contextOf(this), received, expectations, opts);
  },
  toMatchSemanticSnapshot(
    this: JestMatcherState,
    received: unknown,
    opts?: SnapshotMatcherOptions,
  ): Promise<MatcherResult> {
    return coreToMatchSemanticSnapshot(contextOf(this), received, opts);
  },
};

function registerBeforeEach(): void {
  const hook = (globalThis as { beforeEach?: unknown }).beforeEach;
  if (typeof hook === "function") {
    (hook as (fn: () => void) => void)(() => {
      resetSnapshotCounters();
    });
  }
}

/** Register the matchers on the given `expect` and optionally override config. */
export function setupJevtestJest(expectLike: ExpectLike, overrides?: Partial<JevtestConfig>): void {
  if (overrides !== undefined) configure(overrides);
  expectLike.extend(jevtestJestMatchers);
  registerBeforeEach();
}

/** Register on the global `expect`, the way a jest `setupFilesAfterEach` entry would. */
export default function setupJevtestJestGlobal(overrides?: Partial<JevtestConfig>): void {
  const globalExpect = (globalThis as { expect?: unknown }).expect;
  if (typeof globalExpect !== "function" && typeof globalExpect !== "object") {
    throw new Error("jevtest/jest: no global expect found; call setupJevtestJest(expect) instead");
  }
  setupJevtestJest(globalExpect as ExpectLike, overrides);
}

declare global {
  namespace jest {
    interface Matchers<R> {
      /** Assert that the value satisfies a plain-English expectation. Must be awaited. */
      toSatisfy(expectation: Expectation, opts?: SatisfyMatcherOptions): Promise<R>;
      /** Assert several expectations about one value in a single request. Must be awaited. */
      toSatisfyAll(expectations: Expectation[], opts?: SatisfyMatcherOptions): Promise<R>;
      /** Compare with a stored baseline and fail only on behavioral changes. Must be awaited. */
      toMatchSemanticSnapshot(opts?: SnapshotMatcherOptions): Promise<R>;
    }
  }
}
