import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      thresholds: {
        functions: 90,
        lines: 90,
        perFile: true,
        statements: 90,
      },
    },
    include: ["src/**/*.test.{ts,tsx}"],
  },
})
