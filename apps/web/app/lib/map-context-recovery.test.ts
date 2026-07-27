import { describe, expect, it } from 'vitest'
import {
  createRecoveryController,
  MAX_RECOVERY_ATTEMPTS,
  RECOVERY_BACKOFF_MS,
  RECOVERY_STABLE_MS,
  type RecoveryController,
  type RecoveryState
} from './map-context-recovery'

// Minimal fake clock: records pending timers and lets tests run whichever one is
// due, so backoff delays can be asserted exactly rather than waited out.
function createClock() {
  const pending = new Map<number, { fn: () => void, ms: number }>()
  let nextId = 1
  return {
    setTimer(fn: () => void, ms: number) {
      const id = nextId++
      pending.set(id, { fn, ms })
      return id
    },
    clearTimer(id: number) {
      pending.delete(id)
    },
    // Delay of the single pending timer, or null when nothing is scheduled.
    pendingDelay(): number | null {
      const entries = [...pending.values()]
      expect(entries.length).toBeLessThanOrEqual(1)
      return entries[0]?.ms ?? null
    },
    fire() {
      const entries = [...pending.entries()]
      expect(entries).toHaveLength(1)
      const [id, timer] = entries[0]
      pending.delete(id)
      timer.fn()
    }
  }
}

function setup(opts: { visible?: boolean } = {}) {
  const clock = createClock()
  const states: RecoveryState[] = []
  let visible = opts.visible ?? true
  let rebuilds = 0
  const controller: RecoveryController = createRecoveryController({
    rebuild: () => { rebuilds++ },
    isPageVisible: () => visible,
    onStateChange: (s) => { states.push(s) },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer
  })
  return {
    clock,
    controller,
    states,
    rebuilds: () => rebuilds,
    setVisible: (v: boolean) => { visible = v }
  }
}

describe('createRecoveryController', () => {
  it('starts idle and does nothing until a loss is reported', () => {
    const t = setup()
    expect(t.controller.state()).toBe('idle')
    expect(t.clock.pendingDelay()).toBeNull()
    expect(t.rebuilds()).toBe(0)
  })

  it('arms with the first backoff and rebuilds when the page is visible', () => {
    const t = setup({ visible: true })
    t.controller.notifyLost()
    expect(t.controller.state()).toBe('armed')
    expect(t.clock.pendingDelay()).toBe(RECOVERY_BACKOFF_MS[0])
    expect(t.rebuilds()).toBe(0) // never rebuilds synchronously from the loss

    t.clock.fire()
    expect(t.controller.state()).toBe('attempting')
    expect(t.rebuilds()).toBe(1)
  })

  it('parks a loss that happens while hidden until the page comes back', () => {
    const t = setup({ visible: false })
    t.controller.notifyLost()
    expect(t.controller.state()).toBe('lost')
    expect(t.clock.pendingDelay()).toBeNull()

    t.setVisible(true)
    t.controller.notifyVisible()
    expect(t.controller.state()).toBe('armed')
    t.clock.fire()
    expect(t.rebuilds()).toBe(1)
  })

  // On resume the queued webglcontextlost event and the visibilitychange check
  // both report the same loss, in no guaranteed order. Either order must
  // produce exactly one rebuild.
  it.each([
    ['lost then visible', ['notifyLost', 'notifyVisible']],
    ['visible then lost', ['notifyVisible', 'notifyLost']],
    ['lost twice', ['notifyLost', 'notifyLost']]
  ] as const)('collapses duplicate notifications into one rebuild (%s)', (_name, calls) => {
    const t = setup({ visible: true })
    for (const call of calls) t.controller[call]()
    expect(t.clock.pendingDelay()).toBe(RECOVERY_BACKOFF_MS[0])
    t.clock.fire()
    expect(t.rebuilds()).toBe(1)
  })

  it('walks the backoff sequence across consecutive failures', () => {
    const t = setup({ visible: true })
    t.controller.notifyLost()
    for (const expected of RECOVERY_BACKOFF_MS.slice(0, MAX_RECOVERY_ATTEMPTS - 1)) {
      expect(t.clock.pendingDelay()).toBe(expected)
      t.clock.fire()
      t.controller.notifyAttemptFailed()
    }
    expect(t.rebuilds()).toBe(MAX_RECOVERY_ATTEMPTS - 1)
  })

  it('gives up after the attempt cap instead of retrying forever', () => {
    const t = setup({ visible: true })
    t.controller.notifyLost()
    for (let i = 0; i < MAX_RECOVERY_ATTEMPTS; i++) {
      t.clock.fire()
      t.controller.notifyAttemptFailed()
    }
    expect(t.controller.state()).toBe('fatal')
    expect(t.clock.pendingDelay()).toBeNull()

    // A fatal controller ignores further notifications — no runaway retries.
    t.controller.notifyLost()
    t.controller.notifyVisible()
    expect(t.controller.state()).toBe('fatal')
    expect(t.clock.pendingDelay()).toBeNull()
  })

  it('recovers from fatal via reset', () => {
    const t = setup({ visible: true })
    t.controller.notifyLost()
    for (let i = 0; i < MAX_RECOVERY_ATTEMPTS; i++) {
      t.clock.fire()
      t.controller.notifyAttemptFailed()
    }
    t.controller.reset()
    expect(t.controller.state()).toBe('idle')
    expect(t.controller.attempts()).toBe(0)

    t.controller.notifyLost()
    expect(t.clock.pendingDelay()).toBe(RECOVERY_BACKOFF_MS[0])
  })

  it('holds the attempt count until a rebuilt context has proven stable', () => {
    const t = setup({ visible: true })
    t.controller.notifyLost()
    t.clock.fire()
    t.controller.notifyAttemptFailed()
    t.clock.fire()
    t.controller.notifyAttemptSucceeded()
    expect(t.controller.state()).toBe('idle')
    expect(t.controller.attempts()).toBe(1)

    // Lost again before the stability window elapses: backoff must keep growing
    // rather than restarting, so a flapping context still hits the cap.
    t.controller.notifyLost()
    expect(t.clock.pendingDelay()).toBe(RECOVERY_BACKOFF_MS[1])
  })

  it('zeroes the attempt count once the stability window elapses', () => {
    const t = setup({ visible: true })
    t.controller.notifyLost()
    t.clock.fire()
    t.controller.notifyAttemptFailed()
    t.clock.fire()
    t.controller.notifyAttemptSucceeded()

    expect(t.clock.pendingDelay()).toBe(RECOVERY_STABLE_MS)
    t.clock.fire()
    expect(t.controller.attempts()).toBe(0)

    t.controller.notifyLost()
    expect(t.clock.pendingDelay()).toBe(RECOVERY_BACKOFF_MS[0])
  })

  it('parks instead of retrying when an attempt fails after the page is hidden', () => {
    const t = setup({ visible: true })
    t.controller.notifyLost()
    t.clock.fire()
    t.setVisible(false)
    t.controller.notifyAttemptFailed()
    expect(t.controller.state()).toBe('lost')
    expect(t.clock.pendingDelay()).toBeNull()
  })

  it('stops scheduling while deactivated', () => {
    const t = setup({ visible: true })
    t.controller.notifyLost()
    t.controller.deactivate()
    expect(t.clock.pendingDelay()).toBeNull()
    t.controller.notifyLost()
    expect(t.clock.pendingDelay()).toBeNull()
    expect(t.rebuilds()).toBe(0)
  })

  // React can disconnect a subtree's passive effects and reconnect them later
  // without unmounting the component. A controller that treated deactivate() as
  // permanent would be dead for the rest of the session — which is exactly how
  // the first version of this failed to recover anything.
  it('resumes a pending recovery after a deactivate/activate cycle', () => {
    const t = setup({ visible: true })
    t.controller.notifyLost()
    t.controller.deactivate()
    t.controller.activate()
    expect(t.controller.state()).toBe('armed')
    expect(t.clock.pendingDelay()).toBe(RECOVERY_BACKOFF_MS[0])
    t.clock.fire()
    expect(t.rebuilds()).toBe(1)
  })

  it('accepts new losses again after reactivating', () => {
    const t = setup({ visible: true })
    t.controller.deactivate()
    t.controller.activate()
    t.controller.notifyLost()
    expect(t.controller.state()).toBe('armed')
    t.clock.fire()
    expect(t.rebuilds()).toBe(1)
  })

  it('leaves a healthy controller alone when reactivated', () => {
    const t = setup({ visible: true })
    t.controller.deactivate()
    t.controller.activate()
    expect(t.controller.state()).toBe('idle')
    expect(t.clock.pendingDelay()).toBeNull()
    expect(t.rebuilds()).toBe(0)
  })
})
