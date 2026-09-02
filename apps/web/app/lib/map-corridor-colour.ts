/*
 * Comparing a corridor's artwork colour to a line's brand colour.
 *
 * Corridors carry their artwork hex directly now, straight from the SVG stroke each
 * was extracted from (see CorridorEntry in scripts/build-map-skeleton.ts). This
 * module used to recover that colour by joining corridors to map-skeleton.json on
 * their endpoints — a workaround that only ever covered rail, since the skeleton
 * holds no BRT strokes, and that needed both files regenerated in lockstep. The
 * value was in the source all along; the corridor writer was dropping it.
 *
 * What is left here is the comparison, which is the part that carries judgement:
 * the artwork palette and the brand palette are related but not identical, so
 * "is this stroke this line's" is a tolerance question rather than an equality.
 */

/*
 * Worst per-channel difference between two `#rrggbb` strings, 0..255.
 *
 * Per-channel rather than a distance in RGB, so one badly-off channel cannot be
 * averaged away by two close ones. Mirrors the comparison build-map-skeleton.ts
 * uses to pair station discs with their line.
 */
export function channelDistance(a: string, b: string): number {
  let worst = 0
  for (let i = 1; i < 7; i += 2) {
    const av = parseInt(a.slice(i, i + 2), 16)
    const bv = parseInt(b.slice(i, i + 2), 16)
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return 255
    worst = Math.max(worst, Math.abs(av - bv))
  }
  return worst
}

/*
 * How far a corridor's artwork colour may sit from a line's brand colour and
 * still be that line, per channel.
 *
 * The two palettes are related but not identical: MRTJ's brand `#ca2a51` matches
 * its artwork stroke exactly, while others drift. This has to absorb that drift
 * while still separating the colours actually confused on the sheet, which are
 * nothing alike — the confirmed failure traces a yellow line onto a blue stroke,
 * `#F8C434` against `#2355A2`, 165 apart on the worst channel.
 *
 * Measured over the 10 distinct rail colours (45 pairs): the closest are 36
 * apart (`#CA2A51` vs `#EE3637`, two reds) and 37 of 45 pairs exceed this
 * value. So at 72 the palette's genuinely-similar reds and blues stay
 * indistinguishable — `#BF6433`/`#EE3637`, `#1351A1`/`#282A65` — while anything
 * grossly different separates.
 *
 * Checked from the other side too: all 10 non-BUS lines match their own artwork
 * stroke, and each to a DIFFERENT one, so the join is 1:1 over the shipped set.
 * Worst drift is KCI:C at 37 (`#25B8EB` brand against `#00BDEE` drawn); MRTJ is
 * exact. 37 against a 36-apart closest pair is why this cannot be tightened much
 * without a line failing to match itself.
 *
 * That is the intent, not a shortfall. This is a discriminator against a
 * grossly different stroke, not an identity test: tightening it far enough to
 * split two reds would start rejecting a line from its own stroke wherever the
 * brand and artwork palettes drift. Every use must fall back to colour-blind
 * matching rather than dropping a segment outright.
 */
export const CORRIDOR_COLOUR_TOLERANCE = 72

export function colourMatches(
  corridorColour: string | null,
  lineColour: string | undefined,
  /*
   * Colours of the OTHER lines that run this same stretch of track.
   *
   * Shared track is normal on this network and the sheet can only draw it once,
   * in one line's colour: LRT Jabodebek's Cibubur and Bekasi lines share the
   * Dukuh Atas to Cawang trunk, and Cikarang shares Manggarai to Sudirman with
   * Soekarno-Hatta. A strict colour gate refuses the whole shared run, which is
   * the wrong answer twice over — the stretch really is part of this line, and
   * leaving it faded reads as a hole in the middle of it.
   *
   * So a stroke also passes when its colour belongs to a line that demonstrably
   * serves BOTH stops of the pair being matched. That is much narrower than
   * dropping the gate: it admits the neighbour that shares this track, and still
   * refuses a parallel stroke belonging to a line that goes somewhere else,
   * which is the failure the gate exists for. Measured over the shipped network,
   * 8 of the 10 refusals are shared track and 2 have no sharing line at all.
   *
   * Empty or omitted keeps the old strict behaviour.
   */
  sharedTrackColours?: readonly string[]
): boolean {
  // Unknown either side is not a mismatch. A BRT corridor, an unjoined stroke and
  // a line with no brand colour all have to stay eligible.
  if (!corridorColour || !lineColour) return true
  if (channelDistance(corridorColour, lineColour) <= CORRIDOR_COLOUR_TOLERANCE) return true
  if (sharedTrackColours) {
    for (const shared of sharedTrackColours) {
      if (channelDistance(corridorColour, shared) <= CORRIDOR_COLOUR_TOLERANCE) return true
    }
  }
  return false
}

/*
 * Sampling radius for the ink election, world units.
 *
 * A stop that is genuinely drawn ON a stroke sits within half the widest stroke
 * (25) plus a little slack. Measured by sweeping the whole BRT network and
 * reading the off-colour audit: 10 loses the vote for lines whose pins sit
 * slightly off their stroke (5.07% of traced length lands on foreign ink), while
 * 15, 20, 25 and 40 all sit on one flat plateau at 1.76%.
 *
 * 15 is the plateau's tight edge on purpose. The ballot should count the ink a
 * stop is ON, not every colour that happens to run nearby, and there is nothing
 * to gain from reaching further.
 */
export const CORRIDOR_INK_SAMPLE_DIST_WORLD = 15

/*
 * Fewest votes an ink needs before it can be elected.
 *
 * Below three stops the tally is not evidence, it is a coincidence: two stops on
 * a shared interchange band would let any stroke crossing them rename the line.
 * TJ:9N is the smallest line that legitimately elects (3 votes against 2), so
 * this sits just under it.
 */
export const CORRIDOR_INK_MIN_VOTES = 3

/*
 * How far ahead of the runner-up the winning ink must be.
 *
 * Where a line genuinely runs on shared infrastructure no single ink dominates,
 * and guessing between two near-equal tallies is worse than keeping the brand.
 * Measured: 1.2 and 1.5 behave identically across every sampling radius, while
 * 2.0 starts refusing legitimate elections (TJ:10D at 13 against 9, TJ:L13E at 7
 * against 6 both fall back and cost seven traced pairs). 1.5 is the middle of the
 * flat region.
 */
export const CORRIDOR_INK_MIN_LEAD = 1.5

/*
 * What it takes to overrule the BRAND colour, rather than merely refine it.
 *
 * Most elections land within CORRIDOR_COLOUR_TOLERANCE of the brand — they only
 * swap a brand hex for the artwork hex of the same family, which is safe by
 * construction. Measured, the largest such shift is 45 (KCI:B `#EE3D43` to its
 * drawn `#FD1516`).
 *
 * An election BEYOND the tolerance is a different claim: it says the brand is
 * simply wrong about which ink the line is drawn in. That is true for TJ:7, 7F
 * and 14, and it must stay possible — but it also disarms the colour gate for
 * that line, so a thin or narrow ballot must not be allowed to make it. Without
 * a floor here a line with a single nearby stroke elects that stroke's colour
 * and the gate then approves the very stroke it exists to refuse.
 *
 * Measured over every line on the network, far elections are backed by 7-14
 * votes and 78-88% of resolved stops, except TJ:L13E at 7 of 13 (54%) — a bare
 * majority on genuinely shared infrastructure, which should keep its brand. So
 * both tests must pass: a real corridor's worth of evidence, and most of the
 * line agreeing.
 */
export const CORRIDOR_INK_OVERRULE_MIN_VOTES = 6
export const CORRIDOR_INK_OVERRULE_MIN_SHARE = 0.6

/*
 * The artwork colour a line is actually DRAWN in, elected by its own stops.
 *
 * The gate above compares a stroke to the line's BRAND hex, which quietly assumes
 * the two palettes agree. Over the BRT network they mostly do — 28 of 31 lines —
 * but where they disagree the brand is not merely imprecise, it is wrong in a way
 * that steers the trace:
 *
 *   - TJ:14's `#F5AB6E` matches NO stroke on the sheet. It is a pale tint of the
 *     `#FA7116` the line is drawn in, 88 channels away, so the gate rejects the
 *     line's own ink and the fallback rides whatever is nearest.
 *   - TJ:7 and TJ:7F are branded brown `#914900` but drawn in crimson `#F71752`,
 *     102 apart. Worse, the minority strokes they cross (`#CD4411`, `#89070E`)
 *     DO pass the gate, so colour actively elects the wrong corridor rather than
 *     merely failing to help.
 *
 * The stations are what break the tie, because a line owns its stops even where
 * it cannot own its corridor — the busway is shared, the timetable is not. So
 * ask the stops which ink they sit on and let the majority name the line's
 * colour; the gate then does its usual job against an answer taken from the
 * artwork instead of asserted over it.
 *
 * One vote per stop per DISTINCT hex, so a stop lying on three co-drawn strokes
 * of one colour cannot stuff the ballot — that would let a single interchange
 * outvote a whole corridor.
 *
 * Returns the brand colour unchanged whenever the election is not decisive
 * (too few votes, or no clear lead) and whenever there is nothing to count, so
 * every caller that passes `undefined` keeps its colour-blind behaviour.
 */
export function electArtworkColour(
  stops: ReadonlyArray<{ x: number, y: number }>,
  // Already restricted to the line's own mode by the caller: a rail line must
  // never elect a BRT stroke's colour, and the width gate is what knows that.
  // Taken as a projection callback rather than a PreparedCorridor so this module
  // stays free of a geometry import, exactly as map-corridors.ts stays free of a
  // colour one.
  corridors: ReadonlyArray<{ c: string, project: (x: number, y: number) => number }>,
  brandColour: string | undefined,
  options?: {
    inkDistWorld?: number
    minVotes?: number
    minLead?: number
    overruleMinVotes?: number
    overruleMinShare?: number
  }
): string | undefined {
  if (stops.length === 0 || corridors.length === 0) return brandColour
  const inkDist = options?.inkDistWorld ?? CORRIDOR_INK_SAMPLE_DIST_WORLD
  const minVotes = options?.minVotes ?? CORRIDOR_INK_MIN_VOTES
  const minLead = options?.minLead ?? CORRIDOR_INK_MIN_LEAD
  const overruleVotes = options?.overruleMinVotes ?? CORRIDOR_INK_OVERRULE_MIN_VOTES
  const overruleShare = options?.overruleMinShare ?? CORRIDOR_INK_OVERRULE_MIN_SHARE

  const votes = new Map<string, number>()
  for (const stop of stops) {
    const inks = new Set<string>()
    for (const corridor of corridors) {
      if (corridor.c && corridor.project(stop.x, stop.y) <= inkDist) inks.add(corridor.c)
    }
    for (const ink of inks) votes.set(ink, (votes.get(ink) ?? 0) + 1)
  }

  /*
   * Highest tally and the next one down. Ties keep the FIRST ink seen only as a
   * placeholder — a tie can never win, because it cannot clear the lead test.
   */
  let best: string | undefined
  let bestVotes = 0
  let runnerUp = 0
  for (const [ink, count] of votes) {
    if (count > bestVotes) {
      runnerUp = bestVotes
      best = ink
      bestVotes = count
    } else if (count > runnerUp) {
      runnerUp = count
    }
  }

  if (best === undefined || bestVotes < minVotes) return brandColour
  if (runnerUp > 0 && bestVotes < runnerUp * minLead) return brandColour
  /*
   * Overruling the brand outright needs more than winning the tally — see
   * CORRIDOR_INK_OVERRULE_MIN_VOTES. Within tolerance this is just the artwork's
   * own spelling of the same colour and passes straight through.
   */
  if (brandColour && channelDistance(best, brandColour) > CORRIDOR_COLOUR_TOLERANCE) {
    if (bestVotes < overruleVotes) return brandColour
    if (bestVotes < stops.length * overruleShare) return brandColour
  }
  return best
}
