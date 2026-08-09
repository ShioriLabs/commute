/*
 * `Server-Timing`, so a request can say where its own time went.
 *
 * Written because "should the router be WASM" could not be answered from the
 * outside: a cold /fares takes 17-51 ms, and the guess was that Dijkstra
 * dominated it. Measured off-worker, findRoute is ~0.5 ms — the rest is D1 and
 * station hydration. That measurement was Node on a laptop, though, and the
 * thing that actually serves riders is workerd; this header is how the same
 * split gets read from production instead of inferred from a benchmark.
 *
 * The browser surfaces it natively in the network panel, so no tooling is
 * needed to read it, and it costs one header on responses that already do real
 * work.
 */

/** One measured phase. */
interface Span {
  name: string
  ms: number
}

/*
 * `dur` is milliseconds; the spec allows a decimal. Two places is deliberate:
 * the fastest phase here is under a millisecond, and integer rounding would
 * print it as 0 — erasing exactly the comparison the header exists to make.
 */
function formatMs(ms: number): string {
  return String(Number(ms.toFixed(2)))
}

/*
 * Header syntax is `name;dur=1.5, other;dur=2`, so a name carrying `;` `,` or a
 * quote would split one span into two or unbalance a quoted string. Nothing
 * passes caller input as a name today, and this makes sure that staying true
 * is not what keeps the header well-formed.
 */
function sanitise(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '')
}

export class ServerTiming {
  private readonly spans: Span[] = []

  /** Record a span measured elsewhere. */
  record(name: string, ms: number): void {
    this.spans.push({ name: sanitise(name), ms })
  }

  /** Time an async phase, keeping its value and its rejection. */
  async measure<T>(name: string, body: () => Promise<T>): Promise<T> {
    const start = performance.now()
    try {
      return await body()
    } finally {
      // In `finally` so a throwing phase still reports its cost: a request that
      // fails slowly is precisely when the split is worth having.
      this.record(name, performance.now() - start)
    }
  }

  /** Time a synchronous phase. findRoute is the reason this exists. */
  measureSync<T>(name: string, body: () => T): T {
    const start = performance.now()
    try {
      return body()
    } finally {
      this.record(name, performance.now() - start)
    }
  }

  /** The header value, or '' when nothing was measured. */
  header(): string {
    return this.spans.map(s => `${s.name};dur=${formatMs(s.ms)}`).join(', ')
  }
}
