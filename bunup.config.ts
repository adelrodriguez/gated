import { defineConfig } from "bunup"

export default defineConfig({
  dts: true,
  entry: [
    "src/index.ts",
    "src/hooks/index.ts",
    "src/hooks/recipes.ts",
    "src/integrations/react.tsx",
  ],
  format: "esm",
  outDir: "dist",
  sourcemap: true,
  target: "node",
})
