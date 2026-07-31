import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";

/**
 * The Medusa boundary, enforced mechanically (design doc M1, eng review).
 *
 * Medusa shapes may exist in exactly two places: `apps/medusa` and the
 * mapping module `packages/sdk/src/medusa.ts`. Everywhere else the domain
 * speaks core's shapes. Prose does not enforce that; this test does — the
 * same idiom as the repo's DB CHECKs, boot guards and CSP test: if any other
 * file grows an `@medusajs` import, the suite fails and names it.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".next",
  ".next-e2e",
  ".medusa",
  ".turbo",
  ".claude",
  "test-results",
]);

/** The one directory allowed to import Medusa. */
const ALLOWED_PREFIX = `apps${sep}medusa${sep}`;

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      yield* sourceFiles(full);
    } else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry)) {
      yield full;
    }
  }
}

test("no file outside apps/medusa imports @medusajs", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(REPO_ROOT)) {
    const rel = relative(REPO_ROOT, file);
    if (rel.startsWith(ALLOWED_PREFIX)) continue;
    const source = readFileSync(file, "utf8");
    if (/from\s+["']@medusajs|require\(\s*["']@medusajs|import\s+["']@medusajs/.test(source)) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Medusa imports outside apps/medusa: ${offenders.join(", ")} — ` +
      "the storefront speaks core shapes only; extend packages/sdk/src/medusa.ts instead.",
  );
});

test("even the mapping module stays wire-level: fetch, not @medusajs", () => {
  const source = readFileSync(join(import.meta.dirname, "medusa.ts"), "utf8");
  assert.ok(
    !/from\s+["']@medusajs|require\(\s*["']@medusajs|import\s+["']@medusajs/.test(source),
    "packages/sdk/src/medusa.ts must talk to the store REST API, never link Medusa packages",
  );
});
