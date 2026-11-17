// Runtime config resolved from Vite env. The API base is the only external
// dependency (used by the schedule beat's live departures fetch); everything
// else on this page is static/baked.
//
// Dev: the API worker runs on :3000 and this Vite dev server on :5174 (fixed,
// see docs/dev-ports.md). The API answers any origin; :5174 is also on its
// rate-limit exemption list (apps/api/src/middleware/rate-limit.ts).
export const API_BASE_URL: string
  = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'
