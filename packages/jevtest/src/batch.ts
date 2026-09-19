/**
 * Coalescing of questions into requests. Assertions that run in the same tick
 * against the same state and model become one `systemOne` call.
 */
import type { ChoiceResponse, EntryType, NoulResponse, Question, Usage } from "@typesafe-ai/sdk";
import { getClient } from "./client.js";
import { getConfig } from "./config.js";
import { JevtestAPIError, JevtestError } from "./errors.js";
import { stableStringify } from "./questions.js";
import { recordRequest } from "./stats.js";

/** The most questions we put in a single request. */
export const MAX_QUESTIONS_PER_REQUEST = 32;

/** One answer, with the request metadata the caller reports. */
export interface BatchAnswer<A> {
  answer: A;
  model: string;
  latencyMs: number;
  /**
   * Token usage of the request. Attributed in full to the first answer of the
   * batch and left undefined on the others, so summing results never
   * double-counts a request.
   */
  usage?: Usage;
}

type AnyAnswer = NoulResponse | ChoiceResponse;

interface Waiter {
  resolve: (value: BatchAnswer<AnyAnswer>) => void;
  reject: (error: unknown) => void;
}

interface Slot {
  id: string;
  question: Question;
  waiters: Waiter[];
}

interface Group {
  state: EntryType;
  model: string;
  slots: Map<string, Slot>;
  timer: NodeJS.Timeout | undefined;
}

const groups = new Map<string, Group>();

/**
 * Queue one question about one state. Identical questions in the same group
 * are sent once and share the answer.
 *
 * @param stateKey - Stable identity of the state; questions batch together only when it matches.
 * @returns The answer, once the group has been flushed.
 */
export function enqueue<A extends AnyAnswer>(
  stateKey: string,
  state: EntryType,
  question: Question,
  model: string,
): Promise<BatchAnswer<A>> {
  const groupKey = `${model}::${stateKey}`;
  let group = groups.get(groupKey);
  if (group === undefined) {
    group = { state, model, slots: new Map(), timer: undefined };
    groups.set(groupKey, group);
  }
  const target = group;
  const questionKey = stableStringify(question);
  const promise = new Promise<BatchAnswer<AnyAnswer>>((resolve, reject) => {
    const existing = target.slots.get(questionKey);
    if (existing) {
      existing.waiters.push({ resolve, reject });
      return;
    }
    target.slots.set(questionKey, {
      id: `q${target.slots.size}`,
      question,
      waiters: [{ resolve, reject }],
    });
  });

  if (target.slots.size >= MAX_QUESTIONS_PER_REQUEST) {
    flushGroup(groupKey, target);
  } else if (target.timer === undefined) {
    target.timer = setTimeout(() => {
      flushGroup(groupKey, target);
    }, getConfig().batchWindowMs);
  }
  return promise as Promise<BatchAnswer<A>>;
}

/** Drop every pending group without sending it. Used by tests. */
export function resetBatch(): void {
  for (const group of groups.values()) {
    if (group.timer !== undefined) clearTimeout(group.timer);
  }
  groups.clear();
}

function flushGroup(groupKey: string, group: Group): void {
  if (groups.get(groupKey) === group) groups.delete(groupKey);
  if (group.timer !== undefined) {
    clearTimeout(group.timer);
    group.timer = undefined;
  }
  const slots = [...group.slots.values()];
  if (slots.length === 0) return;
  void send(group, slots);
}

async function send(group: Group, slots: Slot[]): Promise<void> {
  const questions: Record<string, Question> = {};
  for (const slot of slots) questions[slot.id] = slot.question;
  const started = Date.now();
  try {
    const result = await getClient().systemOne({
      state: group.state,
      questions,
      model: group.model,
    });
    const latencyMs = Date.now() - started;
    recordRequest({
      questions: slots.length,
      latencyMs,
      inputTokens: result.usage?.input_tokens,
      outputTokens: result.usage?.output_tokens,
    });
    let usageAttributed = false;
    for (const slot of slots) {
      const answer = result.answers[slot.id] as AnyAnswer | undefined;
      if (answer === undefined) {
        const missing = new JevtestAPIError(
          `The TypeSafe API did not answer question ${slot.id}.`,
          {
            cause: new Error("missing answer"),
          },
        );
        for (const waiter of slot.waiters) waiter.reject(missing);
        continue;
      }
      for (const waiter of slot.waiters) {
        const usage = !usageAttributed && result.usage !== undefined ? result.usage : undefined;
        usageAttributed = true;
        waiter.resolve({
          answer,
          model: result.model,
          latencyMs,
          ...(usage === undefined ? {} : { usage }),
        });
      }
    }
  } catch (cause) {
    const latencyMs = Date.now() - started;
    recordRequest({ questions: slots.length, latencyMs });
    // Configuration problems (a missing key, say) keep their own message.
    const error = cause instanceof JevtestError ? cause : JevtestAPIError.from(cause);
    for (const slot of slots) {
      for (const waiter of slot.waiters) waiter.reject(error);
    }
  }
}
