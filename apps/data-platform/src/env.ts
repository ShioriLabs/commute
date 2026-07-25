// Runtime config resolved from Vite env. The API base is the only external
// dependency (used by the schedule beat's live departures fetch); everything
// else on this page is static/baked.
//
// Dev: the API worker runs on :3000. Note the data-platform Vite dev server
// binds :5174 when apps/web already holds :5173 — that origin must be in the
// API's CORS allowlist (apps/api/src/app.ts) for departures to load.
export const API_BASE_URL: string
  = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'
