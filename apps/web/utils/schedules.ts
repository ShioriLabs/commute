export function parseTime(timeString: string) {
  return new Date(`${new Date().toDateString()} ${timeString}`)
}

export function isImmediateDeparture(now: Date, scheduledDeparture: Date) {
  const diff = scheduledDeparture.getTime() - now.getTime()
  return diff >= -60000 && diff <= 60000
}
