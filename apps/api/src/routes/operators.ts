import { Hono } from 'hono'
import { Bindings } from 'app'
import { OPERATORS } from '@commute/constants'
import { Ok } from 'utils/response'
import { ALL_LINES } from 'utils/line'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', async (c) => {
  const operators = Object.values(OPERATORS)
    .filter(op => op.code !== 'NUL')
    .map((op) => {
      return {
        ...op,
        lines: ALL_LINES[op.code]
      }
    })

  return c.json(
    Ok(operators),
    200
  )
})

export default app
