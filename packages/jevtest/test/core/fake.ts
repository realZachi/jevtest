/** A fake `fetch` for the SDK: records request bodies, returns canned answers. */
import type { Fetch, Question } from "@typesafe-ai/sdk";

export interface RecordedRequest {
  url: string;
  state: unknown;
  questions: Record<string, Question>;
  model: string;
}

export interface FakeFetch {
  calls: RecordedRequest[];
  fetch: Fetch;
}

export interface FakeOptions {
  /** Probability returned for every noul question. */
  noul?: number;
  /** Answer returned for every choice question. */
  choice?: { choice: string; confidence: number; probabilities: Record<string, number> };
  /** Respond with this HTTP status and an error body instead of answers. */
  status?: number;
}

const DEFAULT_CHOICE = {
  choice: "cosmetic",
  confidence: 0.74,
  probabilities: { cosmetic: 0.74, behavioral: 0.21, unclear: 0.05 },
};

/** Build a fake fetch plus the list of requests it has seen. */
export function fakeFetch(options: FakeOptions = {}): FakeFetch {
  const calls: RecordedRequest[] = [];
  const fetch: Fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      state: unknown;
      questions: Record<string, Question>;
      model: string;
    };
    calls.push({ url, state: body.state, questions: body.questions, model: body.model });
    if (options.status !== undefined) {
      return new Response(JSON.stringify({ error: { message: "nope" } }), {
        status: options.status,
        headers: { "content-type": "application/json" },
      });
    }
    const answers: Record<string, unknown> = {};
    for (const [id, question] of Object.entries(body.questions)) {
      answers[id] =
        question.type === "choice"
          ? { type: "choice", ...(options.choice ?? DEFAULT_CHOICE) }
          : { type: "noul", noul: options.noul ?? 0.9 };
    }
    return new Response(
      JSON.stringify({
        model: "jev-test",
        answers,
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return { calls, fetch };
}
