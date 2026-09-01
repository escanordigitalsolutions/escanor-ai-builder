import fs from "node:fs";
import path from "node:path";

import { drain, state } from "./vitest.ts";

/**
 * Runs the repo's vitest suites without vitest.
 *
 * vitest will not start on this machine: it needs @rollup/rollup-linux-arm64-gnu
 * and the registry refuses to serve it, in the container and on the device
 * alike. That left every test in this repo unrunnable, which is worse than
 * having none — `tsc` and `eslint` check shape, and the bugs that have actually
 * shipped here were behavioural. This runner supplies just enough of vitest
 * (describe/it/expect, the matchers these suites use) to run them for real.
 *
 * It is not a vitest replacement. `vi.mock` is not supported, so the three
 * suites that mock a module are skipped by name rather than silently passing.
 *
 *   node --experimental-strip-types --import ./test/harness/hook.mjs \
 *        test/harness/runall.mts
 */

const ROOT = process.cwd();

// Needs vi.mock, which this harness does not implement. Skipped loudly.
const UNSUPPORTED = [
  "lib/ai/__tests__/resolve.test.ts",
  "lib/wordpress/__tests__/project-files.test.ts",
  "lib/wordpress/__tests__/content-snapshot.test.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".test.ts")) out.push(path.relative(ROOT, full));
  }
  return out;
}

const all = walk(ROOT).sort();
const files = all.filter((f) => !UNSUPPORTED.includes(f));

for (const f of files) {
  const before = state.pass + state.fail;
  try {
    await import(path.join(ROOT, f));
    await drain(f);
  } catch (e) {
    state.fail++;
    state.failures.push(`${f} :: could not load\n       ${(e as Error).message}`);
  }
  console.log(`${String(state.pass + state.fail - before).padStart(4)}  ${f}`);
}

for (const f of all.filter((f) => UNSUPPORTED.includes(f))) {
  console.log(`skip  ${f}  (needs vi.mock)`);
}

console.log("");
for (const f of state.failures) console.log("FAIL " + f);
console.log(`\n${state.pass} passed, ${state.fail} failed`);
process.exit(state.fail ? 1 : 0);
