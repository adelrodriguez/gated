---
"gated": patch
---

Update dev dependencies and pin dependency versions for better reproducibility

- Updated @biomejs/biome from 2.2.6 to 2.3.0 for latest linting and formatting improvements
- Updated adamantite from 0.11.1 to 0.12.0
- Pinned all type definition packages (@types/bun, @types/react, @types/react-dom) and @testing-library/react to exact versions instead of using semver ranges
- Pinned react-dom to 19.2.0 and added explicit react peer dependency constraint (^19.2.0)
- Added "bump:deps" script for interactive dependency updates via Bun
