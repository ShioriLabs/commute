import * as fs from 'node:fs'
import * as readline from 'node:readline'

// Configuration
const currentPath = __dirname
const INPUT_CSV_PATH = `${currentPath}/stations_lat_lng.csv`
const OUTPUT_SQL_PATH = `${currentPath}/stations_lat_lng.sql`

async function convertCSV() {
  const fileStream = fs.createReadStream(INPUT_CSV_PATH)
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  })

  const outputLines: string[] = []

  for await (const line of rl) {
    const [id, lat, lng] = line.trim().split(/,/g)
    if (!id || !lat || !lng) continue
    if (id === 'id') continue

    outputLines.push(`UPDATE stations SET latitude = ${lat}, longitude = ${lng}, updatedAt = CURRENT_TIMESTAMP where id = '${id}';`)
  }

  const sqlContent = outputLines.join('\n')

  fs.writeFileSync(OUTPUT_SQL_PATH, sqlContent)
  console.log(`SQL script successfully written to "${OUTPUT_SQL_PATH}".`)
}

convertCSV().catch((err) => {
  console.error('An error occurred during conversion:', err)
})
