/**
 * Failure message rendering. No framework and no network dependencies:
 * every function here is a pure string builder, so messages are deterministic
 * and easy to assert on in tests.
 */
import type { Context, DiffClassification, DiffKind, Expectation, Subject } from "./types.js";

const LABEL_WIDTH = 13;
const VALUE_WIDTH = 7;

/** JSON with sorted object keys, so the same value always renders the same way. */
function stableStringify(value: unknown, indent = 2): string {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input !== "object") return input;
    const obj = input as object;
    if (seen.has(obj)) return "[circular]";
    seen.add(obj);
    if (Array.isArray(input)) return input.map(normalize);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input as Record<string, unknown>).sort()) {
      out[key] = normalize((input as Record<string, unknown>)[key]);
    }
    return out;
  };
  return JSON.stringify(normalize(value), null, indent) ?? String(value);
}

/** The plain text of a subject, before quoting or truncation. */
export function subjectText(subject: Subject): string {
  return typeof subject === "string" ? subject : stableStringify(subject);
}

/**
 * A display-ready excerpt of a subject: quoted when it is a single-line string,
 * raw when it spans several lines, always clipped to `max` characters.
 */
export function excerpt(subject: Subject, max: number): string {
  const text = subjectText(subject);
  const truncated = text.length > max;
  const body = truncated ? text.slice(0, max) : text;
  const suffix = truncated ? ` … (+${text.length - max} more chars)` : "";
  if (typeof subject === "string" && !body.includes("\n")) {
    return `${JSON.stringify(body)}${suffix}`;
  }
  return `${body}${suffix}`;
}

/** "0.31" — two decimals, no locale surprises. */
export function formatProbability(p: number): string {
  return p.toFixed(2);
}

function indent(text: string, pad: string): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? `${pad}${line}` : line))
    .join("\n");
}

function field(label: string, value: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}${value}`;
}

function expectationText(expectation: Expectation): string {
  return typeof expectation === "string" ? expectation : expectation.text;
}

function expectationCriteria(expectation: Expectation): string[] {
  if (typeof expectation === "string") return [];
  const lines: string[] = [];
  if (expectation.yes !== undefined) lines.push(field("yes", JSON.stringify(expectation.yes)));
  if (expectation.no !== undefined) lines.push(field("no", JSON.stringify(expectation.no)));
  return lines;
}

function modelLine(model: string, latencyMs: number, cached: boolean): string {
  return field("model", cached ? `${model}   cached` : `${model}   ${latencyMs} ms`);
}

function subjectBlock(subject: Subject, excerptLength: number): string[] {
  return ["", "  output:", indent(excerpt(subject, excerptLength), "    ")];
}

function contextBlock(context: Context | undefined, excerptLength: number): string[] {
  if (context === undefined) return [];
  const keys = Object.keys(context);
  if (keys.length === 0) return [];
  const lines = ["", "  context:"];
  for (const key of keys) {
    const value = context[key] as Subject;
    const rendered = excerpt(value, excerptLength);
    if (rendered.includes("\n")) {
      lines.push(`    ${key}:`, indent(rendered, "      "));
    } else {
      lines.push(`    ${key}: ${rendered}`);
    }
  }
  return lines;
}

const SATISFY_HINT = [
  "  hint: if the expectation is right, the code is wrong; if the output is",
  "        right, sharpen the expectation with { yes, no } descriptions.",
].join("\n");

function header(matcher: string, isNot: boolean, args: string): string {
  return `expect(output).${isNot ? "not." : ""}${matcher}(${args})`;
}

/** Shared shape of everything the satisfy renderers need. */
export interface SatisfyFailureInput {
  expectation: Expectation;
  probability: number;
  /** The bound that had to be met: `min` for the positive form, `max` for `.not`. */
  threshold: number;
  isNot: boolean;
  subject: Subject;
  context?: Context | undefined;
  model: string;
  cached: boolean;
  latencyMs: number;
  excerptLength: number;
}

/** A definite failure: the probability is on the wrong side of the bound. */
export function renderSatisfyFailure(input: SatisfyFailureInput): string {
  return buildSatisfyFailure(input, undefined);
}

export interface AmbiguousInput extends Omit<SatisfyFailureInput, "threshold"> {
  /** Minimum probability for the positive form. */
  min: number;
  /** Maximum probability for the `.not` form. */
  max: number;
}

/**
 * The probability landed between the two bounds, so neither form can pass.
 * Same layout as a plain failure, with one extra line explaining the band.
 */
export function renderAmbiguous(input: AmbiguousInput): string {
  const { min, max, ...rest } = input;
  return buildSatisfyFailure({ ...rest, threshold: input.isNot ? max : min }, { min, max });
}

function buildSatisfyFailure(
  input: SatisfyFailureInput,
  band: { min: number; max: number } | undefined,
): string {
  const comparator = input.isNot ? "≤" : "≥";
  const p = formatProbability(input.probability);
  const lines = [
    header("toSatisfy", input.isNot, JSON.stringify(expectationText(input.expectation))),
    "",
    field(
      "probability",
      `${p.padEnd(VALUE_WIDTH)}(needs ${comparator} ${formatProbability(input.threshold)})`,
    ),
    ...expectationCriteria(input.expectation),
    modelLine(input.model, input.latencyMs, input.cached),
    ...contextBlock(input.context, input.excerptLength),
    ...subjectBlock(input.subject, input.excerptLength),
    ...(band === undefined
      ? []
      : [
          "",
          `  ambiguous: ${p} is between ${formatProbability(band.max)} and ${formatProbability(band.min)}, so neither toSatisfy nor .not.toSatisfy can pass; tighten the expectation or adjust { min, max }`,
        ]),
    "",
    SATISFY_HINT,
  ];
  return lines.join("\n");
}

export interface SatisfyAllEntry {
  expectation: Expectation;
  probability: number;
  ok: boolean;
}

export interface SatisfyAllFailureInput {
  entries: SatisfyAllEntry[];
  threshold: number;
  isNot: boolean;
  subject: Subject;
  context?: Context | undefined;
  model: string;
  cached: boolean;
  latencyMs: number;
  excerptLength: number;
}

/** One line per expectation, failing ones first. */
export function renderSatisfyAllFailure(input: SatisfyAllFailureInput): string {
  const comparator = input.isNot ? "≤" : "≥";
  const ordered = [
    ...input.entries.filter((entry) => !entry.ok),
    ...input.entries.filter((entry) => entry.ok),
  ];
  const rows = ordered.map(
    (entry) =>
      `  ${entry.ok ? "✓" : "✗"} ${formatProbability(entry.probability).padEnd(VALUE_WIDTH)}${JSON.stringify(expectationText(entry.expectation))}`,
  );
  const count = input.entries.length;
  const lines = [
    header("toSatisfyAll", input.isNot, `${count} expectation${count === 1 ? "" : "s"}`),
    "",
    ...rows,
    "",
    field("needs", `${comparator} ${formatProbability(input.threshold)} for every expectation`),
    modelLine(input.model, input.latencyMs, input.cached),
    ...contextBlock(input.context, input.excerptLength),
    ...subjectBlock(input.subject, input.excerptLength),
    "",
    SATISFY_HINT,
  ];
  return lines.join("\n");
}

const DIFF_KINDS: DiffKind[] = ["cosmetic", "behavioral", "unclear"];

/**
 * A compact line diff: common head and tail are dropped, the changed middle is
 * shown with `-` and `+` prefixes. Not a Myers diff; good enough to read.
 */
export function renderLineDiff(previous: string, current: string, maxLines = 20): string {
  const before = previous.split("\n");
  const after = current.split("\n");
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }
  const removed = before.slice(head, before.length - tail);
  const added = after.slice(head, after.length - tail);
  const lines: string[] = [];
  if (head > 0) lines.push(`  … ${head} unchanged line${head === 1 ? "" : "s"}`);
  for (const line of removed.slice(0, maxLines)) lines.push(`  - ${line}`);
  if (removed.length > maxLines) lines.push(`  - … (+${removed.length - maxLines} more)`);
  for (const line of added.slice(0, maxLines)) lines.push(`  + ${line}`);
  if (added.length > maxLines) lines.push(`  + … (+${added.length - maxLines} more)`);
  if (tail > 0) lines.push(`  … ${tail} unchanged line${tail === 1 ? "" : "s"}`);
  return lines.join("\n");
}

export interface SnapshotFailureInput {
  classification: DiffClassification;
  /** Minimum probability of "cosmetic" that would have passed. */
  min: number;
  previous: string;
  current: string;
  snapshotFile: string;
  snapshotKey: string;
  intent?: string | undefined;
  context?: Context | undefined;
  excerptLength: number;
}

/** The stored snapshot and the current output differ in a way that matters. */
export function renderSnapshotFailure(input: SnapshotFailureInput): string {
  const { classification: c } = input;
  const lines = [
    header("toMatchSemanticSnapshot", false, ""),
    "",
    field("diff", `${c.kind}   (confidence ${formatProbability(c.confidence)})`),
    ...DIFF_KINDS.map((kind) => field(kind, formatProbability(c.probabilities[kind]))),
    field("needs", `cosmetic ≥ ${formatProbability(input.min)}`),
    modelLine(c.model, c.latencyMs, c.cached),
    ...(input.intent === undefined ? [] : [field("intent", JSON.stringify(input.intent))]),
    field("snapshot", `${input.snapshotFile} > ${input.snapshotKey}`),
    ...contextBlock(input.context, input.excerptLength),
    "",
    renderLineDiff(input.previous, input.current),
    "",
    "  hint: run with -u to accept this as the new baseline.",
  ];
  return lines.join("\n");
}

/** Appended to a core error when replay mode has no recorded answer. */
export function renderReplayMissHint(): string {
  return [
    "  hint: mode is replay and this judgment was never recorded. Run the suite",
    "        once with JEVTEST_MODE=record and a TYPESAFE_API_KEY to record it.",
  ].join("\n");
}
