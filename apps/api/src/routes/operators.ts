import { Hono } from 'hono'
import { Bindings } from 'app'
import { OPERATORS } from '@commute/constants'
import { Ok } from 'utils/response'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', async (c) => {
  const operators = Object.values(OPERATORS)
    .filter(op => op.code !== 'NUL')

  return c.json(
    Ok(operators),
    200
  )
})

export default app
