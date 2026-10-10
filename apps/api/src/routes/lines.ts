import { Hono } from 'hono'
import { StationRepository } from 'db/repositories/stations'
import { NotFound, UnknownOperator } from 'utils/response'
import { readThrough } from 'utils/read-through'
import { Bindings } from 'app'
import { getOperatorByCode } from 'utils/operator'
import { getLineByOperator } from 'utils/line'
import { buildLineDetail, collectStationIds, findTopology } from 'utils/topology'
import { mapify } from 'utils/mapify'
import { doc, operatorParam, pathParam } from 'schemas/describe'
import { LineDetailSchema } from '@commute/schemas'

const app = new Hono<{ Bindings: Bindings }>()

app.get(
  '/:operator/:lineCode',
  doc({
    summary: 'Detail lin',
    description: 'Struktur lengkap satu lin, urut dari stasiun awal. Lin yang lurus cuma punya satu segmen `TRUNK`. Lin yang bercabang seperti loop Cikarang atau ramp Nambo punya segmen tambahan yang menunjukkan di mana cabangnya berpisah dan menyatu lagi.',
    tag: 'Lin',
    data: LineDetailSchema,
    parameters: [operatorParam, pathParam('lineCode', 'Kode lin, bisa diambil dari `/operators`.', 'C')],
    errors: {
      404: 'Operator atau lin-nya tidak ditemukan, atau lin-nya belum punya data topologi (`NO_TOPOLOGY`).'
    }
  }),
  async (c) => {
    const operatorCode = c.req.param('operator')
    const lineCode = c.req.param('lineCode')

    const operator = getOperatorByCode(operatorCode)
    if (!operator) {
      return c.json(UnknownOperator(operatorCode), 404)
    }

    const line = getLineByOperator(operator.code, lineCode)
    if (!line) {
      return c.json(NotFound('UNKNOWN_LINE', `Unknown Line Code: ${operator.code}:${lineCode}`), 404)
    }

    const topology = findTopology(operator.code, lineCode)
    if (!topology) {
      return c.json(NotFound('NO_TOPOLOGY', `No topology data for line ${operator.code}:${lineCode}`), 404)
    }

    const stationRepository = new StationRepository(c.env.DB)

    return readThrough(c, `lines:${operator.code}-${lineCode}:${c.env.API_VERSION}`, async () => {
      const stations = await stationRepository.getByIds(collectStationIds(topology))
      const stationsById = mapify(stations, station => station.id)

      return buildLineDetail(topology, line, operator, stationsById)
    })
  }
)

export default app
