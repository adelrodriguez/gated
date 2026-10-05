import type { KnipConfig } from "knip"
import analyze from "adamantite/analyze"

const config: KnipConfig = {
  ...analyze,
  entry: ["src/**/*.test-d.ts"],
  ignore: [],
  ignoreFiles: [],
  project: ["scripts/**/*.ts", "src/**/*.{ts,tsx}", "*.config.ts"],
}

export default config
