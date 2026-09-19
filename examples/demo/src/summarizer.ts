/**
 * A deterministic extractive summarizer: the first sentence, plus the first
 * sentence that contains a number. No model, no randomness. The point of the
 * demo is judging the summary against its source with `context`.
 */

/** Split on sentence boundaries, keeping the terminator. */
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.length > 0);
}

/** First sentence plus the first sentence containing a number, in source order. */
export function summarize(text: string): string {
  const parts = sentences(text);
  if (parts.length === 0) return "";
  const first = parts[0] as string;
  const withNumber = parts.slice(1).find((sentence) => /\d/.test(sentence));
  return withNumber === undefined ? first : `${first} ${withNumber}`;
}

/** Source documents for the context demo. */
export const documents = {
  incident:
    "The API returned 503 responses for part of Tuesday afternoon. " +
    "The cause was a connection pool that was never resized after the database upgrade. " +
    "The outage lasted 42 minutes and affected roughly 8 percent of requests. " +
    "We have raised the pool size and added an alert on saturation.",
  release:
    "Version 2.3.0 changes how the client is constructed. " +
    "Passing a bare API key string now throws at construction time. " +
    "About 120 projects in our own monorepo needed the one-line change. " +
    "A codemod is included in the package.",
} as const;
