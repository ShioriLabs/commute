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
