# Contributing

## Layout

- `packages/jevtest` - the library (`jevtest`, `jevtest/vitest`, `jevtest/vitest/setup`, `jevtest/jest`)
- `examples/demo` - runnable showcase and example test suite

## Architecture (read before touching `src/`)

`src/types.ts` is the contract between two layers:

**Core** (`config.ts`, `client.ts`, `cache.ts`, `batch.ts`, `questions.ts`, `judge.ts`, `stats.ts`, `index.ts`)
- Owns the TypeSafe client, caching, batching, run modes and stats.
- Exposes `satisfies()`, `satisfiesAll()`, `classifyDiff()`, `configure()`, `getConfig()`, `getStats()`.
- Knows nothing about vitest or jest.

**Matchers** (`matchers/core.ts`, `format.ts`, `snapshot/*`, `vitest.ts`, `vitest-setup.ts`, `jest.ts`)
- Turns core results into `MatcherResult`s with good failure messages.
- `matchers/core.ts` is framework-agnostic; `vitest.ts` and `jest.ts` are thin adapters.

## Rules

- Code owns control flow; Jev only answers narrow yes/no or pick-one questions.
- Never generate text with the model. Never ask it to explain.
- Every judgment must be reproducible from `SatisfyResult.question` + `SatisfyResult.state`.
- Unit tests use a fake `fetch` (the SDK accepts one); integration tests live in `test/integration` and need `TYPESAFE_API_KEY`.

## Commands

```bash
pnpm install
pnpm build
pnpm test
pnpm test:integration   # needs TYPESAFE_API_KEY
pnpm demo               # needs TYPESAFE_API_KEY
```
