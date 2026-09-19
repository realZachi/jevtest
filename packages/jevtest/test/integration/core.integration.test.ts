import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetCache } from "../../src/cache.js";
import { configure, resetConfig } from "../../src/config.js";
import { classifyDiff, satisfiesAll } from "../../src/judge.js";
import { getStats, resetStats } from "../../src/stats.js";

const hasKey = Boolean(process.env.TYPESAFE_API_KEY);
const suite = hasKey ? describe : describe.skip;

const SUPPORT_REPLY =
  "I'm so sorry about the double charge. I can't issue a refund from here, but I've opened a ticket and billing will contact you within 24 hours.";

suite("core against the live API", () => {
  beforeAll(() => {
    resetConfig();
    configure({ cache: "memory", mode: "live" });
    resetCache();
    resetStats();
  });

  afterAll(() => {
    resetConfig();
    resetCache();
  });

  it("judges three expectations about one reply in a single request", async () => {
    const [polite, noRefund, blame] = await satisfiesAll(SUPPORT_REPLY, [
      "Does `output` apologize politely?",
      {
        text: "Does `output` avoid promising a refund?",
        yes: "No refund is promised or committed to",
        no: "A refund is promised, confirmed, or initiated",
      },
      "Does `output` blame the customer?",
    ]);

    expect(polite?.probability).toBeGreaterThan(0.8);
    expect(noRefund?.probability).toBeGreaterThan(0.8);
    expect(blame?.probability).toBeLessThan(0.2);
    expect(polite?.model).toMatch(/^jev-/);
    expect(getStats().requests).toBe(1);
    expect(getStats().questions).toBe(3);
  }, 30_000);

  it("classifies a rewording as cosmetic and a fact change as behavioral", async () => {
    const [cosmetic, behavioral] = await Promise.all([
      classifyDiff({
        previous: "Billing will contact you within 24 hours.",
        current: "Within 24 hours, billing is going to reach out to you.",
      }),
      classifyDiff({
        previous: "Billing will contact you within 24 hours.",
        current: "Billing will contact you within 5 business days.",
      }),
    ]);
    expect(cosmetic.kind).toBe("cosmetic");
    expect(behavioral.kind).toBe("behavioral");
  }, 30_000);
});
