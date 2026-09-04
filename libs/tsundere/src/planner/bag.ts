import { dominates, rankScore, type Criteria, type RankWeights } from './criteria'

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
   * Eviction is ranked across the whole bag rather than within a line, so it can
   * take a line's only label and cost the same one-seat rides `dominates` is
   * careful to protect — the cap is where that risk now lives.
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

  constructor({ maxSize, weights, comparesAcrossLines = false }: BagOptions) {
    this.#maxSize = maxSize
    this.#weights = weights
    this.#comparesAcrossLines = comparesAcrossLines
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

    for (const existing of this.#labels) {
      if (!comparable(existing)) continue
      if (dominates(existing.criteria, label.criteria)) return false
      // A genuine duplicate — same state, same costs on every axis — is not
      // worth keeping twice. Note this must compare the criteria directly
      // rather than asking "neither dominates", which is also true of a real
      // tradeoff (fewer boardings but more walking) that both deserve to stay.
      if (sameCriteria(existing.criteria, label.criteria)) return false
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
    this.#labels.length = kept
    this.#labels.push(label)

    if (this.#labels.length > this.#maxSize) {
      let worstIndex = 0
      let worstScore = -Infinity
      for (let i = 0; i < this.#labels.length; i++) {
        const score = rankScore(this.#labels[i]!.criteria, this.#weights)
        if (score > worstScore) {
          worstScore = score
          worstIndex = i
        }
      }
      const evicted = this.#labels[worstIndex]
      this.#labels.splice(worstIndex, 1)
      // The offered label losing its own place means nothing downstream changed.
      if (evicted === label) return false
    }

    return true
  }

  /** True when `criteria` is dominated by anything already here. Target pruning. */
  isDominated(criteria: Criteria): boolean {
    return this.#labels.some(existing => dominates(existing.criteria, criteria))
  }
}
