import { beforeEach, describe, expect, it, vi } from "vitest";
import { satisfies, satisfiesAll } from "../../src/judge.js";
import type { SatisfyResult } from "../../src/types.js";
import { jevtestMatchers, setupJevtest } from "../../src/vitest.js";

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

const satisfiesMock = vi.mocked(satisfies);
const satisfiesAllMock = vi.mocked(satisfiesAll);

function judged(probability: number): SatisfyResult {
  return {
    probability,
    model: "jev-1.13.0",
    cached: false,
    latencyMs: 412,
    question: { type: "noul", instructions: "q" },
    state: { output: "x" },
  };
}

setupJevtest();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("vitest registration", () => {
  it("exposes the raw matcher object", () => {
    expect(Object.keys(jevtestMatchers)).toEqual([
      "toSatisfy",
      "toSatisfyAll",
      "toMatchSemanticSnapshot",
    ]);
  });

  it("passes a real assertion through expect.extend", async () => {
    satisfiesMock.mockResolvedValue(judged(0.97));
    await expect("x").toSatisfy("y");
  });

  it("supports the negated form", async () => {
    satisfiesMock.mockResolvedValue(judged(0.02));
    await expect("x").not.toSatisfy("y");
  });

  it("rejects with the rendered message when the assertion fails", async () => {
    satisfiesMock.mockResolvedValue(judged(0.31));
    await expect(expect("x").toSatisfy("y")).rejects.toThrow("probability  0.31");
  });

  it("supports toSatisfyAll", async () => {
    satisfiesAllMock.mockResolvedValue([judged(0.9), judged(0.95)]);
    await expect("x").toSatisfyAll(["a", "b"]);
  });

  it("keeps the built-in predicate form of toSatisfy working", () => {
    expect(21).toSatisfy((value) => typeof value === "number");
    expect(satisfiesMock).not.toHaveBeenCalled();
  });
});
