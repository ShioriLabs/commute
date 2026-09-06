/*
 * Service windows: when each line runs, in seconds since local midnight.
 *
 * GENERATED — do not edit by hand; re-run `pnpm --filter api generate:service-hours`.
 *
 * A window is `[startS, endS]`. `endS < startS` means it crosses midnight,
 * which is normal for rail: KCI's Bogor line runs 03:50 to 01:07. Compare
 * with `inWindow` from @commute/tsundere rather than by hand — a plain
 * `t >= start && t <= end` matches nothing at all on a crossing window.
 *
 * `ALL` means the window is the same on every day. A line may instead carry
 * WD / SAT / SUN keys when its span genuinely differs. Read the specific day
 * first, then ALL, then treat a missing line as always in service — so a
 * line we have no window for keeps today's behaviour rather than closing.
 *
 * TJ spans come from GTFS frequencies.txt and are exact. Rail windows are
 * inferred from the schedules table as the complement of the largest gap
 * between departures; a line with no gap long enough to be an overnight
 * break is omitted, which is how the 24-hour corridors stay open.
 */

import type { ServiceWindow } from '@commute/tsundere'

/** Day buckets a window can be keyed by, plus ALL for "every day". */
export type ServiceDay = 'WD' | 'SAT' | 'SUN' | 'ALL'

export const SERVICE_HOURS: Record<string, Partial<Record<ServiceDay, ServiceWindow>>> = {
  // 00:00-23:59
  '1': { ALL: [0, 86399] },
  // 00:00-23:59
  '10': { ALL: [0, 86399] },
  // 05:00-22:00
  '10H': { ALL: [18000, 79200] },
  // 00:00-23:59
  '11': { ALL: [0, 86399] },
  // 00:00-23:59
  '12': { ALL: [0, 86399] },
  // 00:00-23:59
  '13': { ALL: [0, 86399] },
  // 05:00-22:00
  '13B': { ALL: [18000, 79200] },
  // SAT 05:00-22:00, SUN 05:00-22:00
  '13E': { SAT: [18000, 79200], SUN: [18000, 79200] },
  // 00:00-23:59
  '14': { ALL: [0, 86399] },
  // 00:00-23:59
  '2': { ALL: [0, 86399] },
  // 05:00-22:00
  '2A': { ALL: [18000, 79200] },
  // 00:00-23:59
  '3': { ALL: [0, 86399] },
  // 05:00-22:00
  '3F': { ALL: [18000, 79200] },
  // 05:00-22:00
  '3H': { ALL: [18000, 79200] },
  // 00:00-23:59
  '4': { ALL: [0, 86399] },
  // 05:00-22:00
  '4D': { ALL: [18000, 79200] },
  // 00:00-23:59
  '5': { ALL: [0, 86399] },
  // 05:00-22:00
  '5C': { ALL: [18000, 79200] },
  // 00:00-23:59
  '6': { ALL: [0, 86399] },
  // 05:00-22:00
  '6A': { ALL: [18000, 79200] },
  // 05:00-22:00
  '6B': { ALL: [18000, 79200] },
  // 05:00-22:00
  '6V': { ALL: [18000, 79200] },
  // 00:00-23:59
  '7': { ALL: [0, 86399] },
  // 05:00-20:30
  '7F': { ALL: [18000, 73800] },
  // 00:00-23:59
  '8': { ALL: [0, 86399] },
  // 00:00-23:59
  '9': { ALL: [0, 86399] },
  // 05:00-22:00
  '9A': { ALL: [18000, 79200] },
  // 05:00-22:00
  '9C': { ALL: [18000, 79200] },
  // SAT 05:00-22:00, SUN 05:00-22:00
  '9N': { SAT: [18000, 79200], SUN: [18000, 79200] },
  // 05:00-23:37
  'A': { ALL: [18000, 85020] },
  // 03:50-01:07
  'B': { ALL: [13800, 4020] },
  // 05:12-23:41
  'BK': { ALL: [18720, 85260] },
  // 04:12-00:57
  'C': { ALL: [15120, 3420] },
  // 05:18-23:43
  'CB': { ALL: [19080, 85380] },
  // 05:58-23:54
  'KLB': { ALL: [21480, 86040] },
  // WD 05:00-22:00
  'L13E': { WD: [18000, 79200] },
  // 05:00-23:57
  'M': { ALL: [18000, 86260] },
  // 03:47-00:48
  'R': { ALL: [13620, 2880] },
  // 05:30-22:49
  'S': { ALL: [19800, 82140] },
  // 04:27-00:13
  'T': { ALL: [16020, 780] },
  // 05:00-21:12
  'TP': { ALL: [18000, 76320] }
}
