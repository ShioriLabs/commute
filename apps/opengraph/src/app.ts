import { Operator, OPERATORS } from '@commute/constants'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

export interface Bindings {
  API_URL: string
}

import type { StatusCode } from 'hono/utils/http-status'

interface StandardResponse<T = unknown> {
  status: StatusCode
  data?: T
  error?: {
    message: string
    code: string
  }
}

interface Station {
  id: string
  name: string
  formattedName: string | null
}

export function getOperatorByCode(code: string): typeof OPERATORS[Operator] | null {
  return OPERATORS[code as Operator] ?? null
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors({
  origin(origin) {
    if (
      origin === 'http://localhost:3000'
      || origin === 'http://localhost:5173'
      || origin === 'https://commute.shiorilabs.id'
      || origin === 'https://dev.commute.shiorilabs.id'
    ) {
      return origin
    }

    return null
  },
  allowMethods: ['GET', 'POST', 'OPTIONS']
}))

app.get('/fare/:station-pair', async (ctx) => {
  const [fromStationOperator, fromStationCode, toStationOperator, toStationCode] = (ctx.req.param('station-pair') ?? '').split(/-/g)

  if (
    !fromStationOperator || getOperatorByCode(fromStationOperator) === null
    || !fromStationCode
    || !toStationOperator || getOperatorByCode(toStationOperator) === null
    || !toStationCode
  ) {
    return ctx.text('Invalid station codes', 400)
  }

  const [fromStationResponse, toStationResponse] = await Promise.allSettled([
    fetch(new URL(`/stations/${fromStationOperator}/${fromStationCode}`, ctx.env.API_URL).href),
    fetch(new URL(`/stations/${toStationOperator}/${toStationCode}`, ctx.env.API_URL).href)
  ])

  if (fromStationResponse.status === 'rejected' || toStationResponse.status === 'rejected' || !fromStationResponse.value.ok || !toStationResponse.value.ok) {
    return ctx.text('Internal server error', 500)
  }

  const fromStationJSON = await fromStationResponse.value.json<StandardResponse<Station>>()
  const toStationJSON = await toStationResponse.value.json<StandardResponse<Station>>()

  if (fromStationJSON.error || toStationJSON.error) {
    return ctx.text('Internal server error', 500)
  }

  return ctx.json({
    from: fromStationJSON.data,
    to: toStationJSON.data
  })
})

export default app
