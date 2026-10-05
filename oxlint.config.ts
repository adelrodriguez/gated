import core from "adamantite/lint"
import react from "adamantite/lint/react"
import reactStrict from "adamantite/lint/react-strict"
import { defineConfig } from "oxlint"

export default defineConfig({
  extends: [core, react, reactStrict],
  ignorePatterns: ["examples/**"],
  options: {
    respectEslintDisableDirectives: true,
    typeAware: true,
    typeCheck: true,
  },
  overrides: [
    {
      files: ["src/__tests__/types.test-d.ts"],
      rules: {
        "eslint/no-lone-blocks": "off",
      },
    },
  ],
  rules: {
    "adamantite/no-react-state-hooks": [
      "error",
      {
        allow: ["**/use[A-Z]*.{ts,tsx}", "**/use-*.{ts,tsx}", "**/hooks/**", "src/integrations/**"],
      },
    ],
  },
})
