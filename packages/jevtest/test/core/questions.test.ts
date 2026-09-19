import { describe, expect, it } from "vitest";
import { JevtestConfigError } from "../../src/errors.js";
import {
  buildDiffQuestion,
  buildSatisfyQuestion,
  buildState,
  normalizeExpectation,
  questionKey,
  serializeSubject,
} from "../../src/questions.js";

describe("normalizeExpectation", () => {
  it("accepts the string form", () => {
    expect(normalizeExpectation("apologizes politely")).toEqual({ text: "apologizes politely" });
  });

  it("keeps explicit criteria", () => {
    expect(normalizeExpectation({ text: "refunds", yes: "a refund", no: "no refund" })).toEqual({
      text: "refunds",
      yes: "a refund",
      no: "no refund",
    });
  });
});

describe("serializeSubject", () => {
  it("leaves strings alone", () => {
    expect(serializeSubject("hello")).toBe("hello");
  });

  it("serializes objects with sorted keys and two-space indent", () => {
    const a = serializeSubject({ b: 1, a: { d: [3, 2], c: true } });
    const b = serializeSubject({ a: { c: true, d: [3, 2] }, b: 1 });
    expect(a).toBe(b);
    expect(a).toMatchInlineSnapshot(`
      "{
        "a": {
          "c": true,
          "d": [
            3,
            2
          ]
        },
        "b": 1
      }"
    `);
  });
});

describe("buildState", () => {
  it("puts the subject under output and keeps JSON shape", () => {
    expect(buildState({ total: 3 }, { question: "how many?" })).toEqual({
      output: { total: 3 },
      question: "how many?",
    });
  });

  it("rejects a context key named output", () => {
    expect(() => buildState("x", { output: "y" })).toThrow(JevtestConfigError);
  });
});

describe("buildSatisfyQuestion", () => {
  it("builds the default question", () => {
    expect(buildSatisfyQuestion("apologizes politely", false)).toMatchInlineSnapshot(`
      {
        "criteria": {
          "false": "\`output\` does not satisfy the expectation, or only partially.",
          "true": "\`output\` clearly satisfies the expectation.",
        },
        "instructions": {
          "expectation": "apologizes politely",
          "notes": [
            "Judge only what \`output\` actually says or does, not what it might imply.",
          ],
          "task": "Judge whether \`output\` satisfies the expectation.",
        },
        "type": "noul",
      }
    `);
  });

  it("adds the context note and explicit criteria", () => {
    expect(
      buildSatisfyQuestion(
        { text: "answers the question", yes: "answers it", no: "dodges it" },
        true,
      ),
    ).toMatchInlineSnapshot(`
      {
        "criteria": {
          "false": "dodges it",
          "true": "answers it",
        },
        "instructions": {
          "expectation": "answers the question",
          "notes": [
            "Judge only what \`output\` actually says or does, not what it might imply.",
            "Other fields in the state are context that may be needed to judge \`output\`; do not judge them.",
          ],
          "task": "Judge whether \`output\` satisfies the expectation.",
        },
        "type": "noul",
      }
    `);
  });
});

describe("buildDiffQuestion", () => {
  it("builds the choice question and folds in the intent", () => {
    expect(buildDiffQuestion("the list of breaking changes", false)).toMatchInlineSnapshot(`
      {
        "criteria": {
          "behavioral": "Facts, numbers, commitments, instructions, tone toward the reader, or the set of items changed. A reader would act or understand differently.",
          "cosmetic": "Same meaning, facts, commitments and structure; only wording, punctuation, whitespace, ordering of equivalent items or formatting differ.",
          "unclear": "Cannot tell, or the change is borderline.",
        },
        "instructions": {
          "notes": [
            "Compare meaning, not wording.",
            "What matters about this output: the list of breaking changes",
          ],
          "task": "Classify how \`current\` differs from \`previous\` in meaning.",
        },
        "type": "choice",
      }
    `);
  });
});

describe("questionKey", () => {
  it("ignores key order but not values", () => {
    const question = buildSatisfyQuestion("is polite", false);
    const a = questionKey("jev-latest", { output: "hi", who: "sam" }, question);
    const b = questionKey("jev-latest", { who: "sam", output: "hi" }, question);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(questionKey("jev-other", { output: "hi", who: "sam" }, question)).not.toBe(a);
    expect(questionKey("jev-latest", { output: "bye", who: "sam" }, question)).not.toBe(a);
  });
});
