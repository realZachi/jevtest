import { describe, expect, it } from "vitest";
import {
  excerpt,
  formatProbability,
  renderLineDiff,
  renderReplayMissHint,
  subjectText,
} from "../../src/format.js";

describe("excerpt", () => {
  it("quotes single-line strings", () => {
    expect(excerpt("hello", 100)).toBe('"hello"');
  });

  it("keeps multi-line strings raw", () => {
    expect(excerpt("a\nb", 100)).toBe("a\nb");
  });

  it("clips long values and reports how much was dropped", () => {
    expect(excerpt("abcdefghij", 4)).toBe('"abcd" … (+6 more chars)');
  });

  it("serializes objects with sorted keys", () => {
    expect(subjectText({ b: 1, a: 2 })).toBe('{\n  "a": 2,\n  "b": 1\n}');
  });
});

describe("formatProbability", () => {
  it("always uses two decimals", () => {
    expect(formatProbability(0.31)).toBe("0.31");
    expect(formatProbability(1)).toBe("1.00");
    expect(formatProbability(0.126)).toBe("0.13");
  });
});

describe("renderLineDiff", () => {
  it("shows only the changed middle", () => {
    const previous = "head\nold line\ntail";
    const current = "head\nnew line\ntail";
    expect(renderLineDiff(previous, current)).toMatchInlineSnapshot(`
      "  … 1 unchanged line
        - old line
        + new line
        … 1 unchanged line"
    `);
  });

  it("handles single-line values", () => {
    expect(renderLineDiff("a", "b")).toBe("  - a\n  + b");
  });
});

describe("renderReplayMissHint", () => {
  it("names the recording command", () => {
    expect(renderReplayMissHint()).toContain("JEVTEST_MODE=record");
  });
});
