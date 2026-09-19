# jevtest

Semantic test matchers for Vitest and Jest, powered by [TypeSafe's Jev model](https://typesafe.ai).
You write the expectation in plain English, Jev answers one narrow typed question about the output and
returns a calibrated probability, and the matcher turns it into a pass or a fail. No text generation,
a few hundred milliseconds per request, cheap enough for a test suite.

```bash
npm i -D jevtest
export TYPESAFE_API_KEY=...   # get a key at https://typesafe.ai
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { setupFiles: ["jevtest/vitest/setup"] } });
```

The setup file registers the matchers at runtime. For TypeScript, also create a declaration file
included by your `tsconfig.json` (for example, `tests/jevtest.d.ts`):

```ts
// tests/jevtest.d.ts
import "jevtest/vitest";
```

This import loads the matcher types; the `setupFiles` entry alone does not make them available to
TypeScript.

Matchers are async, so always `await` the `expect(...)` call.

```ts
// 1. a claim about one output
await expect(reply).toSatisfy("apologizes politely");
await expect(reply).not.toSatisfy("promises a refund");

// 2. several claims, one API request
await expect(reply).toSatisfyAll([
  "apologizes politely",
  "avoids promising a refund",
  "offers a next step",
]);

// 3. a snapshot that only fails on changes that matter
await expect(releaseNotes).toMatchSemanticSnapshot({
  intent: "the list of breaking changes and their versions",
});
```

`toSatisfy` passes at probability >= 0.85, `.not.toSatisfy` at <= 0.15, and anything in between fails
both as ambiguous. Sharpen an expectation with `{ text, yes, no }`, add state with
`{ context: { question } }`, raise the bar with `{ min: 0.95 }`.

There is also a framework-free core:

```ts
import { classifyDiff, configure, getStats, satisfies, satisfiesAll } from "jevtest";
```

Configuration, batching, caching, offline CI with `JEVTEST_MODE=replay`, Jest setup, guidance on
writing expectations and the known limits are documented in the
[repository README](https://github.com/typesafe-ai/jevtest#readme).

MIT licensed.
