import { Line } from 'models/line'

/*
 * TransJakarta corridor lines. Empty until the GTFS importer populates them
 * from the feed's BRT + Angkutan Umum Integrasi routes (lineCode =
 * route_short_name; name/colorCode from route_long_name/route_color). See
 * docs/tj-gtfs-import.md.
 */
export const LINES: readonly Line[] = [] as const
