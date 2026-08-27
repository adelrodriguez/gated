import type { KnipConfig } from "knip"
import analyze from "adamantite/analyze"

const config: KnipConfig = {
  ...analyze,
  entry: ["src/__tests__/entrypoints.types.ts"],
  ignore: [],
  ignoreFiles: [],
  project: ["scripts/**/*.ts", "src/**/*.{ts,tsx}", "*.config.ts"],
}

export default config
