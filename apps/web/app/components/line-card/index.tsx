import type { LineTimetable, Schedule } from 'models/schedules'

function getNextSchedules(schedules: Schedule[], limit = 3) {
  const now = new Date()
  const returning: Schedule[] = []
  for (const schedule of schedules) {
    if (returning.length === limit) break
    const parsedDeparture = new Date(`${now.toDateString()} ${schedule.estimatedDeparture}`)
    if (parsedDeparture < now) continue
    returning.push(schedule)
  }

  return returning
}

function parseTime(timeString: string) {
  return new Date(`${new Date().toDateString()} ${timeString}`)
}

function tintHex(hex: string, tintFactor = 0.2, towards: 'light' | 'dark' = 'light') {
  hex = hex.replace(/^#/, "")

  let r = parseInt(hex.substring(0, 2), 16)
  let g = parseInt(hex.substring(2, 4), 16)
  let b = parseInt(hex.substring(4, 6), 16)

  const target = towards === 'light' ? 255 : 128

  r = Math.round(r * tintFactor + target * (1 - tintFactor))
  g = Math.round(g * tintFactor + target * (1 - tintFactor))
  b = Math.round(b * tintFactor + target * (1 - tintFactor))

  return "#" + [r, g, b].map(x =>
    x.toString(16).padStart(2, "0")
  ).join("")
}

interface Props {
  line: LineTimetable
}

export default function LineCard({ line }: Props) {
  const nextSchedulesFilteredTimetable = line.timetable.map(direction => {
    return {
      boundFor: direction.boundFor,
      schedules: getNextSchedules(direction.schedules)
    }
  }).filter(direction => direction.schedules.length > 0)

  if (nextSchedulesFilteredTimetable.length === 0) return null;

  return (
    <li className="rounded-lg w-full min-h-8 shadow-lg border-t-[16px] border-gray-100" style={{ borderTopColor: line.colorCode, backgroundColor: tintHex(line.colorCode, 0.065) }}>
      <article className="p-4 border-b-2" style={{ borderBottomColor: tintHex(line.colorCode, 0.3) }}>
        <h1 className="font-bold text-xl">{line.name}</h1>
      </article>
      <ul>
        {nextSchedulesFilteredTimetable.map(direction => {
          return (
            <li key={direction.boundFor} className="p-4 flex items-start justify-between border-t first:border-t-0" style={{ borderTopColor: tintHex(line.colorCode, 0.3) }}>
              <div>
                <span className="font-semibold">{direction.boundFor}</span>
              </div>
              <div className="text-right flex flex-col">
                <span className="font-bold">{parseTime(direction.schedules[0].estimatedDeparture).toLocaleTimeString('id-ID', { timeStyle: 'short' })}</span>
                {direction.schedules.length > 1 ? (
                  <span className="font-semibold text-sm text-gray-600">lalu {direction.schedules.slice(1, 3).map(sched => parseTime(sched.estimatedDeparture).toLocaleTimeString('id-ID', { timeStyle: 'short' })).join(', ')}</span>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </li>
  )
}
