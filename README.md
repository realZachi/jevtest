# jevtest

Semantic test matchers for Vitest and Jest. You write the expectation in plain English, jevtest asks
[TypeSafe's Jev model](https://typesafe.ai) one narrow question about the output, and the matcher turns
the returned probability into a pass or a fail. Jev does not generate text. It answers typed questions
and returns a calibrated probability, usually in 150 ms to 1.5 s, which is cheap enough to run inside a
test suite.

```ts
// before: the assertion passes for any reply containing the word, and fails for "my apologies"
expect(reply).toContain("sorry");
expect(reply).not.toContain("refund");

// after: the assertion is the thing you actually care about
await expect(reply).toSatisfy("apologizes politely");
await expect(reply).not.toSatisfy("promises a refund");
```

## Install

```bash
npm i -D jevtest
```

The TypeSafe SDK is a dependency of jevtest, so there is nothing else to install.

Get an API key at [typesafe.ai](https://typesafe.ai) and put it in the environment:

```bash
export TYPESAFE_API_KEY=...
```

## Vitest setup

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["jevtest/vitest/setup"],
    testTimeout: 30_000,
  },
});
```

The setup file registers the matchers and the types. Every matcher is async, so always `await` the
`expect(...)` call.

```ts
import { expect, it } from "vitest";
import { replyTo } from "../src/support-bot.js";

it("handles a double charge", async () => {
  const reply = replyTo("You charged my card twice.");

  await expect(reply).toSatisfy("apologizes to the customer");
  await expect(reply).toSatisfy("declines to issue a refund", { min: 0.95 });
  await expect(reply).not.toSatisfy("blames the customer");
});
```

## Matchers

| Matcher | Passes when | Options |
| --- | --- | --- |
| `toSatisfy(expectation, options?)` | `probability >= min` (default 0.85) | `min`, `context`, `model` |
| `not.toSatisfy(expectation, options?)` | `probability <= max` (default 0.15) | `max`, `context`, `model` |
| `toSatisfyAll(expectations, options?)` | every expectation passes; one API request | `min`, `context`, `model` |
| `toMatchSemanticSnapshot(options?)` | output is identical to the baseline, or the difference is classified `cosmetic` with probability >= 0.8 | `intent`, `min`, `name`, `context`, `model` |

An expectation is a string, or an object that sharpens the boundary:

```ts
await expect(reply).toSatisfy({
  text: "avoids committing to a refund",
  yes: "the reply says a refund cannot be issued here, or stays silent about it",
  no: "the reply states or implies that a refund will be issued",
});
```

`context` adds named state the model needs to judge a relative claim:

```ts
await expect(summary).toSatisfy("answers the question", { context: { question: userMessage } });
```

## How it works

Each judgment is one [Noul question](https://docs.typesafe.ai/primitives/noul) about a state object:
the output under `output`, plus whatever you passed as `context`. Jev returns the probability that the
answer is yes. It never writes a sentence and it is never asked to explain, so there is no output to
parse and no second model deciding what your test means. Your code owns the control flow; the model
supplies one number; the threshold turns it into pass or fail.

That is what makes it usable in CI:

- One request per output, not one per assertion. Assertions made on the same output in the same tick
  are coalesced.
- A typed answer, not a paragraph. Latency is a few hundred milliseconds, and the cost is a handful of
  tokens.
- Calibrated probabilities. 0.9 means 0.9; see [confidence](https://docs.typesafe.ai/confidence).
- Content-hash caching, so an unchanged output is free on the next run.

The band between the two thresholds fails both forms on purpose. If a probability is 0.67, the model is
not telling you that the expectation holds and it is not telling you that it does not. Silently calling
that a pass or a fail would make the suite look decisive when it is not, so jevtest reports it as
ambiguous and asks you to sharpen the expectation.

Further reading: [Noul](https://docs.typesafe.ai/primitives/noul),
[Choice](https://docs.typesafe.ai/primitives/choice),
[Confidence](https://docs.typesafe.ai/confidence),
[Parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions).

## Failure messages

```
expect(output).toSatisfy("avoids promising a refund")

  probability  0.02   (needs ≥ 0.85)
  model        jev-1.13.0   1386 ms

  output:
    "No problem, I will refund the second charge for you right away. It should be back on your card shortly."

  hint: if the expectation is right, the code is wrong; if the output is
        right, sharpen the expectation with { yes, no } descriptions.
```

`toSatisfyAll` lists every expectation, failures first:

```
expect(output).toSatisfyAll(3 expectations)

  ✗ 0.05   "apologizes to the customer"
  ✗ 0.01   "avoids promising a refund"
  ✓ 0.95   "tells the customer what happens next"

  needs        ≥ 0.85 for every expectation
  model        jev-1.13.0   337 ms

  output:
    "No problem, I will refund the second charge for you right away. It should be back on your card shortly."
```

A probability inside the ambiguous band reports itself as such:

```
  probability  0.67   (ambiguous)
  model        jev-1.13.0   251 ms

  output:
    "The reset email definitely went out. Check your spam folder again, and make sure you typed your address correctly this time."

  ambiguous: 0.67 is between 0.15 and 0.85, so neither toSatisfy nor .not.toSatisfy can pass; tighten the expectation or adjust { min, max }
```

## Semantic snapshots

`toMatchSemanticSnapshot` stores the first output next to the test file, in
`__semantic_snapshots__/<test file>.jevsnap.json`. On later runs:

- an identical output passes with no API call;
- a different output is classified by Jev as `cosmetic`, `behavioral` or `unclear`
  (a [Choice question](https://docs.typesafe.ai/primitives/choice));
- only `cosmetic` with probability >= 0.8 passes;
- `vitest -u` or `JEVTEST_UPDATE=1` rewrites the baseline.

```ts
await expect(releaseNotes).toMatchSemanticSnapshot({
  intent: "the list of breaking changes and their versions",
});
```

`intent` is what decides the boundary. With the intent above, reordering the bullets and writing
`v2.3.0` instead of `2.3.0` is cosmetic, while dropping a breaking change or moving it to another
version is behavioral. Commit the `.jevsnap.json` files.

## Batching and caching

Assertions on the same output in the same tick become one API request:

```ts
// one request, three questions
await expect(reply).toSatisfyAll(["apologizes", "avoids promising a refund", "offers a next step"]);

// also one request
await Promise.all([
  expect(reply).toSatisfy("apologizes"),
  expect(reply).toSatisfy("avoids promising a refund"),
]);

// two requests: the second await starts after the first resolves
await expect(reply).toSatisfy("apologizes");
await expect(reply).toSatisfy("avoids promising a refund");
```

Every judgment is keyed by a hash of the model, the question and the state, so repeats are served from
the cache. `JEVTEST_CACHE=memory` (default) caches for the process, `file` caches in `.jevtest/`,
`off` disables it. `getStats()` reports requests, questions, cache hits, tokens and total latency.

## CI without a key

Record the answers once locally, commit `.jevtest/cache.json`, and run CI in replay mode:

```bash
JEVTEST_MODE=record pnpm test   # with a key, writes .jevtest/cache.json
JEVTEST_MODE=replay pnpm test   # no key, no network; a cache miss is an error
```

Replay makes the suite fully deterministic and offline. A miss is an error rather than a silent pass,
so a changed output fails loudly and you re-record.

If you use `cache: "file"` only as a local speed-up and do not want the file in git, add `.jevtest/`
to your `.gitignore`.

## Configuration

`configure()` wins over the environment, which wins over the defaults.

```ts
import { configure } from "jevtest";

configure({ threshold: 0.9, cache: "file", mode: "replay" });
```

| Option | Environment variable | Default | Meaning |
| --- | --- | --- | --- |
| `apiKey` | `TYPESAFE_API_KEY` | none | Resolved at the first judgment, not at import |
| `baseURL` | `TYPESAFE_BASE_URL` | SDK default | API base URL |
| `model` | `JEVTEST_MODEL` | `jev-latest` | Model name |
| `threshold` | `JEVTEST_THRESHOLD` | `0.85` | Minimum probability for `toSatisfy` |
| `notThreshold` | `JEVTEST_NOT_THRESHOLD` | `1 - threshold` | Maximum probability for `.not.toSatisfy` |
| `snapshotThreshold` | `JEVTEST_SNAPSHOT_THRESHOLD` | `0.8` | Minimum probability of `cosmetic` |
| `cache` | `JEVTEST_CACHE` | `memory` | `memory`, `file` or `off` |
| `cacheDir` | `JEVTEST_CACHE_DIR` | `.jevtest` | File cache location |
| `mode` | `JEVTEST_MODE` | `live` | `live`, `record` or `replay` |
| `timeout` | `JEVTEST_TIMEOUT` | `15000` | Per-request timeout in ms |
| `batchWindowMs` | `JEVTEST_BATCH_WINDOW_MS` | `0` | Coalescing window |
| `excerptLength` | `JEVTEST_EXCERPT_LENGTH` | `400` | Characters of output shown in failures |

## Core API without a test framework

```ts
import { classifyDiff, getStats, satisfies, satisfiesAll } from "jevtest";

const { probability, model, latencyMs, cached } = await satisfies({
  subject: reply,
  expectation: "apologizes politely",
});

const results = await satisfiesAll(reply, ["apologizes politely", "offers a next step"]);
const diff = await classifyDiff({ previous, current, intent: "the breaking changes" });
console.log(getStats());
```

## Jest

The Jest adapter does not import Jest. Hand it the `expect` you already have, from a file listed in
`setupFilesAfterEnv`:

```ts
// jest.setup.ts
import { expect } from "@jest/globals";
import { setupJevtestJest } from "jevtest/jest";

setupJevtestJest(expect);
```

```js
// jest.config.js
export default { setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"], testTimeout: 30000 };
```

The matchers and their options are identical.

## Writing good expectations

- One narrow claim per expectation. Split "apologizes and offers a next step" into two.
- Judge what the text says, not what it implies. "The user will be happy" is not observable in the
  output; "thanks the user" is.
- Use `{ yes, no }` when the short form is ambiguous. "mentions a refund" is true for a reply that
  refuses one; "states that a refund will be issued" is not.
- Use `context` for relative claims: faithfulness, relevance and answering all need the source or the
  question in the state.
- Keep exact things in normal assertions. Ticket numbers, JSON shapes, status codes and prices belong
  in `toContain`, `toEqual` and schema checks.
- Set `min` higher than the default for claims where a near miss is unacceptable, and validate the
  threshold against outputs you have already labelled.

## Limits

- Text and JSON only. There is no image or audio input.
- Not for exact values. A model is the wrong tool for checking that a total is 42.
- The model can be wrong. Probabilities are calibrated, not certain; a 0.9 threshold still lets through
  roughly one in ten borderline cases.
- Thresholds are yours to validate. Run the expectations over outputs you have labelled, look at the
  distribution, then pick `min`.
- A live suite needs the network. Use `record` and `replay` if that is not acceptable.

## Demo

```bash
git clone https://github.com/typesafe-ai/jevtest
cd jevtest && pnpm install && pnpm build
echo "TYPESAFE_API_KEY=..." > .env

pnpm demo        # terminal walkthrough, no vitest
pnpm demo:test   # the example test suite
```

The demo lives in [`examples/demo`](examples/demo): two deterministic support bots, a release notes
renderer for the snapshot demo, and an extractive summarizer for the `context` demo. No other model is
involved. `pnpm --filter jevtest-demo demo:fail` shows a real failure message.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the layout, the architecture and the commands.

## License

MIT. See [LICENSE](LICENSE).
