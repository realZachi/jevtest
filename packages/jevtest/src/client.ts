/** The TypeSafe client, built lazily from the resolved configuration. */

import type { Fetch, TypeSafeClientConfig } from "@typesafe-ai/sdk";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { getConfig, missingApiKeyError } from "./config.js";

let client: TypeSafeClient | undefined;
let signature: string | undefined;
let testFetch: Fetch | undefined;

/**
 * The shared client for the current configuration. Rebuilt when the model,
 * base URL, key or timeout changes.
 *
 * @throws {JevtestConfigError} No API key is available.
 */
export function getClient(): TypeSafeClient {
  const config = getConfig();
  const apiKey = config.apiKey ?? (testFetch ? "test" : undefined);
  if (apiKey === undefined) throw missingApiKeyError();
  const next = [
    apiKey,
    config.baseURL ?? "",
    config.model,
    config.timeout,
    testFetch ? "test" : "",
  ].join("|");
  if (client && signature === next) return client;
  const options: TypeSafeClientConfig = {
    apiKey,
    defaultModel: config.model,
    timeout: config.timeout,
    logLevel: process.env.JEVTEST_DEBUG ? "debug" : "off",
    ...(config.baseURL === undefined ? {} : { baseURL: config.baseURL }),
    // Tests inject a fetch; retries would only slow down the error paths.
    ...(testFetch === undefined ? {} : { fetch: testFetch, retry: { maxRetries: 0 } }),
  };
  client = new TypeSafeClient(options);
  signature = next;
  return client;
}

/** Drop the client singleton. */
export function resetClient(): void {
  client = undefined;
  signature = undefined;
}

/**
 * Install a fake `fetch` for unit tests. With one installed the client is
 * built with a placeholder key when none is configured, and retries are off.
 * Pass `undefined` to go back to the global fetch.
 */
export function setFetchForTesting(fetch: Fetch | undefined): void {
  testFetch = fetch;
  resetClient();
}
