# Best car position

**Status:** design note, not yet implemented. Companion to `platform-codes.md`
(same keying and curation model) and `points-of-interest.md` (exits are the
usual target).

## Goal

Tell riders where to stand when boarding so they alight next to the way out or
the connection they need, the way Citymapper does: **"Front"**, not
**"Car 3"**. That saves the walk down a crowded platform at Manggarai or Tanah
Abang, and it's the difference between catching and missing a tight connection.

Why coarse positions instead of car numbers:

- **Train lengths vary.** KRL runs 8, 10 and 12-car sets on the same line, so
  "car 3" is a different spot on the platform from one train to the next.
  "Front" isn't.
- **Nobody sees car numbers.** Riders board where they're standing; they can
  see whether they're at the front, middle or back of the platform.
- **Much cheaper to curate.** A field check can say "the escalator to Exit B
  is at the front end" in seconds; per-car mapping per train length is survey work.

## Encoding: a bitmask of thirds

The train is split into thirds, **relative to the direction of travel**: `FRONT`
is the leading end, the one that reaches the next station first.

```ts
export const CarPosition = {
  FRONT: 1 << 0, // 1
  MIDDLE: 1 << 1, // 2
  BACK: 1 << 2 // 4
} as const
export type CarPositionMask = number // 0..7
```

| Mask | Meaning | Label |
|---|---|---|
| `0` | no hint (unknown, or not worth showing) | *(nothing shown)* |
| `1` | front | Depan |
| `2` | middle | Tengah |
| `4` | back | Belakang |
| `3` | front or middle | Depan–tengah |
| `6` | middle or back | Tengah–belakang |
| `5` | either end | Ujung depan atau belakang |
| `7` | any car works (verified) | *(nothing shown; see below)* |

Why a bitmask: exits and connectors often sit between thirds (an escalator at the
front-middle boundary), and some stations have useful stairs at **both** ends. A
single enum can't say "front or middle" or "either end" without adding members;
a mask gets every combination from three bits, and the pieces combine with plain
bitwise operations.

**`0` versus `7`.** Both render as nothing, but they mean different things: `0`
is "no data" and `7` is "someone checked, it doesn't matter". Keeping them apart
lets coverage reports tell unchecked stations from checked-and-irrelevant ones.

## Key: arrival direction plus target

A hint depends on three things: the station you alight at, which way the train
arrives, and where you're going next.

```
${stationId}:${lineCode}:${prevHopCode}:${targetId}
```

- **`prevHopCode`**, the station the train comes *from*, fixes the direction.
  It's the arrival-side mirror of `PLATFORM_CODES`' next-hop key, and unlike next
  hop it still works at termini, where the train has no next station.
- **`targetId`** is what you're heading for:
  - a `stationExits.id` (`MRTJ-IST:B`), when the journey ends here or continues on
    foot to a POI;
  - `transfer:${lineCode}` for a same-station line change (`transfer:B`);
  - `transfer:${stationId}` for a walk to another station (`transfer:TJ-H00047P`).

Example: `KCI-MRI:C:JNG:transfer:A` = at Manggarai, on the Cikarang line arriving
from Jatinegara, heading for the Soekarno-Hatta airport line → probably `FRONT`.
*(Illustrative; every real value comes from a field check.)*

## Storage: curated overlay in code

Same decision and reasons as `platform-codes.md`: small, curated, versioned with
the code, and reviewed as a diff. `CAR_POSITIONS: Record<string, CarPositionMask>` in
`@commute/constants`, sparse (only keys with a checked value), and **bump
`API_VERSION` on edits** because results are cached in KV.

Once a station has an interior map (`interior-and-locality-maps.md`), its hints
can be **derived** instead: project the connector nearest each target onto the
platform's travel axis and set the bit for the third(s) it falls in, or two bits if it
sits near a boundary. Curated entries then act as overrides for the cases where
the geometry misleads (a closer escalator that's usually broken, say).

## Where it shows up

On the **ride leg**, at boarding time, not at arrival: by the time you arrive,
it's too late to move.

- Result timeline, under the boarding station: *"Naik di gerbong **depan**"*,
  with a small train glyph that has the matching third(s) filled.
- The hint belongs to the ride leg and names its reason:
  *"… dekat Pintu B"* or *"… untuk transit ke Lin Bogor"*.
- Journeys with several ride legs get one hint per leg (each for its own
  alighting target).

API: an optional `carPosition` on the RIDE leg (the mask, omitted when `0` or
`7`) plus `carPositionFor` (the target it was computed for), in both
`apps/api` models and `@commute/schemas`.

## KRL women-only cars

KRL's women-only cars are **at both ends** of the train. A plain `FRONT` or `BACK`
hint would send men to the one car they can't board. When the leg is on KCI
and the mask contains `FRONT` or `BACK`, the label adds a note: *"Depan
(gerbong khusus wanita di ujung)"*, meaning stand toward the front, but not in
the end car. Other operators get no such note unless they have the same rule.

## Scope and coverage

- **Worth it:** long trains and busy transfers, meaning KRL at Manggarai, Tanah Abang,
  Sudirman, Jatinegara, Duri, Kampung Bandan; MRT at stations with exits at both
  ends (Dukuh Atas, Bundaran HI); LRTJBDB at its branch stations.
- **Not worth it:** LRT Jakarta (short trains; always `0`), TJ BRT (a bus has two
  doors, and the halte door, not the car, is what matters: that's a platform-code
  question).
- Start with the transfers people get wrong most (Manggarai first), then the exits
  that POIs point at.

## Build order

1. `CarPosition` + `CAR_POSITIONS` (empty) in `@commute/constants`; schema field
   on the RIDE leg.
2. Resolution in the fare/trip response: for each ride leg, look up
   `${alightStation}:${line}:${prevHop}:${target}`, where the target is the next
   leg's transfer, or the exit on the journey's final `ACCESS` leg.
3. Timeline rendering: label, train glyph, KRL women-only note.
4. Field-check Manggarai's transfers, then the POI exits.
5. Later: derive from interior maps where they exist.

## Open questions

- Whether mask `5` (either end) is worth a label, or should collapse to "no hint"
  because it doesn't narrow the choice much.
- Direction of travel for trains that reverse mid-journey (terminus turnbacks
  a rider stays on board through): rare, but FRONT flips.
- Whether to show the hint on departure boards too ("for Exit B, board at the
  front"), or only in journey results.
