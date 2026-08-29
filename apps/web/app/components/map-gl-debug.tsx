import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { Renderer } from '../lib/map-renderer'
import type { RecoveryState } from '../lib/map-context-recovery'

// Instrumentation for the map's GPU memory and context-loss handling.
//
// Gated behind the same 7-tap gesture that unlocks the map itself (see
// isMapGlDebugEnabled in hooks/secret-features.ts) rather than a query param:
// this only reproduces in the installed PWA, which runs without an address bar,
// so `?debug=…` is unreachable exactly where it's needed. Context loss
// otherwise takes half an hour of real memory pressure to trigger.
export interface MapGlDebugApi {
  // Force the context loss the recovery path exists for. This is the whole
  // point of the hatch: WEBGL_lose_context reproduces in one call what
  // otherwise needs a backgrounded phone under memory pressure.
  lose(): void
  restore(): void
  isLost(): boolean
  // Run the release-on-hide path without actually backgrounding the app.
  releaseTiles(): void
  // The rendered transform. The camera lives in refs, so this is the only
  // scripted way to observe flights or map world→screen coordinates.
  camera(): { tx: number, ty: number, scale: number }
  stats(): {
    kind: Renderer['kind'] | null
    count: number
    bytes: number
    megabytes: number
    epoch: number
    recovery: RecoveryState
    attempts: number
    contextLost: boolean
    // Tile loads queued, and decoded tiles waiting on an upload slot. Watch
    // these through a pinch to tune the pacing: a queue that stays deep means
    // the limits are too tight for the device.
    queued: number
    ready: number
    // Cumulative ms in texImage2D + generateMipmap.
    uploadMs: number
    // 95th percentile of the last few seconds of rAF intervals, in ms. The
    // number a paced upload is supposed to protect: the mean hides a single
    // 200 ms stall, the p95 does not.
    frameP95: number
  }
}

// Publishes the API on `window` so it's reachable over chrome://inspect against
// an installed PWA, where there's no other way in.
export function useMapGlDebugApi(enabled: boolean, api: MapGlDebugApi) {
  useEffect(() => {
    if (!enabled) return
    const target = window as unknown as { __mapDebug?: MapGlDebugApi }
    target.__mapDebug = api
    return () => {
      delete target.__mapDebug
    }
  }, [enabled, api])
}

interface PanelProps {
  api: MapGlDebugApi
}

// On-screen twin of the console API, for verifying on a phone with no laptop
// attached — DevTools has no usable GPU-memory readout, and
// performance.measureUserAgentSpecificMemory() needs cross-origin isolation
// this app doesn't have. The renderer's own byte count is exact for the tiles,
// which are the part that matters.
export function MapGlDebugPanel({ api }: PanelProps) {
  const [stats, setStats] = useState(() => api.stats())

  useEffect(() => {
    const id = window.setInterval(() => setStats(api.stats()), 500)
    return () => window.clearInterval(id)
  }, [api])

  const recoveryLabel = stats.attempts > 0
    ? `${stats.recovery} ×${stats.attempts}`
    : stats.recovery

  return (
    <div className="absolute bottom-20 left-4 z-detail-surface rounded-lg bg-slate-900/85 text-white text-xs font-mono p-3 backdrop-blur pointer-events-auto select-none">
      <div className="flex gap-3">
        <span>{stats.kind ?? '—'}</span>
        <span>{`${stats.count} tiles`}</span>
        <span>{`${stats.megabytes.toFixed(0)} MiB`}</span>
      </div>
      <div className="mt-1 flex gap-3 text-slate-400">
        {/* Amber past ~33 ms: two frames' budget, i.e. a visible hitch. */}
        <span className={clsx(stats.frameP95 > 33 && 'text-amber-300')}>
          {`p95 ${stats.frameP95.toFixed(1)}ms`}
        </span>
        <span>{`up ${stats.uploadMs.toFixed(0)}ms`}</span>
        <span>{`q ${stats.queued}/${stats.ready}`}</span>
      </div>
      <div className="mt-1 flex gap-3 text-slate-400">
        <span>{`epoch ${stats.epoch}`}</span>
        <span className={clsx(stats.recovery !== 'idle' && 'text-amber-300')}>
          {recoveryLabel}
        </span>
        <span className={clsx(stats.contextLost && 'text-rose-400')}>
          {stats.contextLost ? 'lost' : 'ok'}
        </span>
      </div>
      <div className="mt-2 flex gap-2">
        <DebugButton onClick={() => api.lose()}>Lose</DebugButton>
        <DebugButton onClick={() => api.releaseTiles()}>Release</DebugButton>
      </div>
    </div>
  )
}

function DebugButton({ onClick, children }: { onClick: () => void, children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 cursor-pointer"
    >
      {children}
    </button>
  )
}
