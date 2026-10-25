#!/usr/bin/env node
/**
 * Retire Fastify (plan 16 Phase J, B32) — the gate and the deletion.
 *
 *   node scripts/retire-fastify.mjs           # report only (the default)
 *   node scripts/retire-fastify.mjs --apply   # delete, if the gate is clear
 *
 * Report mode lists every file outside the doomed directories that still
 * leans on the Fastify stack, so the code edits (docs/fastify-retirement.md)
 * can be done first and reviewed on their own. --apply deletes the
 * directories only when:
 *
 *   1. nothing outside them still references them, and
 *   2. the git working tree is clean — the deletion lands as its own commit,
 *      revertable in one step, never mixed with unrelated work.
 *
 * It never touches git itself: commit, push and the PR stay with a person.
 * The live launch checks (docs/fastify-retirement.md) come before --apply.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const apply = process.argv.includes("--apply");

/** What goes, once nothing needs it. */
const DOOMED = ["apps/api", "packages/db"];

/** What "still needs Fastify" looks like in code, config and CI. */
const MARKERS = [
  { pattern: /@siumora\/db\b/, why: "imports packages/db (the Fastify database layer)" },
  { pattern: /@siumora\/api\b|apps\/api\//, why: "points at apps/api" },
  { pattern: /drizzleStore/, why: "uses the worker's Fastify outbox store" },
  { pattern: /\bcreateClient\b[^\n]*@siumora\/sdk"|\bcreateClient\(env\)/, why: "constructs the SDK's Fastify transport" },
  { pattern: /(COMMERCE|E2E|OUTBOX)_BACKEND[^\n]{0,4}fastify/, why: "selects the Fastify backend" },
  { pattern: /E2E_BACKEND !== "medusa"|backend !== "medusa"/, why: "branches on the Fastify backend" },
];

/** Where the scan does not look: the doomed code itself, history, and prose. */
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".next-e2e", ".medusa", ".git", ".turbo", "plan", ".claude"]);
const SKIP_FILES = new Set(["scripts/retire-fastify.mjs", "docs/fastify-retirement.md", "pnpm-lock.yaml"]);
const EXTENSIONS = /\.(ts|tsx|mjs|cjs|js|json|ya?ml|example)$|^\.env\.example$/;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = relative(ROOT, path).split(sep).join("/");
    if (SKIP_DIRS.has(name) || DOOMED.some((doomed) => rel === doomed || rel.startsWith(`${doomed}/`))) continue;
    const stat = statSync(path);
    if (stat.isDirectory()) yield* files(path);
    else if (EXTENSIONS.test(name) && !SKIP_FILES.has(rel)) yield rel;
  }
}

const findings = [];
for (const rel of files(ROOT)) {
  const lines = readFileSync(join(ROOT, rel), "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    // Provenance notes ("ported from apps/api/…") are history, not a
    // dependency; they outlive the code they cite.
    if (/^\s*(\*|\/\/|\/\*|#)/.test(line)) return;
    for (const marker of MARKERS) {
      if (marker.pattern.test(line)) findings.push({ at: `${rel}:${index + 1}`, why: marker.why, line: line.trim() });
    }
  });
}

const present = DOOMED.filter((dir) => existsSync(join(ROOT, dir)));
console.log(`To delete: ${present.length ? present.join(", ") : "(already gone)"}`);

if (findings.length > 0) {
  console.log(`\n${findings.length} reference(s) to edit first (see docs/fastify-retirement.md):\n`);
  for (const finding of findings) console.log(`  ${finding.at}  — ${finding.why}\n      ${finding.line.slice(0, 140)}`);
} else {
  console.log("\nNothing outside those directories references Fastify.");
}

if (!apply) {
  console.log("\nReport only. Re-run with --apply once the list above is empty and the tree is clean.");
  process.exit(0);
}

if (findings.length > 0) {
  console.error("\nRefusing --apply: references remain.");
  process.exit(1);
}
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim();
if (dirty) {
  console.error("\nRefusing --apply: the working tree has uncommitted changes. Commit them first so the deletion is its own commit.");
  process.exit(1);
}

for (const dir of present) {
  rmSync(join(ROOT, dir), { recursive: true, force: true });
  console.log(`deleted ${dir}`);
}
console.log("\nDone. Run `pnpm install` (the lockfile drops the two packages), then typecheck, test and E2E before committing.");
