import type { KnipConfig } from "knip"
import analyze from "adamantite/analyze"

const config = {
  ...analyze,
  entry: [
    "bunup.config.ts",
    "src/index.ts",
    "src/hooks/index.ts",
    "src/integrations/react.tsx",
    "src/__tests__/entrypoints.types.ts",
  ],
  ignore: [],
  ignoreFiles: [],
  project: ["src/**/*.{ts,tsx}", "*.config.ts"],
} satisfies KnipConfig

export default config
