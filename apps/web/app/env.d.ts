/// <reference types="vite/client" />

// Typed so `import.meta.env.VITE_API_BASE_URL` is a string rather than the
// implicit `any` that vite/client's index signature hands back. That `any` is
// what let a `new URL(path, undefined)` slip through unnoticed for as long as
// it did.
interface ImportMetaEnv {
  /** Base URL of the Commute API, without a trailing slash. See .env.example. */
  readonly VITE_API_BASE_URL: string
  /**
   * '1' only in the self-hosted lite bundle (scripts/build-lite.ts); undefined
   * everywhere else. Optional and string-typed on purpose: it is the raw shape
   * Vite injects, and app/lib/build-mode.ts is the one place allowed to read it.
   */
  readonly VITE_LITE?: string
  /**
   * 'pages' when the lite bundle is built for Cloudflare Pages; undefined or
   * 'apache' for the self-hosted zip. Only meaningful alongside VITE_LITE, and
   * read only by app/lib/build-mode.ts.
   */
  readonly VITE_LITE_HOST?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
