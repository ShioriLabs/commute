import { db } from 'db'
import { Repository } from 'models/repository'

export class EdgeRepository extends Repository {
  private d1: D1Database

  constructor(d1: D1Database) {
    super()
    this.d1 = d1
  }

  /*
   * Everything the fare router needs: ride edges (minus the premium-fare
   * Basoetta line A, which v1 never routes) and walkable INTERNAL transfers.
   */
  async getGraphInputs() {
    const [edges, transfers] = await Promise.all([
      db(this.d1).selectFrom('edges').selectAll().where('lineCode', '!=', 'A').execute(),
      db(this.d1).selectFrom('transfers').selectAll().where('dataType', '=', 'INTERNAL').execute()
    ])
    return { edges, transfers }
  }
}
