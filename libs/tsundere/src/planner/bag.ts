import { dominates, rankScore, type Criteria, type RankWeights } from './criteria'
import type { PlanInstrument } from './instrument'

/*
 * A Pareto bag: the non-dominated labels known for one (stop, round).
 *
 * This is the structure that fixes the old router's bug. `findRoute` keyed its
 * cost on the station alone while the line-change penalty depended on which
 * line you arrived on — a scalar standing in for a state it could not see. Here
 * the label carries `incomingLine`, so arriving at the same stop on two
 * different lines is two different states, which is what it always was.
 */
export interface Label<T> {
  criteria: Criteria
  /**
   * The line boarded to reach this stop, or null if walked in. Part of the
   * state, not decoration: it decides whether the next hop is a line change.
   */
  incomingLine: string | null
  /** Caller's back-pointer, for reconstructing the journey. Opaque here. */
  trace: T
}

export interface BagOptions {
  /**
   * Hard cap on labels kept per (stop, round).
   *
   * An approximation, and worth being honest about: a full bag evicts its
   * worst-ranked member, which can discard a genuinely non-dominated journey.
   * Eviction protects a line's last label (see `insert`), so it no longer undoes
   * the per-line scoping of `dominates` — but a bag whose labels are ALL sole
   * representatives has no protected-free victim, and there the global worst
   * still goes. That fallback is where the remaining risk lives.
   *
   * Without it, TJ's overlapping corridors (13 / 13E / L13E share a trunk) grow
   * bags without bound and the search stops finishing. Bounded and slightly
   * lossy beats correct and too slow to run.
   */
  maxSize: number
  weights?: RankWeights
  /**
   * Compare every label against every other, ignoring the line it arrived on.
   *
   * Correct only where the journey is over. At the destination the boarded line
   * decides nothing further, so two labels there are two finished journeys and
   * directly comparable; for a (stop, round) bag the same comparison deletes
   * states the search still needs. Off by default because the state bags
   * outnumber the one front.
   */
  comparesAcrossLines?: boolean
  /**
   * Optional counters. See PlanInstrument — absent in production, and the guard
   * is written so an unset instrument costs nothing on the insert path.
   */
  instrument?: PlanInstrument
}

/** Identical on every axis, so keeping both would just duplicate a journey. */
function sameCriteria(a: Criteria, b: Criteria): boolean {
  return a.boardings === b.boardings
    && a.rideDistanceM === b.rideDistanceM
    && a.walkDistanceM === b.walkDistanceM
    && a.concourseWalkM === b.concourseWalkM
    && a.waitS === b.waitS
    && a.fare === b.fare
}

export class Bag<T> {
  #labels: Label<T>[] = []
  readonly #maxSize: number
  readonly #weights: RankWeights | undefined
  readonly #comparesAcrossLines: boolean
  readonly #instrument: PlanInstrument | undefined

  constructor({ maxSize, weights, comparesAcrossLines = false, instrument }: BagOptions) {
    this.#maxSize = maxSize
    this.#weights = weights
    this.#comparesAcrossLines = comparesAcrossLines
    this.#instrument = instrument
  }

  get size(): number {
    return this.#labels.length
  }

  /** Snapshot, for reading results out. */
  labels(): readonly Label<T>[] {
    return this.#labels
  }

  /**
   * Offer a label to the bag.
   *
   * Returns true if it was kept, which is the caller's signal that this stop is
   * worth expanding again — a label that changed nothing cannot lead anywhere
   * new, and re-expanding on it is how a round-based scan turns quadratic.
   */
  insert(label: Label<T>): boolean {
    /*
     * Dominance only means anything between labels in the SAME state.
     *
     * Two lines running the same road are measured separately, so one is always
     * a few metres ahead — and comparing across them lets the winner delete the
     * loser's state along with every journey that had to stay on that line. TJ 6
     * reached Warung Buncit 360m ahead of 6V and deleted the only line
     * continuing to Pasar Santa, so a plain one-seat ride came back as three
     * renderings of 6 + 6V instead. This is the invariant `incomingLine` was
     * added for; until now only the duplicate check below honoured it.
     */
    const comparable = (existing: Label<T>) =>
      this.#comparesAcrossLines || existing.incomingLine === label.incomingLine

    const instrument = this.#instrument
    if (instrument) {
      instrument.inserts++
      if (this.#labels.length >= this.#maxSize) instrument.saturatedInserts++
    }

    for (const existing of this.#labels) {
      if (!comparable(existing)) continue
      if (dominates(existing.criteria, label.criteria)) {
        if (instrument) instrument.rejectedByDominance++
        return false
      }
      // A genuine duplicate — same state, same costs on every axis — is not
      // worth keeping twice. Note this must compare the criteria directly
      // rather than asking "neither dominates", which is also true of a real
      // tradeoff (fewer boardings but more walking) that both deserve to stay.
      if (sameCriteria(existing.criteria, label.criteria)) {
        if (instrument) instrument.rejectedByDuplicate++
        return false
      }
    }

    /*
     * Compact in place rather than `filter`, which allocated a fresh array on
     * every successful insert. `insert` is the hot path once dominates() stopped
     * allocating — a profile put 36.8% of samples here — and bags are tiny, so
     * the write-index loop is both faster and allocation-free.
     */
    let kept = 0
    for (let i = 0; i < this.#labels.length; i++) {
      const existing = this.#labels[i]!
      if (!comparable(existing) || !dominates(label.criteria, existing.criteria)) this.#labels[kept++] = existing
    }
    if (instrument) {
      instrument.dominatedOut += this.#labels.length - kept
      instrument.acceptedInserts++
    }
    this.#labels.length = kept
    this.#labels.push(label)

    if (this.#labels.length > this.#maxSize) {
      /*
       * Prefer a victim whose line will still be represented afterwards.
       *
       * Dominance is scoped per line so that a rival on the same road cannot
       * delete a line's state (see above). Eviction ranks across the whole bag,
       * though, so without this it happily takes a line's LAST label and undoes
       * that protection — measured at 392,135 times over a 300-pair sample,
       * just under half of all evictions. The one-seat rides `comparable` is
       * careful to protect were being thrown away one step later.
       *
       * Skipped where the journey is over: at the destination the boarded line
       * decides nothing further, so protecting per-line there would keep a worse
       * journey purely for having arrived on an unusual line.
       */
      let worstIndex = -1
      let worstScore = -Infinity
      let fallbackIndex = 0
      let fallbackScore = -Infinity
      for (let i = 0; i < this.#labels.length; i++) {
        const candidate = this.#labels[i]!
        const score = rankScore(candidate.criteria, this.#weights)
        if (score > fallbackScore) {
          fallbackScore = score
          fallbackIndex = i
        }
        if (this.#comparesAcrossLines || this.#hasAnotherOnLine(i)) {
          if (score > worstScore) {
            worstScore = score
            worstIndex = i
          }
        }
      }
      /*
       * Every label is the only one on its line, so the floor cannot be
       * satisfied and the global worst goes. The cap stays a hard bound — an
       * unbounded bag is what makes the search stop finishing at all — so this
       * is where the residual risk now lives, much narrower than before.
       */
      if (worstIndex === -1) worstIndex = fallbackIndex
      const evicted = this.#labels[worstIndex]!
      this.#labels.splice(worstIndex, 1)
      if (instrument) {
        instrument.evictions++
        if (evicted === label) instrument.selfEvictions++
        /*
         * Only meaningful where dominance is line-scoped. Off the hot path: this
         * runs only once a bag is already full, over at most maxSize entries.
         */
        if (!this.#comparesAcrossLines
          && !this.#labels.some(l => l.incomingLine === evicted.incomingLine)) {
          instrument.evictionsLeavingLineEmpty++
        }
      }
      // The offered label losing its own place means nothing downstream changed.
      if (evicted === label) return false
    }

    return true
  }

  /*
   * Does another label share index `at`'s line?
   *
   * A scan rather than a Map of counts kept across inserts: bags hold at most
   * maxSize entries (4 today, tens at the outside), and at that size the nested
   * scan beats an allocation per eviction. Same reasoning as the compaction loop
   * above. It also runs only once a bag is already full, so it is off the path
   * that dominates the profile.
   */
  #hasAnotherOnLine(at: number): boolean {
    const line = this.#labels[at]!.incomingLine
    for (let i = 0; i < this.#labels.length; i++) {
      if (i !== at && this.#labels[i]!.incomingLine === line) return true
    }
    return false
  }

  /** True when `criteria` is dominated by anything already here. Target pruning. */
  isDominated(criteria: Criteria): boolean {
    return this.#labels.some(existing => dominates(existing.criteria, criteria))
  }
}
