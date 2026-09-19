/**
 * Error types for jevtest. Everything thrown by the core is a `JevtestError`
 * so callers can distinguish our failures from assertion failures.
 */
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from "@typesafe-ai/sdk";

/** Base class for every error thrown by jevtest. */
export class JevtestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "JevtestError";
  }
}

/** Invalid configuration, or a missing API key at the first live judgment. */
export class JevtestConfigError extends JevtestError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "JevtestConfigError";
  }
}

/** A judgment was not in the cache while running in `replay` mode. */
export class JevtestReplayMissError extends JevtestError {
  /** The cache key that was missing. */
  readonly key: string;

  constructor(description: string, key: string) {
    super(
      `jevtest is in replay mode and has no recorded answer for: ${description}\n` +
        `Cache key: ${key}\n` +
        `Record it once with a key: JEVTEST_MODE=record pnpm test, then commit the cache directory.`,
    );
    this.name = "JevtestReplayMissError";
    this.key = key;
  }
}

/** A TypeSafe API call failed. The SDK error is kept as `cause`. */
export class JevtestAPIError extends JevtestError {
  /** HTTP status, when the failure was an HTTP response. */
  readonly status: number | undefined;
  /** TypeSafe request id, when the response carried one. */
  readonly requestId: string | undefined;

  constructor(message: string, options: { cause: unknown; status?: number; requestId?: string }) {
    super(message, { cause: options.cause });
    this.name = "JevtestAPIError";
    this.status = options.status;
    this.requestId = options.requestId;
  }

  /** Wrap an SDK error in a JevtestAPIError with an actionable message. */
  static from(error: unknown): JevtestAPIError {
    if (error instanceof JevtestAPIError) return error;
    if (error instanceof AuthenticationError) {
      return new JevtestAPIError(
        "TypeSafe rejected the API key (401). Check TYPESAFE_API_KEY, or get a key at https://typesafe.ai.",
        { cause: error, status: error.status, ...idOf(error) },
      );
    }
    if (error instanceof PermissionDeniedError) {
      return new JevtestAPIError(
        "TypeSafe denied access to this request (403). The key may lack access to the requested model.",
        { cause: error, status: error.status, ...idOf(error) },
      );
    }
    if (error instanceof RateLimitError) {
      return new JevtestAPIError(
        "TypeSafe rate limited the request (429) and the SDK already retried. Lower test concurrency or retry later.",
        { cause: error, status: error.status, ...idOf(error) },
      );
    }
    if (error instanceof APITimeoutError) {
      return new JevtestAPIError(
        `The TypeSafe request timed out after ${error.timeoutMs}ms. Raise JEVTEST_TIMEOUT if the state is large.`,
        { cause: error },
      );
    }
    if (error instanceof APIConnectionError) {
      return new JevtestAPIError(
        `Could not reach the TypeSafe API: ${error.message}. Check the network, TYPESAFE_BASE_URL, or run with JEVTEST_MODE=replay.`,
        { cause: error },
      );
    }
    if (error instanceof APIError) {
      return new JevtestAPIError(`The TypeSafe API returned ${error.status}: ${error.message}`, {
        cause: error,
        status: error.status,
        ...idOf(error),
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    return new JevtestAPIError(`The TypeSafe request failed: ${message}`, { cause: error });
  }
}

function idOf(error: APIError): { requestId?: string } {
  return error.requestId === undefined ? {} : { requestId: error.requestId };
}
