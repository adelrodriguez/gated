---
"gated": patch
---

Reorganize source code structure by moving React integration to integrations directory

- Moved React integration from `src/react.tsx` to `src/integrations/react.tsx` for better organization
- Updated main entry point from `./index.ts` to `./src/index.ts` for consistency
- Updated internal import paths to reflect new directory structure
- No changes to public API - all package exports remain the same
