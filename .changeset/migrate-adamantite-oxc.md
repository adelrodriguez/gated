---
"gated": patch
---

Migrate toolchain from Biome to adamantite 0.30 (oxc)

- Replace `@biomejs/biome` with `oxlint` + `oxfmt` via `adamantite` ^0.30.2
- Replace `tsdown` with `bunup` as build tool
- Add `knip` for unused dependency and export analysis
- Restructure CI pipeline into chained workflows: adamantite → test → build → release
- Add OIDC-based npm publishing in release workflow
- Add editor settings for Zed (`.zed/settings.json`)
