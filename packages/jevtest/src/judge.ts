/**
 * The judgments themselves: build the state and question, consult the cache,
 * honour the run mode, and otherwise batch the question into a request.
 */
import type { ChoiceResponse, NoulResponse } from "@typesafe-ai/sdk";
import { enqueue } from "./batch.js";
import { getCache } from "./cache.js";
import { getConfig } from "./config.js";
import { JevtestReplayMissError } from "./errors.js";
import {
  buildDiffQuestion,
  buildDiffState,
  buildSatisfyQuestion,
  buildState,
  normalizeExpectation,
  questionKey,
  stableStringify,
} from "./questions.js";
import { recordCacheHit } from "./stats.js";
import type {
  Context,
  DiffClassification,
  DiffKind,
  DiffRequest,
  Expectation,
  SatisfyRequest,
  SatisfyResult,
  Subject,
} from "./types.js";

const DIFF_KINDS: readonly DiffKind[] = ["cosmetic", "behavioral", "unclear"];

/**
 * Judge one expectation about one subject. Coalesced with other judgments on
 * the same state and model that start in the same tick.
 *
 * @throws {JevtestReplayMissError} The run is in replay mode and nothing was recorded.
 * @throws {JevtestAPIError} The request failed.
 */
export async function satisfies(req: SatisfyRequest): Promise<SatisfyResult> {
  const config = getConfig();
  const model = req.model ?? config.model;
  const state = buildState(req.subject, req.context);
  const question = buildSatisfyQuestion(req.expectation, req.context !== undefined);
  const key = questionKey(model, state, question);
  const cache = getCache();

  const cached = cache.get(key);
  if (cached?.type === "noul") {
    recordCacheHit();
    return {
      probability: cached.noul,
      model: cached.model,
      cached: true,
      latencyMs: 0,
      question,
      state,
    };
  }
  if (config.mode === "replay") {
    throw new JevtestReplayMissError(`"${normalizeExpectation(req.expectation).text}"`, key);
  }

  const result = await enqueue<NoulResponse>(stableStringify(state), state, question, model);
  cache.set(key, { type: "noul", noul: result.answer.noul, model: result.model });
  return {
    probability: result.answer.noul,
    model: result.model,
    cached: false,
    latencyMs: result.latencyMs,
    question,
    state,
    ...(result.usage === undefined ? {} : { usage: result.usage }),
  };
}

/**
 * Judge several expectations about one subject. They share a state, so
 * batching turns them into a single request.
 */
export function satisfiesAll(
  subject: Subject,
  expectations: Expectation[],
  opts?: { context?: Context; model?: string },
): Promise<SatisfyResult[]> {
  return Promise.all(
    expectations.map((expectation) =>
      satisfies({
        subject,
        expectation,
        ...(opts?.context === undefined ? {} : { context: opts.context }),
        ...(opts?.model === undefined ? {} : { model: opts.model }),
      }),
    ),
  );
}

/**
 * Classify how `current` differs from `previous`: cosmetic, behavioral, or
 * unclear. Same cache, mode and batching path as `satisfies()`.
 */
export async function classifyDiff(req: DiffRequest): Promise<DiffClassification> {
  const config = getConfig();
  const model = req.model ?? config.model;
  const state = buildDiffState(req.previous, req.current, req.context);
  const question = buildDiffQuestion(req.intent, req.context !== undefined);
  const key = questionKey(model, state, question);
  const cache = getCache();

  const cached = cache.get(key);
  if (cached?.type === "choice") {
    recordCacheHit();
    return {
      kind: toDiffKind(cached.choice),
      probabilities: fillProbabilities(cached.probabilities),
      confidence: cached.confidence,
      model: cached.model,
      cached: true,
      latencyMs: 0,
      question,
    };
  }
  if (config.mode === "replay") {
    throw new JevtestReplayMissError("a semantic snapshot comparison", key);
  }

  const result = await enqueue<ChoiceResponse>(stableStringify(state), state, question, model);
  const probabilities = fillProbabilities(result.answer.probabilities);
  cache.set(key, {
    type: "choice",
    choice: result.answer.choice,
    confidence: result.answer.confidence,
    probabilities,
    model: result.model,
  });
  return {
    kind: toDiffKind(result.answer.choice),
    probabilities,
    confidence: result.answer.confidence,
    model: result.model,
    cached: false,
    latencyMs: result.latencyMs,
    question,
    ...(result.usage === undefined ? {} : { usage: result.usage }),
  };
}

function toDiffKind(choice: string): DiffKind {
  return DIFF_KINDS.includes(choice as DiffKind) ? (choice as DiffKind) : "unclear";
}

function fillProbabilities(
  probabilities: Readonly<Record<string, number>>,
): Record<DiffKind, number> {
  return {
    cosmetic: probabilities.cosmetic ?? 0,
    behavioral: probabilities.behavioral ?? 0,
    unclear: probabilities.unclear ?? 0,
  };
}
