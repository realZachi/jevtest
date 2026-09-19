import "jevtest/vitest"; // matcher types; the setup file registers them
import { describe, expect, it } from "vitest";
import {
  baseline,
  behavioralChange,
  cosmeticChange,
  renderReleaseNotes,
} from "../src/release-notes.js";

const demoFail = process.env.JEVTEST_DEMO_FAIL === "1";

// What the snapshot is about. Everything else in the markdown is free to move.
const intent = "the list of breaking changes and their versions";

// The three tests share one baseline, stored in
// test/__semantic_snapshots__/release-notes.test.ts.jevsnap.json.
const name = "release-notes";

describe("release notes snapshot", () => {
  it("records the baseline", async () => {
    // The first run with a key writes the snapshot. Every later run with an
    // identical output passes without calling the API.
    await expect(renderReleaseNotes(baseline)).toMatchSemanticSnapshot({ intent, name });
  });

  it("accepts a cosmetic rewrite", async () => {
    // Bullets reordered, "v2.3.0" instead of "2.3.0", different punctuation.
    // Same breaking changes, same versions, so Jev classifies this as cosmetic.
    await expect(renderReleaseNotes(cosmeticChange)).toMatchSemanticSnapshot({ intent, name });
  });

  // Unskip to see the failure. One breaking change is gone and the other moved
  // from 2.3.0 to 2.4.0, so the diff is classified as behavioral and the
  // matcher fails with the classification, its probabilities and the diff.
  it.skip("rejects a behavioral change", async () => {
    await expect(renderReleaseNotes(behavioralChange)).toMatchSemanticSnapshot({ intent, name });
  });

  it.runIf(demoFail)("JEVTEST_DEMO_FAIL=1: rejects a behavioral change", async () => {
    await expect(renderReleaseNotes(behavioralChange)).toMatchSemanticSnapshot({ intent, name });
  });
});
