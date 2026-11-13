import { defineConfig } from "vitest/config";

/**
 * Its own config: this package is developed both standalone and as a workspace
 * member, and without this file the parent workspace's include patterns win and
 * these tests silently do not run.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
