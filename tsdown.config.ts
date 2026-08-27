import { defineConfig } from "tsdown"

export default defineConfig({
  clean: true,
  deps: {
    neverBundle: true,
  },
  dts: true,
  entry: ["src/index.ts", "src/hooks/index.ts", "src/integrations/react.tsx"],
  fixedExtension: false,
  format: "esm",
  minify: false,
  outDir: "dist",
  platform: "browser",
  sourcemap: true,
})
