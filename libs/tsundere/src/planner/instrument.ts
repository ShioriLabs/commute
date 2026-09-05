/*
 * Counters a caller can hand the planner to find out what the search did.
 *
 * Exists because the engine's accuracy is bounded by caps and heuristics
 * (maxBagSize, the boardings slack, eviction) whose cost has never been
 * measurable from outside: bags are private, per-(stop, round), and gone when
 * plan() returns. Timing said whether a change was affordable and nothing else,
 * so every claim about what a cap threw away was an argument rather than a
 * number.
 *
 * A plain mutable object rather than a callback, deliberately. Bag.insert is the
 * hot path — a profile put 36.8% of samples there — and a per-insert closure
 * call is megamorphic across call sites, whereas an `if (instrument)` guard on a
 * field the JIT sees as undefined costs nothing measurable. That is also why
 * every counter is a bare number: no arrays, no Sets, nothing that allocates
 * inside the loop being measured.
 *
 * Not a production path. Nothing in the engine reads these back, and leaving the
 * option unset is the normal case.
 */
export interface PlanInstrument {
  // ── bag pressure ───────────────────────────────────────────────────────────
  /** Labels offered to any bag. */
  inserts: number
  /**
   * Offers that got past dominance and into the bag.
   *
   * Counted before eviction runs, so a label that is immediately evicted again
   * counts here and in `selfEvictions` both — accepted, then thrown straight
   * back out. `acceptedInserts - selfEvictions` is the number that stayed.
   */
  acceptedInserts: number
  /** Offers refused because a comparable label already dominated them. */
  rejectedByDominance: number
  /** Offers refused as an exact duplicate on every axis. */
  rejectedByDuplicate: number
  /** Existing labels compacted away because the newcomer dominated them. */
  dominatedOut: number
  /** Offers made to a bag already at maxSize — the cap actually binding. */
  saturatedInserts: number
  /** Labels dropped purely to respect maxSize. */
  evictions: number
  /** Evictions where the victim was the label just offered. */
  selfEvictions: number
  /**
   * Evictions that left the bag holding nothing on the victim's line.
   *
   * The number this whole file was written for. Dominance is scoped per-line so
   * a line's own state cannot be deleted by a rival line — but eviction ranks
   * across the whole bag, so the cap can still take a line's last label and undo
   * that protection. This counts how often that actually happens rather than
   * leaving it as a known-possible hazard nobody has sized.
   */
  evictionsLeavingLineEmpty: number

  // ── search shape ───────────────────────────────────────────────────────────
  /**
   * Edges examined. The unit the planner's own comments already quote (206 vs
   * 4438 on LRTJBDB-DKA -> LRTJBDB-JTM), so it stays comparable to the record.
   */
  adjacencyLookups: number
  /** Labels taken off a bag and expanded. */
  labelsExpanded: number
  /** Hops cut by the boardings slack — the heuristic bound, not a sound one. */
  boardingsBoundPrunes: number
  /** Hops cut because a finished journey already dominated them. */
  targetPrunes: number
  /** Hops cut for needing a boarding the round budget cannot pay for. */
  roundBudgetPrunes: number
  /** Highest round reached. Says whether maxRounds is binding at all. */
  roundsUsed: number
  /** Labels offered to the destination bag. */
  destinationInserts: number
}

export const newInstrument = (): PlanInstrument => ({
  inserts: 0,
  acceptedInserts: 0,
  rejectedByDominance: 0,
  rejectedByDuplicate: 0,
  dominatedOut: 0,
  saturatedInserts: 0,
  evictions: 0,
  selfEvictions: 0,
  evictionsLeavingLineEmpty: 0,
  adjacencyLookups: 0,
  labelsExpanded: 0,
  boardingsBoundPrunes: 0,
  targetPrunes: 0,
  roundBudgetPrunes: 0,
  roundsUsed: 0,
  destinationInserts: 0
})
