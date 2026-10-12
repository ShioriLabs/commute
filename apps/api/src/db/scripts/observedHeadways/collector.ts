import { type HealthGate, SCOPE_FRESH_MS, isHealthy } from './health'
import type { Gap, Obs, SnapshotRecord } from './snapshots'

/** Silence between snapshots longer than this is a gap (collector restarts, missing days). */
export const SILENCE_GAP_MS = 90_000
/** The relay replays the latest snapshot on reconnect; a second one this soon is that replay. */
export const REPLAY_WINDOW_MS = 5_000

/*
 * Folds a stream of snapshot records into per-vehicle observation series and
 * the stretches that cannot be trusted.
 *
 * Observations are deduped on the relay's own update time, so a vehicle that
 * sat frozen across ten snapshots contributes one observation, not ten.
 * Unhealthy snapshots and silences are recorded as gaps; consecutive stale
 * snapshots extend one gap rather than stacking.
 */
export class SnapshotCollector {
  readonly series = new Map<string, Obs[]>()
  readonly gaps: Gap[] = []
  t0 = Infinity
  t1 = -Infinity
  snapCount = 0
  degradedSnaps = 0

  private readonly lastUpd = new Map<string, number>()
  private prevSnapT = 0
  private prevHealthy = true

  constructor(
    /** Line codes in scope; vehicles on other routes are ignored. */
    private readonly routes: ReadonlySet<string>,
    private readonly gate: HealthGate
  ) {}

  add(rec: SnapshotRecord): void {
    if (rec.k === 'gap') {
      this.gaps.push(rec)
      return
    }
    if (rec.k !== 's') return

    this.snapCount++
    this.t0 = Math.min(this.t0, rec.t)
    this.t1 = Math.max(this.t1, rec.t)

    let fresh = 0
    let scope = 0
    for (const [body, route, next, , , , upd] of rec.v) {
      const inScope = this.routes.has(route)
      if (inScope && rec.t - upd < SCOPE_FRESH_MS) scope++
      if (this.lastUpd.get(body) === upd) continue
      this.lastUpd.set(body, upd)
      if (!inScope) continue
      fresh++
      let list = this.series.get(body)
      if (!list) this.series.set(body, list = [])
      list.push({ t: upd, route, next: next ? next.split('-')[0]! : '' })
    }

    // Spike-era data kept the relay's replayed duplicate; it has zero fresh by construction.
    if (this.prevSnapT && rec.t - this.prevSnapT < REPLAY_WINDOW_MS) return
    if (this.prevSnapT && rec.t - this.prevSnapT > SILENCE_GAP_MS) {
      this.gaps.push({ k: 'gap', from: this.prevSnapT, to: rec.t, why: 'silence' })
    }
    const healthy = isHealthy(this.gate, fresh, scope)
    if (!healthy && this.prevSnapT) {
      this.degradedSnaps++
      const last = this.gaps.at(-1)
      // Extend a running stale stretch rather than stacking one gap per snapshot.
      if (!this.prevHealthy && last?.why === 'stale') last.to = rec.t
      else this.gaps.push({ k: 'gap', from: this.prevSnapT, to: rec.t, why: 'stale' })
    }
    this.prevHealthy = healthy
    this.prevSnapT = rec.t
  }
}
