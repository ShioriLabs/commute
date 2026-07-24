// Time helpers pinned to Asia/Jakarta (WIB, UTC+7). The landing page can be
// viewed from any timezone, so "next departures" must be computed against
// Jakarta wall-clock, not the viewer's device time. (This is the one deliberate
// divergence from apps/web/utils/schedules.ts, which uses device-local time.)

const JAKARTA_TZ = 'Asia/Jakarta'

// Returns the current Jakarta wall-clock broken into fields.
export function nowInJakarta(): { hour: number, minute: number, second: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: JAKARTA_TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date())

  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? '0')
  // Intl can emit "24" for midnight in some engines; normalize to 0.
  const hour = get('hour') % 24
  return { hour, minute: get('minute'), second: get('second') }
}

// Minutes since Jakarta midnight for "now" (0..1439, fractional seconds dropped).
export function jakartaMinutesSinceMidnight(): number {
  const { hour, minute } = nowInJakarta()
  return hour * 60 + minute
}
