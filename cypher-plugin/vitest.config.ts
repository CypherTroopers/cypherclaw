import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: { name: "backend", include: ["src/**/*.test.ts"], environment: "node" },
      },
      {
        extends: true,
        test: { name: "browser", include: ["browser/**/*.test.ts"], environment: "jsdom" },
      },
    ],
  },
});
