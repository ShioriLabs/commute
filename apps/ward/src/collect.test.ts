import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Collector, startCollector } from './collect.ts'

/*
 * The spike's fake-feed scenarios, against a local SSE server that behaves
 * like the relay: a `connected` event on join, a vehicles-gz snapshot, the
 * last snapshot replayed to new clients, and a close after each snapshot.
 */

type Behaviour = (res: http.ServerResponse, connection: number) => void

let dataDir: string
let server: http.Server
let collector: Collector | undefined
let behaviour: Behaviour
let connections = 0

const snapshotEvent = (body: string) => {
  const data = zlib.gzipSync(JSON.stringify({
    vehicles: [{ source: 'transjakarta', latitude: -6.2, longitude: 106.8, route_code: '1', bus_body_no: body, next_stops: 'H00132P-X', heading: 1, last_update_at: 1 }]
  })).toString('base64')
  return `data: ${JSON.stringify({ type: 'vehicles-gz', data })}\n\n`
}

const records = () => fs.readdirSync(dataDir)
  .filter(f => f.endsWith('.ndjson.gz'))
  .flatMap(f => execFileSync('zcat', [path.join(dataDir, f)]).toString().trim().split('\n'))
  .map(line => JSON.parse(line))

const until = async (check: () => boolean, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

// gapMs sits above the 250ms reconnect-after-data delay, as the real 90s sits
// above the relay's 30s cadence: an ordinary per-snapshot reconnect is no gap.
async function start(now: () => number = Date.now) {
  const port = (server.address() as AddressInfo).port
  collector = startCollector(
    { feedUrl: `http://127.0.0.1:${port}/`, dataDir, idleMs: 1_000, gapMs: 600, tickMs: 50 },
    { log: () => {}, now }
  )
}

beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ward-collect-'))
  connections = 0
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: {"type":"connected"}\n\n')
    behaviour(res, ++connections)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
})

afterEach(async () => {
  await collector?.stop()
  collector = undefined
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('collector', () => {
  it('treats the relay closing after each snapshot as normal: no gap, replays deduped', async () => {
    // Each connection: replay the previous snapshot, send a new one, close.
    behaviour = (res, n) => {
      if (n > 1) res.write(snapshotEvent(`bus-${n - 1}`))
      res.end(snapshotEvent(`bus-${n}`))
    }
    await start()
    await until(() => records().filter(r => r.k === 's').length >= 4)

    const all = records()
    expect(all[0]).toMatchObject({ k: 'start' })
    const bodies = all.filter(r => r.k === 's').map(r => r.v[0][0])
    expect(new Set(bodies).size).toBe(bodies.length) // no replayed duplicates
    expect(all.some(r => r.k === 'gap')).toBe(false)
  })

  it('reconnects a stream that goes silent and records the hole as a gap', async () => {
    // Connection 1 sends one snapshot then stalls without closing.
    behaviour = (res, n) => {
      if (n === 1) res.write(snapshotEvent('before-stall'))
      else res.end(snapshotEvent(`after-${n}`))
    }
    await start()
    await until(() => records().some(r => r.k === 'gap'))

    const gap = records().find(r => r.k === 'gap')
    expect(gap.why).toMatch(/idle/)
    expect(connections).toBeGreaterThan(1)
  })

  it('reconnects after a suspend (clock jump) even though the socket never errored', async () => {
    let offset = 0
    behaviour = (res, n) => {
      if (n === 1) res.write(snapshotEvent('before-sleep')) // held open, like a socket dead after suspend
      else res.end(snapshotEvent(`after-${n}`))
    }
    await start(() => Date.now() + offset)
    await until(() => records().some(r => r.k === 's'))
    offset = 60_000 // the laptop slept for a minute
    await until(() => records().some(r => r.k === 'gap'))

    expect(records().find(r => r.k === 'gap').why).toMatch(/clock jump/)
  })

  it('keeps retrying while the feed refuses connections', async () => {
    behaviour = (res) => {
      res.destroy()
    }
    await start()
    await until(() => connections >= 2, 5_000)
    behaviour = (res, n) => res.end(snapshotEvent(`back-${n}`))
    await until(() => records().some(r => r.k === 's'), 20_000)
  }, 30_000)

  it('stops promptly even while backing off', async () => {
    behaviour = (res) => {
      res.destroy()
    }
    await start()
    await until(() => connections >= 2)
    const stoppedAt = Date.now()
    await collector!.stop()
    collector = undefined
    expect(Date.now() - stoppedAt).toBeLessThan(1_000)
  })
})
