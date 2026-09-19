/**
 * Answer cache. Memory by default; a single JSON file when the run needs to
 * survive the process (`record` / `replay`, or `cache: "file"`).
 */
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./config.js";
import { CACHE_VERSION } from "./questions.js";

/** A model answer, stripped down to what a later run needs. */
export type CachedAnswer =
  | { type: "noul"; noul: number; model: string }
  | {
      type: "choice";
      choice: string;
      confidence: number;
      probabilities: Record<string, number>;
      model: string;
    };

/** Storage for answers keyed by `questionKey()`. */
export interface JudgmentCache {
  get(key: string): CachedAnswer | undefined;
  set(key: string, value: CachedAnswer): void;
  flush(): Promise<void>;
  size(): number;
}

/** Per-process cache. Lost when the process exits. */
export class MemoryCache implements JudgmentCache {
  readonly #entries = new Map<string, CachedAnswer>();

  get(key: string): CachedAnswer | undefined {
    return this.#entries.get(key);
  }

  set(key: string, value: CachedAnswer): void {
    this.#entries.set(key, value);
  }

  async flush(): Promise<void> {}

  size(): number {
    return this.#entries.size;
  }
}

/** Cache that never stores anything. */
export class NoopCache implements JudgmentCache {
  get(): undefined {
    return undefined;
  }

  set(): void {}

  async flush(): Promise<void> {}

  size(): number {
    return 0;
  }
}

interface CacheFile {
  version: number;
  entries: Record<string, CachedAnswer>;
}

/**
 * Cache backed by `<dir>/cache.json`. Reads are lazy and synchronous. Writes
 * from one synchronous burst of `set()` calls (a batch of answers) are
 * coalesced into a single write on the next microtask, merged with whatever
 * is already on disk so parallel vitest workers do not clobber each other.
 *
 * The write is deliberately not deferred to a timer: test runners tear their
 * workers down as soon as the last test settles, and a pending timer would
 * lose the final judgment of every file. A microtask always runs before the
 * current turn yields, so the entry is on disk before the test can finish.
 * The exit hook remains as a safety net.
 */
export class FileCache implements JudgmentCache {
  readonly file: string;
  readonly #entries = new Map<string, CachedAnswer>();
  readonly #pending = new Map<string, CachedAnswer>();
  readonly #onExit = () => {
    this.#writeNow();
  };
  #loaded = false;
  #scheduled = false;

  constructor(dir: string) {
    this.file = path.join(dir, "cache.json");
    process.on("exit", this.#onExit);
  }

  get(key: string): CachedAnswer | undefined {
    this.#load();
    return this.#entries.get(key);
  }

  set(key: string, value: CachedAnswer): void {
    this.#load();
    this.#entries.set(key, value);
    this.#pending.set(key, value);
    if (!this.#scheduled) {
      this.#scheduled = true;
      queueMicrotask(() => {
        this.#scheduled = false;
        this.#writeNow();
      });
    }
  }

  async flush(): Promise<void> {
    this.#writeNow();
  }

  size(): number {
    this.#load();
    return this.#entries.size;
  }

  /** Write anything pending and stop the exit hook. Used by `resetCache()`. */
  dispose(): void {
    this.#writeNow();
    process.removeListener("exit", this.#onExit);
  }

  #load(): void {
    if (this.#loaded) return;
    this.#loaded = true;
    for (const [key, value] of Object.entries(readFile(this.file))) {
      this.#entries.set(key, value);
    }
  }

  #writeNow(): void {
    if (this.#pending.size === 0) return;
    const merged: Record<string, CachedAnswer> = { ...readFile(this.file) };
    for (const [key, value] of this.#pending) merged[key] = value;
    this.#pending.clear();
    for (const [key, value] of Object.entries(merged)) this.#entries.set(key, value);
    const payload: CacheFile = { version: CACHE_VERSION, entries: sortEntries(merged) };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(temp, this.file);
  }
}

function readFile(file: string): Record<string, CachedAnswer> {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(text) as Partial<CacheFile>;
    if (parsed.version !== CACHE_VERSION || typeof parsed.entries !== "object") return {};
    return parsed.entries ?? {};
  } catch {
    return {};
  }
}

function sortEntries(entries: Record<string, CachedAnswer>): Record<string, CachedAnswer> {
  const sorted: Record<string, CachedAnswer> = {};
  for (const key of Object.keys(entries).sort()) {
    const value = entries[key];
    if (value !== undefined) sorted[key] = value;
  }
  return sorted;
}

let current: { cache: JudgmentCache; signature: string } | undefined;

/**
 * The cache for the current configuration. `record` and `replay` always use
 * the file cache: recording must persist, and replaying must find it again.
 */
export function getCache(): JudgmentCache {
  const config = getConfig();
  const mode = config.mode === "live" ? config.cache : "file";
  const signature = `${mode}:${config.cacheDir}`;
  if (current?.signature === signature) return current.cache;
  resetCache();
  const cache =
    mode === "file"
      ? new FileCache(config.cacheDir)
      : mode === "off"
        ? new NoopCache()
        : new MemoryCache();
  current = { cache, signature };
  return cache;
}

/** Drop the cache singleton, flushing pending file writes first. */
export function resetCache(): void {
  const existing = current?.cache;
  current = undefined;
  if (existing instanceof FileCache) {
    void existing.flush();
    existing.dispose();
  }
}

/** Write any pending file-cache entries to disk. */
export async function flushCache(): Promise<void> {
  await current?.cache.flush();
}
