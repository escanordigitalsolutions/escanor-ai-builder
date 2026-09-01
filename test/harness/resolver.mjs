/**
 * Module resolution for the harness: the tsconfig "@/..." alias, TypeScript
 * extensions Node does not add on its own, and stand-ins for `vitest` and
 * `openai` (neither is installable here).
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const ROOT = process.cwd();
const HARNESS = path.join(ROOT, "test", "harness");
const SHIM = pathToFileURL(path.join(HARNESS, "vitest.ts")).href;

function withExt(p) {
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  for (const e of [".ts", ".tsx", ".js", "/index.ts"]) {
    if (fs.existsSync(p + e)) return p + e;
  }
  return p;
}

export async function resolve(specifier, context, next) {
  if (specifier === "vitest") return { url: SHIM, shortCircuit: true };
  // Always the stub, even where the real package is installed: the real client
  // refuses to construct without OPENAI_API_KEY, and these suites parse
  // responses rather than fetch them. A test that needs a real client fails
  // loudly on the stub instead of quietly reaching the network.
  if (specifier === "openai") {
    return { url: pathToFileURL(path.join(HARNESS, "openai.ts")).href, shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    return { url: pathToFileURL(withExt(path.join(ROOT, specifier.slice(2)))).href, shortCircuit: true };
  }
  if (specifier.startsWith(".")) {
    const base = path.dirname(new URL(context.parentURL).pathname);
    return { url: pathToFileURL(withExt(path.resolve(base, specifier))).href, shortCircuit: true };
  }
  return next(specifier, context);
}
