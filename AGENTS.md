# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, Cursor, etc.) when working with code in this repository.

## What this is

`jevtest` is a Vitest/Jest matcher library (`toSatisfy`, `toSatisfyAll`, `toMatchSemanticSnapshot`) that asks TypeSafe's Jev model a narrow yes/no or pick-one question about a test output and turns the returned probability into pass/fail. The model never generates text and is never asked to explain. pnpm workspace: `packages/jevtest` (the library) and `examples/demo` (showcase + example suite that consumes the built package).

## Commands

All from the repo root. Node >= 20, pnpm 11.

```bash
pnpm install
pnpm build              # tsdown → packages/jevtest/dist (esm + cjs + d.ts)
pnpm lint               # biome check . (format + lint); pnpm lint:fix to autofix
pnpm typecheck          # tsc --noEmit in every workspace package
pnpm test               # library unit tests only (excludes test/integration)
pnpm test:integration   # library tests against the live API; needs TYPESAFE_API_KEY
pnpm demo               # examples/demo/scripts/showcase.ts via tsx; needs a key
pnpm demo:test          # example vitest suite; needs a key
```

Single test / focused runs (inside `packages/jevtest`):

```bash
pnpm --filter jevtest exec vitest run test/core/batch.test.ts
pnpm --filter jevtest exec vitest run -t "sends three expectations"
pnpm --filter jevtest test:watch
```

Demo-specific: `pnpm --filter jevtest-demo test:update` rewrites semantic snapshots (`vitest -u`); `pnpm --filter jevtest-demo demo:fail` sets `JEVTEST_DEMO_FAIL=1` to run the intentionally failing cases and show real failure messages.

Things that bite:

- `examples/demo` depends on `jevtest` via `workspace:*`, and the package `exports` point at `dist/`. Run `pnpm build` before `pnpm demo`, `pnpm demo:test`, or typechecking the demo, or you get stale/missing modules.
- The API key comes from `TYPESAFE_API_KEY`. The demo loads the repo-root `.env` via `examples/demo/test/env.ts`; the library's integration tests read the env directly and `describe.skip` themselves when the key is absent.
- CI (`.github/workflows/ci.yml`) runs lint → build → typecheck → unit tests on every PR; integration and demo tests run only when the `TYPESAFE_API_KEY` secret is present.
- Biome is the formatter: double quotes, semicolons, 2-space indent, 100-char lines. `dist/`, `node_modules/`, `.jevtest/` are excluded.
- TS is strict with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, NodeNext resolution. Relative imports use `.js` extensions. Optional fields must be spread conditionally rather than assigned `undefined` (see `normalizeExpectation` in `questions.ts`).

## Architecture

`packages/jevtest/src/types.ts` is the contract between two layers. Keep it dependency-free apart from SDK types.

**Core** (`config.ts`, `client.ts`, `cache.ts`, `batch.ts`, `questions.ts`, `judge.ts`, `stats.ts`, `errors.ts`, `index.ts`) knows nothing about any test framework. Public entry points: `satisfies()`, `satisfiesAll()`, `classifyDiff()`, `configure()`, `getConfig()`, `getStats()`.

The path of one judgment:

1. `questions.ts` builds everything the model sees: the state object (`{ output: <subject>, ...context }`, subjects serialized with stable key order) and the Noul/Choice question. It also derives the cache key from `CACHE_VERSION` + model + state + question. Bump `CACHE_VERSION` whenever question wording or state shape changes, otherwise stale cached answers are served.
2. `judge.ts` consults the cache (`cache.ts`: memory by default, a single JSON file in `.jevtest/` for `file`/`record`/`replay`), honours the run mode (`replay` never hits the network and throws `JevtestReplayMissError` on a miss), then enqueues.
3. `batch.ts` coalesces questions that arrive in the same tick for the same state + model into one `systemOne` request (max 32 questions). Identical questions share one slot. Token usage is attributed to the first answer of a batch only, so summing results never double-counts.
4. `config.ts` resolves `configure()` overrides > `JEVTEST_*` / `TYPESAFE_*` env vars > defaults, lazily inside `getConfig()`. The API key is resolved at first judgment, not at import.

**Matchers** (`matchers/core.ts`, `format.ts`, `snapshot/store.ts`, `vitest.ts`, `vitest-setup.ts`, `jest.ts`) turn core results into `MatcherResult`s.

- `matchers/core.ts` is framework-agnostic and holds all matcher logic; `vitest.ts` and `jest.ts` are thin adapters that only translate the framework's matcher state into a `MatcherContext` (`isNot`, test name, test path, snapshot update mode) and register `expect.extend`. Add behaviour in `core.ts`, not the adapters.
- Structural failures (bad input) must fail in both polarities; `core.ts` mirrors `isNot` into `pass` for this. Probabilities between `notThreshold` and `threshold` fail both `toSatisfy` and `.not.toSatisfy` as "ambiguous" on purpose.
- `vitest.ts` keeps vitest 5's built-in `toSatisfy(predicate)` working by falling back when the argument is a function.
- `jest.ts` never imports jest; the caller hands in its `expect`.
- `format.ts` renders failure messages and prints the exact `question` sent, so question wording lives only in `questions.ts`.
- `snapshot/store.ts` stores semantic snapshots next to the test file in `__semantic_snapshots__/<file>.jevsnap.json`, keyed by test name + per-test call index (counters reset in a `beforeEach` the adapters register). Diffs are classified `cosmetic` / `behavioral` / `unclear` via a Choice question; only `cosmetic` above `snapshotThreshold` passes.

Build: `tsdown.config.ts` emits four entries (`index`, `vitest`, `vitest-setup`, `jest`) as ESM + CJS with `vitest`/`jest` marked external. Adding a subpath export means updating both `tsdown.config.ts` and `package.json#exports`.

## Rules

- Code owns control flow; Jev only answers narrow yes/no or pick-one questions. Never generate text with the model, never ask it to explain.
- Every judgment must be reproducible from `SatisfyResult.question` + `SatisfyResult.state`.
- Unit tests never touch the network: use `fakeFetch()` from `test/core/fake.ts` with `setFetchForTesting()`, and reset module state in `beforeEach`/`afterEach` (`resetConfig`, `resetCache`, `resetBatch`, `resetStats`, `resetClient`). Anything needing a real key goes in `test/integration/`.
- Vitest globals are enabled in the library's config; test files still import from `vitest` explicitly.
- Commit `.jevsnap.json` files. `.jevtest/cache.json` is committed only when a project uses `record`/`replay` for CI.
