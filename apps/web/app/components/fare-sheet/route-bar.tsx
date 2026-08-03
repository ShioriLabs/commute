import { PersonSimpleWalkIcon } from '@phosphor-icons/react'
import LineRoundel from '~/components/line-roundel'
import { RAIL_WIDTH_PX, ROUTE_BAR_MIN_SEGMENT_PX } from '~/components/transit-geometry'
import type { RouteBarSegment } from './route-bar-segments'

/*
 * The journey at a glance, as a diagram rather than a bar.
 *
 * Ride legs are sized by ground covered and carry their line's roundel where
 * there is room; a transfer breaks the track and marks what it asks of you —
 * a walk between platforms, or a change made where you already stand. An
 * unmarked gap said a break happened without saying what it costs, and those
 * two are not the same effort to a rider deciding between options.
 *
 * The track is drawn at the rail's own gauge rather than filled to the row
 * height: a block that tall reads as a button, and a row of them as a segmented
 * control, which is the wrong promise for something measuring ground covered.
 */
export default function RouteBar({ segments }: { segments: RouteBarSegment[] }) {
  const spoken = segments.flatMap(segment => segment.kind === 'RIDE'
    ? (segment.name ? [segment.name] : [])
    : [segment.distanceM !== null ? `jalan kaki ${segment.distanceM} m` : 'pindah kendaraan'])

  return (
    <div
      className="flex items-center w-full gap-1"
      role="img"
      aria-label={spoken.length > 0 ? `Rute: ${spoken.join(', ')}` : 'Rute perjalanan'}
    >
      {segments.map((segment, index) => {
        /*
         * The walk, as a leg rather than a gap — its own stretch of track with
         * a badge at the head and the distance beside it, the same grammar the
         * rides use. Sized to its label, not to scale: 400m beside a 14km ride
         * is under 3% of the journey and would have no room to say so.
         */
        if (segment.kind === 'WALK') {
          return (
            <span
              key={index}
              className={`shrink-0 h-6 rounded-full bg-slate-400 flex items-center gap-1 pl-0.5 ${
                // Unmeasured: the pill closes up around the disc rather than
                // leaving a blank tail where a figure would have been.
                segment.distanceM !== null ? 'pr-2' : 'pr-0.5'
              }`}
            >
              {/* A white disc inset in the pill, the way a roundel sits on a
                  track — so the walk reads as the same kind of object as the
                  services either side of it, not as a caption between them. */}
              <span className="shrink-0 w-5 h-5 rounded-full bg-white flex items-center justify-center text-slate-500">
                <PersonSimpleWalkIcon weight="bold" className="w-3 h-3" />
              </span>
              {segment.distanceM !== null
                ? (
                    <span className="figure text-[10px] font-bold leading-none text-white">
                      {segment.distanceM}
                      {' m'}
                    </span>
                  )
                : null}
            </span>
          )
        }

        const color = segment.colors[0]!
        // More than one colour means interlined track: any of these services works.
        const fill = segment.colors.length > 1
          ? { backgroundImage: `linear-gradient(to right, ${color}, ${segment.colors[segment.colors.length - 1]})` }
          : { backgroundColor: color }

        return (
          <span
            key={index}
            className="relative flex items-center justify-start h-6"
            /*
             * Width is the leg's share of the ground covered — flexBasis: 0 so
             * the split is driven by flexGrow alone, not by what each leg
             * happens to contain — floored at the width of the roundel it
             * carries, so a sliver leg still has room to name itself instead of
             * overhanging into the next one.
             */
            style={{ flexGrow: segment.distanceM, flexBasis: 0, minWidth: ROUTE_BAR_MIN_SEGMENT_PX }}
          >
            <span className="absolute inset-x-0 rounded-full" style={{ height: RAIL_WIDTH_PX, ...fill }} />
            {/*
              * The boarding point, at the head of its leg. Unconditional: an
              * earlier pass sized the badge to its segment and degraded it away
              * below a threshold, which hid it exactly where it was needed most
              * — a 634m hop between two long rides is the leg a rider is least
              * able to guess and the one guaranteed to be too narrow to name
              * itself. The segment's own minimum width keeps room for it now.
              *
              * Styled the way the operator signs itself — TJ corridors filled,
              * rail ringed — which is what LineRoundel infers from `operator`.
              * A filled TJ roundel sits on track of its own colour, so the halo
              * in the plate's ground is what separates the two; the ring is not
              * decoration here, it is the only thing keeping the circle legible.
              */}
            <span className="relative shrink-0 rounded-full ring-2 ring-(--plate-ground) leading-0">
              <LineRoundel size="SM" operator={segment.operator} code={segment.code} color={color as `#${string}`} />
            </span>
          </span>
        )
      })}
    </div>
  )
}
