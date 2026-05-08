/**
 * Sprint 0 — codegen drift check stub.
 *
 * After running `pnpm schema:gen`, the file `src/types/document.ts` is
 * created from the JSON Schema. This stub imports a few names so CI catches
 * breaking changes immediately.
 *
 * Until codegen has been run for the first time, the import below resolves
 * to `unknown` via the placeholder file. CI invokes:
 *   pnpm schema:gen && pnpm --filter @mx/web typecheck
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type * as DocumentTypes from './document'

export type _Check = typeof DocumentTypes
