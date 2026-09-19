import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyDiff } from "../../src/judge.js";
import type { MatcherContext } from "../../src/matchers/core.js";
import { toMatchSemanticSnapshot } from "../../src/matchers/core.js";
import {
  readSnapshot,
  resetSnapshotCounters,
  resetSnapshotStoreForTesting,
  snapshotFileFor,
} from "../../src/snapshot/store.js";
import type { DiffClassification, DiffKind } from "../../src/types.js";

vi.mock("../../src/config.js", () => ({
  getConfig: () => ({
    model: "jev-test",
    threshold: 0.85,
    notThreshold: 0.15,
    snapshotThreshold: 0.8,
    cache: "off",
    cacheDir: "/tmp/jevtest-matchers-cache",
    mode: "live",
    timeout: 15000,
    batchWindowMs: 0,
    excerptLength: 400,
  }),
  configure: vi.fn(),
  resetConfig: vi.fn(),
}));

vi.mock("../../src/judge.js", () => ({
  satisfies: vi.fn(),
  satisfiesAll: vi.fn(),
  classifyDiff: vi.fn(),
}));

const classifyDiffMock = vi.mocked(classifyDiff);

function classification(
  kind: DiffKind,
  probabilities: Record<DiffKind, number>,
): DiffClassification {
  return {
    kind,
    probabilities,
    confidence: 0.88,
    model: "jev-1.13.0",
    cached: false,
    latencyMs: 412,
    question: { type: "choice", criteria: { cosmetic: null, behavioral: null, unclear: null } },
  };
}

let dir: string;
let testPath: string;

function ctx(over: Partial<MatcherContext> = {}): MatcherContext {
  return { isNot: false, currentTestName: "changelog", testPath, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  dir = mkdtempSync(join(tmpdir(), "jevtest-snap-"));
  testPath = join(dir, "example.test.ts");
  resetSnapshotStoreForTesting();
});

afterEach(() => {
  resetSnapshotStoreForTesting();
});

describe("snapshotFileFor", () => {
  it("puts the file next to the test file", () => {
    expect(snapshotFileFor(testPath)).toBe(
      join(dir, "__semantic_snapshots__", "example.test.ts.jevsnap.json"),
    );
  });

  it("falls back to the cache dir when the test path is unknown", () => {
    expect(snapshotFileFor(undefined)).toBe(
      join("/tmp/jevtest-matchers-cache", "snapshots", "unknown.jevsnap.json"),
    );
  });
});

describe("toMatchSemanticSnapshot", () => {
  it("writes a missing snapshot and passes", async () => {
    const result = await toMatchSemanticSnapshot(ctx(), "first output");
    expect(result.pass).toBe(true);
    expect(classifyDiffMock).not.toHaveBeenCalled();
    expect(readSnapshot(testPath, "changelog 1")).toBe("first output");
    const file = snapshotFileFor(testPath);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toMatchInlineSnapshot(`
      "{
        "version": 1,
        "snapshots": {
          "changelog 1": {
            "value": "first output"
          }
        }
      }
      "
    `);
  });

  it("skips the model when the output is identical", async () => {
    await toMatchSemanticSnapshot(ctx(), "same output");
    resetSnapshotCounters();
    const result = await toMatchSemanticSnapshot(ctx(), "same output");
    expect(result.pass).toBe(true);
    expect(classifyDiffMock).not.toHaveBeenCalled();
  });

  it("passes on a cosmetic diff and keeps the baseline", async () => {
    await toMatchSemanticSnapshot(ctx(), "Released on 2024-01-01.");
    resetSnapshotCounters();
    classifyDiffMock.mockResolvedValue(
      classification("cosmetic", { cosmetic: 0.94, behavioral: 0.04, unclear: 0.02 }),
    );
    const result = await toMatchSemanticSnapshot(ctx(), "Released on 1 January 2024.");
    expect(result.pass).toBe(true);
    expect(readSnapshot(testPath, "changelog 1")).toBe("Released on 2024-01-01.");
    expect(result.message()).toContain("baseline kept");
  });

  it("fails a cosmetic diff below the threshold", async () => {
    await toMatchSemanticSnapshot(ctx(), "a");
    resetSnapshotCounters();
    classifyDiffMock.mockResolvedValue(
      classification("cosmetic", { cosmetic: 0.71, behavioral: 0.2, unclear: 0.09 }),
    );
    const result = await toMatchSemanticSnapshot(ctx(), "b");
    expect(result.pass).toBe(false);
  });

  it("fails a behavioral diff with a line diff and a hint", async () => {
    await toMatchSemanticSnapshot(ctx(), "Breaking: none\nAdded: dark mode\nFixed: typos");
    resetSnapshotCounters();
    classifyDiffMock.mockResolvedValue(
      classification("behavioral", { cosmetic: 0.07, behavioral: 0.91, unclear: 0.02 }),
    );
    const result = await toMatchSemanticSnapshot(
      ctx(),
      "Breaking: drops node 18\nAdded: dark mode\nFixed: typos",
      { intent: "the list of breaking changes and their versions" },
    );
    expect(result.pass).toBe(false);
    const message = result.message().replace(snapshotFileFor(testPath), "<snapshot file>");
    expect(message).toMatchInlineSnapshot(`
      "expect(output).toMatchSemanticSnapshot()

        diff         behavioral   (confidence 0.88)
        cosmetic     0.07
        behavioral   0.91
        unclear      0.02
        needs        cosmetic ≥ 0.80
        model        jev-1.13.0   412 ms
        intent       "the list of breaking changes and their versions"
        snapshot     <snapshot file> > changelog 1

        - Breaking: none
        + Breaking: drops node 18
        … 2 unchanged lines

        hint: run with -u to accept this as the new baseline."
    `);
  });

  it("overwrites the baseline in update mode", async () => {
    await toMatchSemanticSnapshot(ctx(), "old");
    resetSnapshotCounters();
    const result = await toMatchSemanticSnapshot(ctx({ updateSnapshot: "all" }), "new");
    expect(result.pass).toBe(true);
    expect(classifyDiffMock).not.toHaveBeenCalled();
    expect(readSnapshot(testPath, "changelog 1")).toBe("new");
  });

  it("refuses to write a new snapshot when updates are off", async () => {
    const result = await toMatchSemanticSnapshot(ctx({ updateSnapshot: "none" }), "fresh");
    expect(result.pass).toBe(false);
    expect(result.message()).toContain("new snapshot not written in CI");
    expect(existsSync(snapshotFileFor(testPath))).toBe(false);
  });

  it("uses an explicit name and does not consume the counter", async () => {
    await toMatchSemanticSnapshot(ctx(), { kind: "auto" });
    await toMatchSemanticSnapshot(ctx(), "named", { name: "explicit" });
    await toMatchSemanticSnapshot(ctx(), "third");
    expect(
      Object.keys(JSON.parse(readFileSync(snapshotFileFor(testPath), "utf8")).snapshots),
    ).toEqual(["changelog 1", "changelog 2", "explicit"]);
  });

  it("counts calls per test name", async () => {
    await toMatchSemanticSnapshot(ctx(), "one");
    await toMatchSemanticSnapshot(ctx(), "two");
    await toMatchSemanticSnapshot(ctx({ currentTestName: "other" }), "three");
    expect(readSnapshot(testPath, "changelog 1")).toBe("one");
    expect(readSnapshot(testPath, "changelog 2")).toBe("two");
    expect(readSnapshot(testPath, "other 1")).toBe("three");
  });

  it("serializes object subjects with sorted keys", async () => {
    await toMatchSemanticSnapshot(ctx(), { b: 1, a: 2 });
    expect(readSnapshot(testPath, "changelog 1")).toBe('{\n  "a": 2,\n  "b": 1\n}');
  });

  it("is not supported in the negated form", async () => {
    const result = await toMatchSemanticSnapshot(ctx({ isNot: true }), "x");
    expect(result.pass).toBe(true);
    expect(result.message()).toContain("not supported");
  });

  it("rejects values that are not JSON-serializable", async () => {
    const result = await toMatchSemanticSnapshot(ctx(), Symbol("nope"));
    expect(result.pass).toBe(false);
    expect(existsSync(snapshotFileFor(testPath))).toBe(false);
  });
});
