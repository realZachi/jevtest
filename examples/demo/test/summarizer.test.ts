import "jevtest/vitest"; // matcher types; the setup file registers them
import { describe, expect, it } from "vitest";
import { documents, summarize } from "../src/summarizer.js";

describe("summarize with context", () => {
  it("keeps the claims of the source", async () => {
    const source = documents.incident;
    const summary = summarize(source);

    // "faithful" only means something relative to the source, so the source
    // goes into the state as `source` and the expectation refers to it.
    await expect(summary).toSatisfy(
      {
        text: "is faithful to the source",
        yes: "every claim in the summary is stated in `source`",
        no: "the summary adds, changes or contradicts a fact from `source`",
      },
      { context: { source } },
    );
  });

  it("keeps the numbers that matter", async () => {
    const source = documents.incident;
    const summary = summarize(source);
    await expect(summary).toSatisfyAll(
      [
        "mentions how long the outage lasted",
        "does not invent a number that is absent from `source`",
      ],
      { context: { source } },
    );
  });

  it("does not editorialize", async () => {
    const source = documents.release;
    const summary = summarize(source);
    await expect(summary).not.toSatisfy("recommends an action to the reader", {
      context: { source },
    });
  });
});
