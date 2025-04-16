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

interface Props {
  line: LineTimetable
}

export default function LineCard({ line }: Props) {
  return (
    <li className="rounded-lg w-full min-h-8 shadow-lg border-t-[16px] border-gray-100" style={{ borderTopColor: line.colorCode }}>
      <article className="p-4">
        <h1 className="font-bold text-xl">{line.name}</h1>
      </article>
      <ul>
        {line.timetable.map(direction => {
          const nextSchedules = getNextSchedules(direction.schedules)
          if (nextSchedules.length === 0) return null

          return (
            <li key={direction.boundFor} className="p-4 flex items-start justify-between border-t border-t-gray-300">
              <div>
                <span className="font-bold">{direction.boundFor}</span>
              </div>
              <div className="text-right flex flex-col">
                <span className="font-bold">{parseTime(nextSchedules[0].estimatedDeparture).toLocaleTimeString('id-ID', { timeStyle: 'short' })}</span>
                {nextSchedules.length > 1 ? (
                  <span className="font-bold text-sm text-gray-500">lalu {nextSchedules.slice(1, 3).map(sched => parseTime(sched.estimatedDeparture).toLocaleTimeString('id-ID', { timeStyle: 'short' })).join(', ')}</span>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </li>
  )
}
