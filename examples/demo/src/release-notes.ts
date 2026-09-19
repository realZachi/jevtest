/**
 * A deterministic markdown renderer plus three inputs: a baseline, a cosmetic
 * rewrite of the same facts, and a behavioral change. Used by the semantic
 * snapshot demo, where only the cosmetic variant should pass.
 */

export type EntryKind = "breaking" | "feature" | "fix";

export interface Entry {
  kind: EntryKind;
  version: string;
  summary: string;
}

const HEADINGS: Record<EntryKind, string> = {
  breaking: "Breaking changes",
  feature: "Features",
  fix: "Fixes",
};

const ORDER: EntryKind[] = ["breaking", "feature", "fix"];

/** Render entries as markdown, grouped by kind, in the order they were given. */
export function renderReleaseNotes(entries: Entry[]): string {
  const sections: string[] = ["# Release notes"];
  for (const kind of ORDER) {
    const group = entries.filter((entry) => entry.kind === kind);
    if (group.length === 0) continue;
    sections.push(`## ${HEADINGS[kind]}`);
    sections.push(group.map((entry) => `- ${entry.version}: ${entry.summary}`).join("\n"));
  }
  return `${sections.join("\n\n")}\n`;
}

/** The committed baseline. */
export const baseline: Entry[] = [
  {
    kind: "breaking",
    version: "2.3.0",
    summary: "createClient no longer accepts a string, pass { apiKey } instead",
  },
  { kind: "breaking", version: "2.2.0", summary: "Node 18 is no longer supported" },
  { kind: "feature", version: "2.3.0", summary: "Streaming responses for the query endpoint" },
  { kind: "fix", version: "2.3.1", summary: "Retries no longer double count usage" },
];

/**
 * Same breaking changes and versions, reordered bullets, "v" prefixes and
 * different punctuation. Jev should classify this as cosmetic.
 */
export const cosmeticChange: Entry[] = [
  { kind: "breaking", version: "v2.2.0", summary: "Node 18 support has been dropped." },
  {
    kind: "breaking",
    version: "v2.3.0",
    summary: "createClient takes an { apiKey } object; the string form was removed.",
  },
  { kind: "fix", version: "v2.3.1", summary: "Usage is no longer double counted on retries." },
  { kind: "feature", version: "v2.3.0", summary: "The query endpoint can stream responses." },
];

/**
 * One breaking change is gone and the other moved to a different version.
 * Jev should classify this as behavioral.
 */
export const behavioralChange: Entry[] = [
  {
    kind: "breaking",
    version: "2.4.0",
    summary: "createClient no longer accepts a string, pass { apiKey } instead",
  },
  { kind: "feature", version: "2.3.0", summary: "Streaming responses for the query endpoint" },
  { kind: "fix", version: "2.3.1", summary: "Retries no longer double count usage" },
];
