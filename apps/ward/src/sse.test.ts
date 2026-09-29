import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { type RelayVehicle, createFrameParser, decodeEvent, toTuples } from './sse.ts'

const vehicle = (overrides: Partial<RelayVehicle> = {}): RelayVehicle => ({
  source: 'transjakarta',
  latitude: -6.2,
  longitude: 106.8,
  route_code: '1',
  bus_body_no: 'MYS-17020',
  next_stops: 'H00132P-Museum Sejarah Jakarta',
  heading: 163,
  last_update_at: 1790656772465,
  ...overrides
})

const vehiclesEvent = (vehicles: RelayVehicle[]) => JSON.stringify({
  type: 'vehicles-gz',
  data: zlib.gzipSync(JSON.stringify({ vehicles })).toString('base64')
})

describe('createFrameParser', () => {
  it('splits LF and CRLF frames', () => {
    const parse = createFrameParser()
    expect(parse('data: a\n\ndata: b\r\n\r\n')).toEqual(['a', 'b'])
  })

  it('holds a frame split across chunks until it completes', () => {
    const parse = createFrameParser()
    expect(parse('data: {"type":"conn')).toEqual([])
    expect(parse('ected"}\n')).toEqual([])
    expect(parse('\n')).toEqual(['{"type":"connected"}'])
  })

  it('joins multi-line data and ignores other fields', () => {
    const parse = createFrameParser()
    expect(parse('event: x\ndata: one\ndata: two\nid: 3\n\n')).toEqual(['one\ntwo'])
  })

  it('drops frames without data (comments, heartbeats)', () => {
    const parse = createFrameParser()
    expect(parse(': ping\n\ndata: x\n\n')).toEqual(['x'])
  })
})

describe('decodeEvent', () => {
  it('recognises the join message', () => {
    expect(decodeEvent('{"type":"connected"}')).toEqual({ kind: 'connected' })
  })

  it('gunzips a vehicles-gz snapshot', () => {
    const event = decodeEvent(vehiclesEvent([vehicle()]))
    expect(event.kind).toBe('vehicles')
    if (event.kind === 'vehicles') expect(event.vehicles).toHaveLength(1)
  })

  it('rejects a snapshot without vehicles[]', () => {
    const payload = JSON.stringify({ type: 'vehicles-gz', data: zlib.gzipSync('{}').toString('base64') })
    expect(() => decodeEvent(payload)).toThrow(/vehicles/)
  })

  it('passes unknown event types through', () => {
    expect(decodeEvent('{"type":"train-gz"}')).toEqual({ kind: 'other', type: 'train-gz' })
  })
})

describe('toTuples', () => {
  it('keeps the spike-compatible tuple order', () => {
    expect(toTuples([vehicle()])).toEqual([
      ['MYS-17020', '1', 'H00132P-Museum Sejarah Jakarta', -6.2, 106.8, 163, 1790656772465]
    ])
  })

  it('drops other cities if the relay ever bundles them again', () => {
    expect(toTuples([vehicle(), vehicle({ source: 'transsemarang' })])).toHaveLength(1)
  })
})
