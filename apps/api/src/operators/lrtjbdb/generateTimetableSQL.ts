import * as fs from 'node:fs'
import * as readline from 'node:readline'

// Configuration
const currentPath = __dirname
const INPUT_CSV_PATH = `${currentPath}/input.csv`
const OUTPUT_SQL_PATH = `${currentPath}/output.sql`
const STATION_ID = 'LRTJBDB-RAS'
const BOUND_FOR = 'Dukuh Atas BNI'
const LINE_CODE = 'BK'
const ID_SUFFIX = 'DKA'

async function convertCSV() {
  const fileStream = fs.createReadStream(INPUT_CSV_PATH)
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  })

  const outputLines: string[] = []
  let counter = 1

  for await (const line of rl) {
    const hour = line.trim()
    if (!hour) continue

    const id = `${STATION_ID}-${LINE_CODE}-${counter}-${ID_SUFFIX}`
    const tripNumber = `${counter}`
    const timeWithSeconds = `${hour}:00`

    const formatted = `('${id}', '${STATION_ID}', '${tripNumber}', '${timeWithSeconds}', '${timeWithSeconds}', '${BOUND_FOR}', '${LINE_CODE}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    outputLines.push(formatted)
    counter++
  }

  if (outputLines.length === 0) {
    console.error('No valid time entries found in the input file.')
    return
  }

  const insertStatement = `INSERT INTO schedules (id, stationId, tripNumber, estimatedDeparture, estimatedArrival, boundFor, lineCode, createdAt, updatedAt) VALUES\n`
  const switchTimetableSynced = `UPDATE stations SET timetableSynced = 1 WHERE id = '${STATION_ID}';\n`
  const sqlContent = insertStatement + outputLines.join(',\n') + ';\n' + switchTimetableSynced

  fs.writeFileSync(OUTPUT_SQL_PATH, sqlContent)
  console.log(`SQL script successfully written to "${OUTPUT_SQL_PATH}".`)
}

convertCSV().catch((err) => {
  console.error('An error occurred during conversion:', err)
})
