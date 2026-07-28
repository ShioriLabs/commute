import { Hono } from 'hono'
import { Bindings } from 'app'
import { OPERATORS } from '@commute/constants'
import { Ok } from 'utils/response'
import { ALL_LINES } from 'utils/line'
import * as v from 'valibot'
import { doc } from 'schemas/describe'
import { OperatorWithLinesSchema } from '@commute/schemas'

const app = new Hono<{ Bindings: Bindings }>()

app.get(
  '/',
  doc({
    summary: 'List operators',
    description: 'Every transit operator, each with the lines it runs. A good first call — the codes here appear throughout the rest of the API.',
    tag: 'Operators',
    data: v.array(OperatorWithLinesSchema)
  }),
  async (c) => {
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
  }
)

export default app
