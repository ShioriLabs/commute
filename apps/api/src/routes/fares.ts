import { Hono } from 'hono'
import { Operator } from '@commute/constants'
import { Bindings } from 'app'
import { EdgeRepository } from 'db/repositories/edges'
import { KVRepository } from 'db/repositories/kv'
import { StationRepository } from 'db/repositories/stations'
import { FareResult, FareResultLeg } from 'models/fare'
import { summarizeFares } from 'utils/fare-summary'
import { getLineByOperator } from 'utils/line'
import { Internal, NotFound, Ok } from 'utils/response'
import { buildGraph, findRoute, RouteGraph } from 'utils/router'

const app = new Hono<{ Bindings: Bindings }>()

// Graph inputs only change with deploys/reseeds; cache the built graph per isolate.
let cachedGraph: RouteGraph | null = null
async function getGraph(d1: D1Database): Promise<RouteGraph> {
  if (cachedGraph) return cachedGraph
  const { edges, transfers } = await new EdgeRepository(d1).getGraphInputs()
  cachedGraph = buildGraph(edges, transfers)
  return cachedGraph
}

app.get('/:from/:to', async (c) => {
  const fromId = c.req.param('from')
  const toId = c.req.param('to')
  if (fromId === toId) {
    return c.json(NotFound('SAME_STATION', 'Origin and destination are the same station.'), 404)
  }

  const kvRepository = new KVRepository(c.env.KV)
  const kvKey = `fares:${fromId}:${toId}:${c.env.API_VERSION}`

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
    const legs = findRoute(graph, fromId, toId)
    if (!legs) {
      return c.json(NotFound('NO_ROUTE', 'No route between these stations.'), 404)
    }

    const summary = summarizeFares(legs)

    const stationIds = [...new Set(legs.flatMap(leg => [leg.fromStationId, leg.toStationId]))]
    const stations = await stationRepository.getByIds(stationIds)
    const name = (id: string) => {
      const station = stations.find(s => s.id === id)
      return station ? (station.formattedName || station.name) : id
    }
    const stationRef = (id: string) => ({ id, name: name(id) })

    const resultLegs: FareResultLeg[] = legs.map((leg) => {
      if (leg.type === 'TRANSFER') {
        return { type: 'TRANSFER', from: stationRef(leg.fromStationId), to: stationRef(leg.toStationId), distanceM: leg.distanceM }
      }
      const line = getLineByOperator(leg.operator as Operator, leg.lineCode)
      return {
        type: 'RIDE',
        lineCode: leg.lineCode,
        lineName: line?.name ?? leg.lineCode,
        lineColor: line?.colorCode ?? '#888888',
        operator: leg.operator,
        from: stationRef(leg.fromStationId),
        to: stationRef(leg.toStationId),
        stationCount: leg.stationIds.length,
        distanceM: leg.distanceM
      }
    })

    const result: FareResult = {
      from: stationRef(fromId),
      to: stationRef(toId),
      legs: resultLegs,
      segments: summary.segments.map(s => ({ ...s, fromName: name(s.fromStationId), toName: name(s.toStationId) })),
      totalFare: summary.totalFare,
      totalDistanceM: summary.totalDistanceM,
      transferCount: summary.transferCount
    }

    c.executionCtx.waitUntil(kvRepository.set(kvKey, result))

    return c.json(Ok(result), 200)
  } catch (error) {
    console.error(error)
    return c.json(Internal('DATABASE_ERROR', 'Can\'t connect to database, please try again later.'), 500)
  }
})

export default app
