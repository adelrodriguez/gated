import { defineConfig } from "bunup"

export default defineConfig({
  dts: true,
  entry: ["src/index.ts", "src/hooks/index.ts", "src/integrations/react.tsx"],
  format: "esm",
  jsx: {
    development: false,
  },
  outDir: "dist",
  sourcemap: "external",
  target: "browser",
})
