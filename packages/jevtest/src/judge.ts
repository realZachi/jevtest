// STUB — replaced by the core implementer. Signatures are the contract.
import type {
  Context,
  DiffClassification,
  DiffRequest,
  Expectation,
  SatisfyRequest,
  SatisfyResult,
  Subject,
} from "./types.js";

/** One expectation. Coalesced with other pending judgments on the same subject+context. */
export function satisfies(_req: SatisfyRequest): Promise<SatisfyResult> {
  throw new Error("jevtest core not implemented yet");
}
/** Several expectations about one subject in a single API request. */
export function satisfiesAll(
  _subject: Subject,
  _expectations: Expectation[],
  _opts?: { context?: Context; model?: string },
): Promise<SatisfyResult[]> {
  throw new Error("jevtest core not implemented yet");
}
/** Classify the difference between a stored snapshot and the current output. */
export function classifyDiff(_req: DiffRequest): Promise<DiffClassification> {
  throw new Error("jevtest core not implemented yet");
}
