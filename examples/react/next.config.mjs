import path from "node:path"
import { fileURLToPath } from "node:url"

const directory = path.dirname(fileURLToPath(import.meta.url))
const webpackAliases = {
  gated: path.resolve(directory, "../../src/index.ts"),
  "gated/hooks": path.resolve(directory, "../../src/hooks/index.ts"),
  "gated/hooks/recipes": path.resolve(directory, "../../src/hooks/recipes.ts"),
  "gated/react": path.resolve(directory, "../../src/integrations/react.tsx"),
}

/**
 * @type {import("next").NextConfig}
 */
const config = {
  output: "standalone",
  experimental: { externalDir: true },
  turbopack: {
    root: path.resolve(directory, "../.."),
    resolveAlias: {
      gated: "../../src/index.ts",
      "gated/hooks": "../../src/hooks/index.ts",
      "gated/hooks/recipes": "../../src/hooks/recipes.ts",
      "gated/react": "../../src/integrations/react.tsx",
    },
  },
  webpack(nextConfig) {
    nextConfig.resolve.alias = { ...nextConfig.resolve.alias, ...webpackAliases }
    return nextConfig
  },
}

export default config
