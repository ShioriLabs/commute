export interface Bindings {
  DB: D1Database
  KV: KVNamespace
  ACCESS_TEAM_DOMAIN: string
  ACCESS_AUD: string
  // .dev.vars only. Skips the Access check and acts as this user.
  ACCESS_DEV_USER?: string
}

export interface AdminEnv {
  Bindings: Bindings
  Variables: { user: string }
}
