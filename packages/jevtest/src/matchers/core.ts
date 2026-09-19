/**
 * Framework-agnostic matcher implementations. `vitest.ts` and `jest.ts` are
 * thin adapters over these; nothing here imports a test framework.
 */
import { getConfig } from "../config.js";
import {
  renderAmbiguous,
  renderReplayMissHint,
  renderSatisfyAllFailure,
  renderSatisfyFailure,
  renderSnapshotFailure,
  subjectText,
} from "../format.js";
import { classifyDiff, satisfies, satisfiesAll } from "../judge.js";
import {
  nextSnapshotIndex,
  readSnapshot,
  snapshotFileFor,
  writeSnapshot,
} from "../snapshot/store.js";
import type {
  Context,
  Expectation,
  MatcherResult,
  SatisfyMatcherOptions,
  SatisfyResult,
  SnapshotMatcherOptions,
  Subject,
} from "../types.js";

/** What a matcher needs to know about the surrounding test run. */
export interface MatcherContext {
  isNot: boolean;
  currentTestName?: string | undefined;
  testPath?: string | undefined;
  updateSnapshot?: "all" | "new" | "none" | undefined;
}

function message(text: string): () => string {
  return () => text;
}

/**
 * Structural failures (bad input, unsupported usage) must fail in both
 * polarities. vitest and jest invert `pass` for `.not`, so mirror it here.
 */
function structuralFailure(ctx: MatcherContext, text: string): MatcherResult {
  return { pass: ctx.isNot, message: message(text) };
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return typeof value;
}

/** True when the value is a string or a plain JSON value all the way down. */
function checkSerializable(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): string | undefined {
  const type = typeof value;
  if (value === null || type === "string" || type === "boolean") return undefined;
  if (type === "number") {
    return Number.isFinite(value) ? undefined : `${path || "received"} is ${describeValue(value)}`;
  }
  if (type !== "object") return `${path || "received"} is a ${describeValue(value)}`;
  const obj = value as object;
  if (seen.has(obj)) return `${path || "received"} is circular`;
  seen.add(obj);
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const failure = checkSerializable(item, `${path}[${index}]`, seen);
      if (failure !== undefined) return failure;
    }
    return undefined;
  }
  if (Object.getPrototypeOf(obj) !== Object.prototype && Object.getPrototypeOf(obj) !== null) {
    return `${path || "received"} is a ${obj.constructor?.name ?? "non-plain object"}`;
  }
  for (const [key, item] of Object.entries(obj as Record<string, unknown>)) {
    const failure = checkSerializable(item, path === "" ? key : `${path}.${key}`, seen);
    if (failure !== undefined) return failure;
  }
  return undefined;
}

interface SubjectCheck {
  subject?: Subject;
  error?: string;
}

function asSubject(received: unknown, matcher: string): SubjectCheck {
  if (typeof received === "string") return { subject: received };
  const failure = checkSerializable(received, "", new WeakSet());
  if (failure === undefined) return { subject: received as Subject };
  return {
    error: [
      `expect(output).${matcher}(…)`,
      "",
      `  received is not a string or a JSON-serializable value: ${failure}.`,
      "  jevtest did not call the model.",
    ].join("\n"),
  };
}

/** Adds a replay hint to core errors that mean "nothing recorded", then rethrows. */
function rethrowWithHint(error: unknown): never {
  const isReplayMiss =
    error instanceof Error &&
    (error.name === "JevtestReplayMissError" || /replay/i.test(error.message));
  if (error instanceof Error && isReplayMiss) {
    error.message = `${error.message}\n\n${renderReplayMissHint()}`;
  }
  throw error;
}

function judgeOptions(opts: SatisfyMatcherOptions | undefined): {
  context?: Context;
  model?: string;
} {
  const out: { context?: Context; model?: string } = {};
  if (opts?.context !== undefined) out.context = opts.context;
  if (opts?.model !== undefined) out.model = opts.model;
  return out;
}

/**
 * Assert that the subject satisfies one plain-English expectation.
 *
 * Positive form passes when `p >= min`, `.not` passes when `p <= max`.
 * Probabilities between the two bounds fail both forms as "ambiguous".
 */
export async function toSatisfy(
  ctx: MatcherContext,
  received: unknown,
  expectation: Expectation,
  opts?: SatisfyMatcherOptions,
): Promise<MatcherResult> {
  const check = asSubject(received, "toSatisfy");
  if (check.error !== undefined) return structuralFailure(ctx, check.error);
  const subject = check.subject as Subject;

  const config = getConfig();
  const min = opts?.min ?? config.threshold;
  const max = opts?.max ?? config.notThreshold;

  let result: SatisfyResult;
  try {
    result = await satisfies({ subject, expectation, ...judgeOptions(opts) });
  } catch (error) {
    rethrowWithHint(error);
  }

  const p = result.probability;
  const ok = ctx.isNot ? p <= max : p >= min;
  const ambiguous = p > max && p < min;
  const shared = {
    expectation,
    probability: p,
    isNot: ctx.isNot,
    subject,
    context: opts?.context,
    model: result.model,
    cached: result.cached,
    latencyMs: result.latencyMs,
    excerptLength: config.excerptLength,
  };
  const text = ambiguous
    ? renderAmbiguous({ ...shared, min, max })
    : renderSatisfyFailure({ ...shared, threshold: ctx.isNot ? max : min });

  return {
    // The framework inverts `pass` for `.not`, so report the positive outcome.
    pass: ctx.isNot ? !ok : ok,
    message: message(text),
    actual: p,
    expected: ctx.isNot ? max : min,
  };
}

/**
 * Assert several expectations about one subject in a single API request.
 *
 * The positive form passes when every expectation reaches `min`; `.not`
 * passes only when EVERY expectation stays at or below `max` (it is not
 * "at least one fails").
 */
export async function toSatisfyAll(
  ctx: MatcherContext,
  received: unknown,
  expectations: Expectation[],
  opts?: SatisfyMatcherOptions,
): Promise<MatcherResult> {
  const check = asSubject(received, "toSatisfyAll");
  if (check.error !== undefined) return structuralFailure(ctx, check.error);
  const subject = check.subject as Subject;
  if (expectations.length === 0) {
    return structuralFailure(
      ctx,
      "expect(output).toSatisfyAll([]) needs at least one expectation.",
    );
  }

  const config = getConfig();
  const min = opts?.min ?? config.threshold;
  const max = opts?.max ?? config.notThreshold;

  let results: SatisfyResult[];
  try {
    results = await satisfiesAll(subject, expectations, judgeOptions(opts));
  } catch (error) {
    rethrowWithHint(error);
  }

  const entries = expectations.map((expectation, index) => {
    const p = results[index]?.probability ?? 0;
    return { expectation, probability: p, ok: ctx.isNot ? p <= max : p >= min };
  });
  const allOk = entries.every((entry) => entry.ok);
  const first = results[0];

  const text = renderSatisfyAllFailure({
    entries,
    threshold: ctx.isNot ? max : min,
    isNot: ctx.isNot,
    subject,
    context: opts?.context,
    model: first?.model ?? config.model,
    cached: results.every((result) => result.cached),
    latencyMs: Math.max(0, ...results.map((result) => result.latencyMs)),
    excerptLength: config.excerptLength,
  });

  return {
    pass: ctx.isNot ? !allOk : allOk,
    message: message(text),
    actual: entries.map((entry) => entry.probability),
    expected: ctx.isNot ? max : min,
  };
}

function snapshotKeyFor(ctx: MatcherContext, opts: SnapshotMatcherOptions | undefined): string {
  if (opts?.name !== undefined) return opts.name;
  const testName = ctx.currentTestName ?? "unnamed test";
  return `${testName} ${nextSnapshotIndex(ctx.testPath, testName)}`;
}

/**
 * Compare the output with a stored baseline and let the model decide whether
 * the difference is cosmetic or behavioral. Identical output never calls the API.
 */
export async function toMatchSemanticSnapshot(
  ctx: MatcherContext,
  received: unknown,
  opts?: SnapshotMatcherOptions,
): Promise<MatcherResult> {
  if (ctx.isNot) {
    return structuralFailure(
      ctx,
      ".not.toMatchSemanticSnapshot() is not supported: a snapshot has no meaningful negation.",
    );
  }
  const check = asSubject(received, "toMatchSemanticSnapshot");
  if (check.error !== undefined) return structuralFailure(ctx, check.error);
  const subject = check.subject as Subject;

  const config = getConfig();
  const key = snapshotKeyFor(ctx, opts);
  const current = subjectText(subject);
  const stored = readSnapshot(ctx.testPath, key);
  const update = ctx.updateSnapshot ?? "new";
  const file = snapshotFileFor(ctx.testPath);

  if (stored === undefined) {
    if (update === "none") {
      return {
        pass: false,
        message: message(
          [
            "expect(output).toMatchSemanticSnapshot()",
            "",
            `  new snapshot not written in CI: ${file} > ${key}`,
            "  hint: run the suite locally and commit the snapshot file.",
          ].join("\n"),
        ),
      };
    }
    writeSnapshot(ctx.testPath, key, current);
    return { pass: true, message: message(`written new semantic snapshot: ${key}`) };
  }

  if (stored === current) {
    return { pass: true, message: message(`semantic snapshot matched exactly: ${key}`) };
  }

  if (update === "all") {
    writeSnapshot(ctx.testPath, key, current);
    return { pass: true, message: message(`semantic snapshot updated: ${key}`) };
  }

  const min = opts?.min ?? config.snapshotThreshold;
  let classification: Awaited<ReturnType<typeof classifyDiff>>;
  try {
    classification = await classifyDiff({
      previous: stored,
      current: subject,
      ...(opts?.intent === undefined ? {} : { intent: opts.intent }),
      ...(opts?.context === undefined ? {} : { context: opts.context }),
      ...(opts?.model === undefined ? {} : { model: opts.model }),
    });
  } catch (error) {
    rethrowWithHint(error);
  }

  const cosmetic = classification.probabilities.cosmetic;
  const pass = classification.kind === "cosmetic" && cosmetic >= min;

  // On a cosmetic pass the baseline is deliberately left alone, so repeated
  // runs keep judging against the same reference text.
  const text = pass
    ? `semantic snapshot differs cosmetically (cosmetic ${cosmetic.toFixed(2)}); baseline kept: ${key}`
    : renderSnapshotFailure({
        classification,
        min,
        previous: stored,
        current,
        snapshotFile: file,
        snapshotKey: key,
        ...(opts?.intent === undefined ? {} : { intent: opts.intent }),
        ...(opts?.context === undefined ? {} : { context: opts.context }),
        excerptLength: config.excerptLength,
      });

  return { pass, message: message(text), actual: classification.kind, expected: "cosmetic" };
}
