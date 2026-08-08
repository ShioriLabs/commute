/*
 * A binary min-heap, used for Dijkstra's priority queue in `findRoute`.
 *
 * It replaces a linear scan over the `dist` map. That scan was justified by a
 * comment reading "the graph is ~180 nodes" — true when it was written, but the
 * graph is 369 nodes now and would grow again if the dormant TJ feeders are
 * re-enabled. A scan makes each pick O(V) and the search O(V^2); this makes the
 * pick O(log V) and the search O(E log V).
 *
 * Deliberately kept to what Dijkstra needs, which is why there is no
 * decrease-key: the caller pushes the same node again at its improved cost
 * (lazy deletion) and skips any entry already visited when it pops. That trades
 * a slightly larger heap for not having to track positions per node, and the
 * duplicates are bounded by the edge count.
 *
 * Two parallel arrays rather than an array of `{ item, priority }`: this sits
 * in the hot loop of the router, and not allocating a wrapper object per push
 * is the whole reason to hand-roll a heap instead of sorting.
 */
export class MinHeap<T> {
  private readonly items: T[] = []
  private readonly priorities: number[] = []

  get size(): number {
    return this.items.length
  }

  push(item: T, priority: number): void {
    this.items.push(item)
    this.priorities.push(priority)
    this.bubbleUp(this.items.length - 1)
  }

  /** The lowest-priority item, or undefined when empty. */
  pop(): T | undefined {
    if (this.items.length === 0) return undefined
    const top = this.items[0]!
    const lastItem = this.items.pop()!
    const lastPriority = this.priorities.pop()!
    if (this.items.length > 0) {
      this.items[0] = lastItem
      this.priorities[0] = lastPriority
      this.sinkDown(0)
    }
    return top
  }

  private bubbleUp(start: number): void {
    let index = start
    const item = this.items[index]!
    const priority = this.priorities[index]!
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.priorities[parent]! <= priority) break
      this.items[index] = this.items[parent]!
      this.priorities[index] = this.priorities[parent]!
      index = parent
    }
    this.items[index] = item
    this.priorities[index] = priority
  }

  private sinkDown(start: number): void {
    let index = start
    const length = this.items.length
    const item = this.items[index]!
    const priority = this.priorities[index]!
    for (;;) {
      const left = index * 2 + 1
      if (left >= length) break
      const right = left + 1
      // Descend toward the smaller child, so the parent ends up below both.
      const child = right < length && this.priorities[right]! < this.priorities[left]! ? right : left
      if (this.priorities[child]! >= priority) break
      this.items[index] = this.items[child]!
      this.priorities[index] = this.priorities[child]!
      index = child
    }
    this.items[index] = item
    this.priorities[index] = priority
  }
}
