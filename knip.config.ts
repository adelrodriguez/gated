import type { KnipConfig } from "knip"
import analyze from "adamantite/analyze"

const config = {
  ...analyze,
  entry: [
    "bunup.config.ts",
    "src/index.ts",
    "src/hooks/index.ts",
    "src/hooks/recipes.ts",
    "src/integrations/react.tsx",
  ],
  ignore: [],
  ignoreFiles: [],
  project: ["src/**/*.{ts,tsx}", "test/**/*.ts", "*.config.ts"],
} satisfies KnipConfig

export default config
