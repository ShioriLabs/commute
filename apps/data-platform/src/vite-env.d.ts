/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Commute API. Defaults to http://localhost:3000 in dev. */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
