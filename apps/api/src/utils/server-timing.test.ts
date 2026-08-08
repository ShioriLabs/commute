import { describe, expect, it } from 'vitest'
import { ServerTiming } from 'utils/server-timing'

describe('ServerTiming', () => {
  it('is empty until something is measured', () => {
    expect(new ServerTiming().header()).toBe('')
  })

  it('renders a measured span as name;dur=', () => {
    const t = new ServerTiming()
    t.record('route', 1.25)
    expect(t.header()).toBe('route;dur=1.25')
  })

  it('joins spans in the order they were recorded', () => {
    const t = new ServerTiming()
    t.record('kv', 1)
    t.record('db', 2)
    t.record('route', 3)
    expect(t.header()).toBe('kv;dur=1, db;dur=2, route;dur=3')
  })

  /*
   * Two decimals: findRoute runs in well under a millisecond, so integer
   * rounding would report the fastest phase as 0 and make the split unreadable
   * — which is the one thing this header exists to show.
   */
  it('keeps sub-millisecond spans legible', () => {
    const t = new ServerTiming()
    t.record('route', 0.5119)
    expect(t.header()).toBe('route;dur=0.51')
  })

  it('drops trailing zeroes rather than padding', () => {
    const t = new ServerTiming()
    t.record('route', 2)
    t.record('db', 2.5)
    expect(t.header()).toBe('route;dur=2, db;dur=2.5')
  })

  describe('measure', () => {
    it('returns the wrapped value', async () => {
      const t = new ServerTiming()
      await expect(t.measure('db', async () => 'result')).resolves.toBe('result')
      expect(t.header()).toContain('db;dur=')
    })

    /*
     * A phase that throws still took time, and a request that 500s is exactly
     * when the split matters. Recording before rethrowing keeps the header
     * honest on the error path.
     */
    it('records the span even when the body throws, then rethrows', async () => {
      const t = new ServerTiming()
      await expect(t.measure('db', async () => {
        throw new Error('boom')
      })).rejects.toThrow('boom')
      expect(t.header()).toContain('db;dur=')
    })

    it('measures a synchronous body too', () => {
      const t = new ServerTiming()
      expect(t.measureSync('route', () => 42)).toBe(42)
      expect(t.header()).toContain('route;dur=')
    })
  })

  /*
   * Names go into a response header, so a stray quote or semicolon would let a
   * caller-derived name break the syntax. Nothing passes user input today; this
   * pins that it stays safe if anything ever does.
   */
  it('strips characters that would break header syntax', () => {
    const t = new ServerTiming()
    t.record('we;ird "name"', 1)
    expect(t.header()).toBe('weirdname;dur=1')
  })
})
