import path from "path";

import { defineConfig } from "vitest/config";

/**
 * Unit-test runner for pure, framework-free modules (security helpers, model
 * selection, etc.). Kept in a Node environment — these tests exercise crypto,
 * net and dns, not the DOM. The "@/..." path alias mirrors tsconfig.json.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
