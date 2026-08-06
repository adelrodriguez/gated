import core from "adamantite/lint"
import react from "adamantite/lint/react"
import { defineConfig } from "oxlint"

export default defineConfig({
  extends: [core, react],
  options: {
    respectEslintDisableDirectives: true,
    typeAware: true,
    typeCheck: true,
  },
})
