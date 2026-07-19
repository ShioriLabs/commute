import { db } from 'db'
import { TOPOLOGY } from 'db/data/topology'
import { Repository } from 'models/repository'

/*
 * The lineCodes the router is allowed to traverse: exactly the lines declared in
 * TOPOLOGY (rail + the BRT corridors). The `edges` table also holds ~3.5k edges
 * for non-BRT TransJakarta feeder/Mikrotrans lines that were imported but are NOT
 * in the topology — their haltes are already hidden (searchable=0), but their
 * edges would otherwise pollute routing, letting a one-seat BRT ride fragment
 * across overlapping feeder corridors (e.g. Blok M→Kota splitting into 1+1A+3H).
 * The premium-fare Soekarno-Hatta line A is in TOPOLOGY but never routed in v1,
 * so it's excluded here too.
 */
const ROUTABLE_LINE_CODES = [...new Set(TOPOLOGY.map(t => t.lineCode))].filter(code => code !== 'A')

export class EdgeRepository extends Repository {
  private d1: D1Database

  constructor(d1: D1Database) {
    super()
    this.d1 = d1
  }

  /*
   * Everything the fare router needs: ride edges on routable (topology-declared)
   * lines and walkable INTERNAL transfers.
   */
  async getGraphInputs() {
    const [edges, transfers] = await Promise.all([
      db(this.d1).selectFrom('edges').selectAll().where('lineCode', 'in', ROUTABLE_LINE_CODES).execute(),
      db(this.d1).selectFrom('transfers').selectAll().where('dataType', '=', 'INTERNAL').execute()
    ])
    return { edges, transfers }
  }
}
