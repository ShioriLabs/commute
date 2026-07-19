import { Hono } from 'hono'
import { FareContext, Operator, PAYMENT_METHODS, PaymentMethod } from '@commute/constants'
import { Bindings } from 'app'
import { EdgeRepository } from 'db/repositories/edges'
import { KVRepository } from 'db/repositories/kv'
import { StationRepository } from 'db/repositories/stations'
import { FareResult, FareResultLeg, FareResultLineRef } from 'models/fare'
import { calculateTransferFare, fareTimeBucket, resolveCorridorMerges } from 'utils/fare'
import { summarizeFares } from 'utils/fare-summary'
import { computeHeadsignCode } from 'utils/headsign'
import { findInterliningLineCodes, mergeInterlinedLegs } from 'utils/interlining'
import { getLineByOperator } from 'utils/line'
import { Internal, NotFound, Ok } from 'utils/response'
import { ENDPOINT_RESTRICTIONS } from 'db/data/topology'
import { buildGraph, findRoute, RouteGraph } from 'utils/router'

const app = new Hono<{ Bindings: Bindings }>()

// Graph inputs only change with deploys/reseeds; cache the built graph per isolate.
let cachedGraph: RouteGraph | null = null
async function getGraph(d1: D1Database): Promise<RouteGraph> {
  if (cachedGraph) return cachedGraph
  const { edges, transfers } = await new EdgeRepository(d1).getGraphInputs()
  // Topology restrictions are authored in (operator, station) codes; the graph
  // works in `${operator}-${station}` DB ids.
  const restrictions = ENDPOINT_RESTRICTIONS.map(r => ({
    stationId: `${r.operator}-${r.station}`,
    forbiddenNeighborId: `${r.operator}-${r.forbiddenNeighbor}`
  }))
  cachedGraph = buildGraph(edges, transfers, restrictions)
  return cachedGraph
}

// Resolve the fare context from optional query params, defaulting to today's
// behaviour: single-tap stored value, departing now. Unknown/malformed values
// fall back to the defaults rather than erroring.
export function parseFareContext(paymentMethodRaw?: string, atRaw?: string): FareContext {
  const paymentMethod: PaymentMethod
    = paymentMethodRaw && paymentMethodRaw in PAYMENT_METHODS
      ? paymentMethodRaw as PaymentMethod
      : 'STORED_VALUE'
  const parsed = atRaw ? new Date(atRaw) : null
  const departureAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date()
  return { paymentMethod, departureAt }
}

// Fare depends on payment method + time bucket; key on both so peak/off-peak
// and integrated fares (steps 2 & 4) can't be served a stale cached body.
export function fareCacheKey(fromId: string, toId: string, context: FareContext, apiVersion: string): string {
  return `fares:${fromId}:${toId}:${context.paymentMethod}:${fareTimeBucket(context.departureAt)}:${apiVersion}`
}

app.get('/:from/:to', async (c) => {
  const fromId = c.req.param('from')
  const toId = c.req.param('to')
  if (fromId === toId) {
    return c.json(NotFound('SAME_STATION', 'Origin and destination are the same station.'), 404)
  }

  const context = parseFareContext(c.req.query('paymentMethod'), c.req.query('at'))

  const kvRepository = new KVRepository(c.env.KV)
  const kvKey = fareCacheKey(fromId, toId, context, c.env.API_VERSION)

  const cached = await kvRepository.get<FareResult>(kvKey)
  if (cached) {
    return c.json(Ok(cached), 200)
  }

  const stationRepository = new StationRepository(c.env.DB)

  try {
    const endpoints = await stationRepository.getByIds([fromId, toId])
    if (endpoints.length < 2) {
      return c.json(NotFound('UNKNOWN_STATION', 'One or both stations do not exist.'), 404)
    }

    const graph = await getGraph(c.env.DB)
    const rawLegs = findRoute(graph, fromId, toId)
    if (!rawLegs) {
      return c.json(NotFound('NO_ROUTE', 'No route between these stations.'), 404)
    }
    // Collapse phantom line changes at interlined trunk nodes into one-seat legs.
    const legs = mergeInterlinedLegs(rawLegs)

    const summary = summarizeFares(legs, context)

    // Fold a surcharged corridor crossing + its chained free walk into one
    // display leg (adds the uncounted internal-peron walk). Fares/segments are
    // untouched — this is display + reported distance only.
    const corridorMerges = resolveCorridorMerges(legs, context)

    // Station ids are `${operator}-${topologyCode}`; the headsign walk works
    // in topology codes, so strip/re-add the operator prefix around it.
    type HeadsignRef = { terminusId: string, viaId: string | null }
    const headsignRef = (operator: string, headsign: { code: string, viaCode: string | null } | null): HeadsignRef | null =>
      headsign
        ? { terminusId: `${operator}-${headsign.code}`, viaId: headsign.viaCode ? `${operator}-${headsign.viaCode}` : null }
        : null

    // Per RIDE leg, the service line(s) that run it, each with its own headsign.
    // A leg on interlined track (the LRT Jabodebek DKA..CWG trunk) is served by
    // several lines in topology order; an ordinary leg carries just its own line.
    const legLines = legs.map((leg) => {
      if (leg.type !== 'RIDE') return null
      const operator = leg.operator as Operator
      const codes = leg.stationIds.map(id => id.slice(operator.length + 1))
      const interlining = findInterliningLineCodes(operator, codes)
      const lineCodes = interlining.length >= 2 ? interlining : [leg.lineCode]
      return {
        interlined: interlining.length >= 2,
        lines: lineCodes.map(lineCode => ({
          lineCode,
          headsign: headsignRef(operator, computeHeadsignCode(operator, lineCode, codes))
        }))
      }
    })

    const stationIds = [...new Set([
      ...legs.flatMap(leg => leg.type === 'RIDE' ? leg.stationIds : [leg.fromStationId, leg.toStationId]),
      ...legLines.flatMap(meta => meta
        ? meta.lines.flatMap(l => l.headsign ? [l.headsign.terminusId, ...(l.headsign.viaId ? [l.headsign.viaId] : [])] : [])
        : [])
    ])]
    const stations = await stationRepository.getByIds(stationIds)
    const name = (id: string) => {
      const station = stations.find(s => s.id === id)
      return station ? (station.formattedName || station.name) : id
    }
    const stationRef = (id: string) => ({ id, name: name(id) })
    const known = (id: string | null): id is string => id !== null && stations.some(s => s.id === id)
    // A terminus missing from the DB would echo its raw id; omit instead.
    const headsignName = (h: HeadsignRef | null): string | null =>
      h && known(h.terminusId)
        ? (known(h.viaId) ? `${name(h.terminusId)} via ${name(h.viaId)}` : name(h.terminusId))
        : null

    const resultLegs: FareResultLeg[] = legs.flatMap((leg, index): FareResultLeg[] => {
      if (leg.type === 'TRANSFER') {
        const merge = corridorMerges.get(index)
        if (merge?.kind === 'ABSORBED') return [] // folded into the anchor leg
        if (merge?.kind === 'MERGE_ANCHOR') {
          return [{
            type: 'TRANSFER',
            from: stationRef(merge.fromStationId),
            to: stationRef(merge.toStationId),
            distanceM: merge.distanceM,
            fare: merge.fare,
            corridorLabel: merge.corridor.label
          }]
        }
        const surcharge = calculateTransferFare(leg.fromStationId, leg.toStationId, context, {
          prev: legs[index - 1],
          next: legs[index + 1]
        })
        return [{
          type: 'TRANSFER',
          from: stationRef(leg.fromStationId),
          to: stationRef(leg.toStationId),
          distanceM: leg.distanceM,
          ...(surcharge ? { fare: surcharge.fare, corridorLabel: surcharge.corridor.label } : {})
        }]
      }
      const meta = legLines[index]!
      const serviceLines: FareResultLineRef[] = meta.lines.map((l) => {
        const line = getLineByOperator(leg.operator as Operator, l.lineCode)
        return {
          lineCode: l.lineCode,
          lineName: line?.name ?? l.lineCode,
          lineColor: line?.colorCode ?? '#888888',
          headsign: headsignName(l.headsign)
        }
      })
      // On interlined track the router's line pick is arbitrary; present the
      // first topology-ordered service line as the primary for a stable badge.
      const primary = serviceLines[0]!
      return [{
        type: 'RIDE',
        lineCode: primary.lineCode,
        lineName: primary.lineName,
        lineColor: primary.lineColor,
        operator: leg.operator,
        from: stationRef(leg.fromStationId),
        to: stationRef(leg.toStationId),
        stationCount: leg.stationIds.length,
        stops: leg.stationIds.map(stationRef),
        headsign: primary.headsign,
        distanceM: leg.distanceM,
        ...(meta.interlined ? { serviceLines } : {})
      }]
    })

    // summary.totalDistanceM already counts both raw legs of each merge; the only
    // uncounted distance is the internal-peron walk baked into each anchor.
    const internalWalkExtra = [...corridorMerges.values()].reduce(
      (sum, m) => sum + (m.kind === 'MERGE_ANCHOR' ? (m.corridor.internalWalkM ?? 0) : 0),
      0
    )
    // Each merge folds two transfers into one visible interchange, so the
    // rider-facing count drops by one per absorbed leg.
    const absorbedCount = [...corridorMerges.values()].filter(m => m.kind === 'ABSORBED').length

    const result: FareResult = {
      from: stationRef(fromId),
      to: stationRef(toId),
      legs: resultLegs,
      segments: summary.segments.map(s => ({ ...s, fromName: name(s.fromStationId), toName: name(s.toStationId) })),
      totalFare: summary.totalFare,
      totalDistanceM: summary.totalDistanceM + internalWalkExtra,
      transferCount: summary.transferCount - absorbedCount
    }

    c.executionCtx.waitUntil(kvRepository.set(kvKey, result))

    return c.json(Ok(result), 200)
  } catch (error) {
    console.error(error)
    return c.json(Internal('DATABASE_ERROR', 'Can\'t connect to database, please try again later.'), 500)
  }
})

export default app
