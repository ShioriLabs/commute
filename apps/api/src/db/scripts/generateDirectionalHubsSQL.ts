import { writeFileSync } from 'node:fs'
import { getPlatformProxy } from 'wrangler'
import { HubRepository } from 'db/repositories/hubs'
import { StationRepository } from 'db/repositories/stations'
import { directionalBaseName, directionalGroupKey } from 'utils/searchables'

/*
 * TransJakarta "Arah" halte pairs -> `directional` hubs (tj_directional_hubs.sql).
 *
 * The feed splits 15 haltes into one `stations` row per direction of travel
 * ("Kali Grogol Arah Utara" / "Arah Selatan", 32–168 m apart). To a rider each
 * pair is one halte, so routing treats it as one place (utils/places.ts) and
 * the hub sheet shows it as one halte with a direction toggle. Crossing sides
 * needs a tap-out, which is why this is its own kind and not `integrated`.
 *
 * Generated from LOCAL D1, not from the GTFS feed like generateTJSQL: it has to
 * see the existing hubs to skip pairs an `integrated` hub already holds
 * (Ciliwung, Pancoran), where a second hub would only duplicate the place.
 * Nesting inside a `hub`-kind complex is fine (Cikoko in Cawang).
 *
 * TJ only splits a halte by direction when crossing sides needs a tap-out.
 * Physically split haltes WITH a connector (Simpang Kuningan, Grogol Reformasi,
 * Pecenongan) stay one `P` row in the feed. So the split itself is the tap-out
 * signal, and a pair that gains a connector would collapse to one row: the
 * output therefore deletes every `directional` hub before re-inserting, so a
 * vanished pair does not linger as an empty hub.
 *
 * Grouping is directionalGroupKey, the same fold search uses, so the two can
 * never disagree on what a pair is. Gambir / Gambir 2 and Puri Beta 1 / 2 are
 * NOT pairs (separate locations) and the key does not match them.
 *
 * Run after a TJ feed refresh is applied, then apply the output:
 *
 *   pnpm --filter api generate:tj-directional-hubs
 *   wrangler d1 execute commute --local --file=src/db/scripts/tj_directional_hubs.sql
 *
 * generate:route-snapshot refuses to run while any pair is not one place.
 */
const OUTPUT_PATH = `${__dirname}/tj_directional_hubs.sql`

const esc = (value: string) => value.replace(/'/g, '\'\'')
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

async function main() {
  const { env, dispose } = await getPlatformProxy<{ DB: D1Database }>({ persist: true })
  try {
    const [stations, hubs] = await Promise.all([
      new StationRepository(env.DB).getAll(),
      new HubRepository(env.DB).getAllIncludingDirectional()
    ])

    const inIntegratedHub = new Set(hubs.filter(hub => hub.kind === 'integrated').flatMap(hub => hub.members.map(m => m.id)))
    // A re-run replaces its own rows, so only other kinds can collide.
    const takenSlugs = new Set(hubs.filter(hub => hub.kind !== 'directional').map(hub => hub.slug))

    const groups = new Map<string, typeof stations>()
    for (const station of stations) {
      const key = directionalGroupKey(station)
      if (key.startsWith('id:')) continue
      groups.set(key, [...groups.get(key) ?? [], station])
    }

    const rows: string[] = []
    const skipped: string[] = []
    let hubCount = 0
    for (const [key, unsorted] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (unsorted.length !== 2) {
        throw new Error(`${key}: expected exactly 2 Arah haltes, found ${unsorted.length} (${unsorted.map(s => s.id).join(', ')})`)
      }
      const members = unsorted.slice().sort((a, b) => a.code.localeCompare(b.code))
      const [first] = members as [typeof members[number]]
      const name = directionalBaseName(first.officialName)

      if (members.some(m => inIntegratedHub.has(m.id))) {
        skipped.push(name)
        continue
      }

      const slug = slugify(name)
      if (takenSlugs.has(slug)) throw new Error(`${key}: slug '${slug}' already belongs to another hub`)
      takenSlugs.add(slug)

      const id = `HUB-${first.operator}-${first.code.replace(/S$/, '')}`
      const located = members.filter(m => m.latitude != null && m.longitude != null)
      const mean = (pick: (m: typeof members[number]) => number) =>
        located.length > 0 ? (located.reduce((sum, m) => sum + pick(m), 0) / located.length).toFixed(6) : 'NULL'
      // A hub is as prominent as its most prominent member (generateStationScoresSQL).
      const score = Math.max(...members.map(m => m.score))

      rows.push(
        `-- ${id}: ${members.map(m => m.officialName).join(' / ')}`,
        `INSERT OR REPLACE INTO hubs (id, slug, name, kind, description, heroImage, latitude, longitude, score, createdAt, updatedAt) VALUES ('${id}', '${slug}', '${esc(name)}', 'directional', NULL, NULL, ${mean(m => m.latitude!)}, ${mean(m => m.longitude!)}, ${score}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
        ...members.map((m, position) =>
          `INSERT OR REPLACE INTO hubStations (id, hubId, stationId, position, createdAt, updatedAt) VALUES ('${id}:${m.id}', '${id}', '${m.id}', ${position}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`
        ),
        ''
      )
      hubCount++
    }

    const header = [
      '-- GENERATED by db/scripts/generateDirectionalHubsSQL.ts from local D1. Do not edit;',
      '-- re-run after a TJ feed refresh. TJ "Arah" halte pairs as `directional` hubs.',
      `-- Skipped (already in an integrated hub): ${skipped.join(', ') || 'none'}`,
      '',
      '-- Full replace: a pair that gained a connector is one feed row now and must not linger.',
      'DELETE FROM hubStations WHERE hubId IN (SELECT id FROM hubs WHERE kind = \'directional\');',
      'DELETE FROM hubs WHERE kind = \'directional\';',
      ''
    ]
    writeFileSync(OUTPUT_PATH, [...header, ...rows].join('\n'))
    console.log(`Wrote ${hubCount} directional hubs to ${OUTPUT_PATH}; skipped ${skipped.length} (${skipped.join(', ')})`)
  } finally {
    await dispose()
  }
}

void main()
