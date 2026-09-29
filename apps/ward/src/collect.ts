#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'
import { type CollectConfig, collectConfig } from './config.ts'
import { hourFileName } from './days.ts'
import { createFrameParser, decodeEvent, toTuples } from './sse.ts'

/*
 * Long-running collector for the relay's TJ feed, hardened during a
 * one-day laptop spike that threw VPN switches, Wi-Fi drops, hibernation and
 * a desktop OOM at it.
 *
 * Output: WARD_DATA_DIR/snap-YYYYMMDD-HH.ndjson.gz (WIB hours), one gzip
 * member per line so an append is crash-safe (a kill loses at most the line
 * being written) and the file stays readable with plain `zcat`. Lines:
 *   {"k":"start","t":ms,"feed":url}                   process started
 *   {"k":"s","t":recvMs,"v":[VehicleTuple, ...]}      one relay snapshot
 *   {"k":"gap","from":ms,"to":ms,"why":"..."}         no snapshot for > gapMs
 *
 * The relay closes every stream after a snapshot or two (over HTTP/1.1 and
 * HTTP/2 alike), so a close after data is the normal cadence: reconnect almost
 * immediately and don't call it an outage. What IS an outage is time without a
 * snapshot, which is what `gap` records measure — independent of how many
 * reconnects it took.
 *
 * NOT detected here: the relay sending snapshots whose positions are stale
 * (its proxies drop TJ's messages). That is judged at analysis time from how
 * many vehicles' last_update_at moved; see analyzeObservedHeadways.ts in
 * apps/api.
 */

const DEFAULT_TICK_MS = 5_000
/** A tick arriving this late means the machine was suspended. */
const SLEEP_JUMP_MS = 20_000
const BACKOFF_START_MS = 1_000
/** Was 60s in the spike; a Wi-Fi drop then lost up to a minute after it recovered. */
const BACKOFF_CAP_MS = 15_000
/** Reconnect delay after a stream that delivered data (the normal per-snapshot close). */
const RECONNECT_AFTER_DATA_MS = 250
/** One log line per this many snapshots (~1h at the relay's 30s cadence). */
const SNAPSHOT_LOG_EVERY = 120

export interface CollectorDeps {
  log: (message: string) => void
  now: () => number
}

export interface Collector {
  /** Stops reconnecting, aborts the open stream, resolves when the loop has exited. */
  stop(): Promise<void>
}

const defaultDeps: CollectorDeps = {
  log: message => console.log(`${new Date().toISOString()} ${message}`),
  now: () => Date.now()
}

export function startCollector(config: CollectConfig, deps: CollectorDeps = defaultDeps): Collector {
  const { log, now } = deps
  fs.mkdirSync(config.dataDir, { recursive: true })

  const write = (record: object, atMs: number) => {
    fs.appendFileSync(path.join(config.dataDir, hourFileName(atMs)), zlib.gzipSync(JSON.stringify(record) + '\n'))
  }

  let stopped = false
  let controller: AbortController | null = null
  let backoff = BACKOFF_START_MS
  let lastEventAt = now()
  let lastTick = now()
  // Last moment a snapshot arrived; a later snapshot past gapMs closes a gap from here.
  let lastGoodAt: number | null = null
  let outageWhy: string | null = null
  let lastRaw: string | null = null
  let gotData = false
  let snapshots = 0

  const kick = (why: string) => {
    // One log line per outage, not one per 5s tick while it lasts.
    if (!outageWhy) {
      outageWhy = why
      log(`reconnecting: ${why}`)
    }
    controller?.abort(new Error(why))
  }

  const onPayload = (payload: string) => {
    const event = decodeEvent(payload)
    if (event.kind === 'connected') return
    if (event.kind === 'other') {
      log(`skip: event type ${event.type}`)
      return
    }
    gotData = true
    // The relay replays its last broadcast to every new client; after our
    // per-snapshot reconnect that is a byte-identical copy of what we have.
    if (event.raw === lastRaw) return
    lastRaw = event.raw

    const t = now()
    if (lastGoodAt !== null && t - lastGoodAt > config.gapMs) {
      const why = outageWhy ?? 'slow'
      write({ k: 'gap', from: lastGoodAt, to: t, why }, t)
      log(`gap closed: ${Math.round((t - lastGoodAt) / 1000)}s (${why})`)
    }
    outageWhy = null
    const v = toTuples(event.vehicles)
    write({ k: 's', t, v }, t)
    lastGoodAt = t
    backoff = BACKOFF_START_MS
    if (snapshots++ % SNAPSHOT_LOG_EVERY === 0) log(`snapshot #${snapshots}: ${v.length} vehicles`)
  }

  const tick = setInterval(() => {
    const t = now()
    // After a suspend, timers fire late; the tick gap is the tell even while
    // the dead TCP socket hasn't errored yet.
    if (t - lastTick > SLEEP_JUMP_MS) kick(`clock jump ${Math.round((t - lastTick) / 1000)}s (sleep/suspend?)`)
    else if (t - lastEventAt > config.idleMs) kick(`idle ${Math.round((t - lastEventAt) / 1000)}s`)
    lastTick = t
  }, config.tickMs ?? DEFAULT_TICK_MS)

  const connectOnce = async () => {
    controller = new AbortController()
    lastEventAt = now()
    gotData = false
    const res = await fetch(config.feedUrl, {
      headers: { 'accept': 'text/event-stream', 'cache-control': 'no-cache' },
      signal: controller.signal
    })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const parse = createFrameParser()
    const decoder = new TextDecoder()
    for await (const chunk of res.body) {
      lastEventAt = now()
      for (const payload of parse(decoder.decode(chunk, { stream: true }))) {
        try {
          onPayload(payload)
        } catch (err) {
          log(`bad event: ${(err as Error).message}`)
        }
      }
    }
    throw new Error('stream ended')
  }

  // Interruptible, so stop() doesn't wait out a 15s backoff.
  let wake: (() => void) | null = null
  const sleep = (ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    wake = () => {
      clearTimeout(timer)
      resolve()
    }
  })

  const loop = (async () => {
    write({ k: 'start', t: now(), feed: config.feedUrl }, now())
    log(`start: ${config.feedUrl} -> ${config.dataDir}`)
    while (!stopped) {
      try {
        await connectOnce()
      } catch (err) {
        if (stopped) break
        if (!gotData) {
          if (!outageWhy) outageWhy = (err as Error).message
          log(`disconnected: ${(err as Error).message}; retry in ${backoff / 1000}s`)
        }
      }
      if (stopped) break
      if (gotData) {
        await sleep(RECONNECT_AFTER_DATA_MS)
        continue
      }
      await sleep(backoff)
      backoff = Math.min(backoff * 2, BACKOFF_CAP_MS)
    }
  })()

  return {
    async stop() {
      stopped = true
      clearInterval(tick)
      controller?.abort(new Error('stopped'))
      wake?.()
      await loop
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const collector = startCollector(collectConfig())
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void collector.stop().then(() => process.exit(0))
    })
  }
}
