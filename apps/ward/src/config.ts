/*
 * Environment for every ward entry point. Read once, validated up front, so a
 * missing variable fails at start instead of at 00:30 in the middle of a
 * checkpoint.
 *
 * TZ is not read here: the systemd units set TZ=Asia/Jakarta for the process,
 * and every date in ward goes through days.ts, which works in WIB explicitly.
 */

export interface CollectConfig {
  /**
   * SSE endpoint of the upstream relay's TransJakarta feed. Deployment config
   * only, never committed; ward reads a relay, never TJ's own services (see
   * docs/adr/ward-collector.md).
   */
  feedUrl: string
  dataDir: string
  /** No event for this long -> abort and reconnect. */
  idleMs: number
  /** No snapshot for this long -> a `gap` record. The relay pushes every ~30s. */
  gapMs: number
  /** Watchdog tick; only tests shorten it. */
  tickMs?: number
}

export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

export interface CheckpointConfig {
  dataDir: string
  /** Absent on a dry run, which never touches R2. */
  r2?: R2Config
  /** Days a verified local .zst is kept after upload. */
  keepArchiveDays: number
  /** healthchecks.io-style URL, GET on success. Optional. */
  pingUrl?: string
}

type Env = Record<string, string | undefined>

function required(env: Env, name: string): string {
  const value = env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function numeric(env: Env, name: string, fallback: number): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number, got ${raw}`)
  return value
}

export function collectConfig(env: Env = process.env): CollectConfig {
  return {
    feedUrl: required(env, 'WARD_FEED_URL'),
    dataDir: required(env, 'WARD_DATA_DIR'),
    idleMs: numeric(env, 'WARD_IDLE_MS', 45_000),
    gapMs: numeric(env, 'WARD_GAP_MS', 90_000)
  }
}

export function r2Config(env: Env = process.env): R2Config {
  return {
    accountId: required(env, 'R2_ACCOUNT_ID'),
    accessKeyId: required(env, 'R2_ACCESS_KEY_ID'),
    secretAccessKey: required(env, 'R2_SECRET_ACCESS_KEY'),
    bucket: env.R2_BUCKET || 'commute-ward'
  }
}

export function checkpointConfig(
  env: Env = process.env,
  options: { dataDir?: string, dryRun?: boolean } = {}
): CheckpointConfig {
  return {
    dataDir: options.dataDir ?? required(env, 'WARD_DATA_DIR'),
    r2: options.dryRun ? undefined : r2Config(env),
    keepArchiveDays: numeric(env, 'WARD_KEEP_ARCHIVE_DAYS', 30),
    pingUrl: env.WARD_PING_URL || undefined
  }
}
