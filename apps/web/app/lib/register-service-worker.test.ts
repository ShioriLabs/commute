import { describe, expect, it } from 'vitest'
import {
  MAX_RELOADS_PER_SESSION,
  registerServiceWorker,
  UPDATE_THROTTLE_MS,
  type RegistrationLike,
  type ServiceWorkerDeps
} from './register-service-worker'

function setup(overrides: Partial<ServiceWorkerDeps> & { controlled?: boolean } = {}) {
  const controllerHandlers: (() => void)[] = []
  const visibilityHandlers: (() => void)[] = []
  const errors: unknown[] = []
  let reloads = 0
  let updates = 0
  let stored = 0
  let now = 0
  let visible = true

  const registration: RegistrationLike = {
    update: async () => {
      updates++
    }
  }

  const deps: ServiceWorkerDeps = {
    enabled: true,
    register: async () => registration,
    hasController: () => overrides.controlled ?? false,
    onControllerChange: h => controllerHandlers.push(h),
    onVisibilityChange: h => visibilityHandlers.push(h),
    isPageVisible: () => visible,
    reload: () => { reloads++ },
    now: () => now,
    readCount: () => stored,
    writeCount: (value) => { stored = value },
    onError: (error) => { errors.push(error) },
    ...overrides
  }

  registerServiceWorker(deps)

  return {
    errors,
    fireControllerChange: () => controllerHandlers.forEach(h => h()),
    fireVisibilityChange: () => visibilityHandlers.forEach(h => h()),
    advance: (ms: number) => { now += ms },
    setVisible: (value: boolean) => { visible = value },
    reloads: () => reloads,
    updates: () => updates,
    storedCount: () => stored,
    // Registration resolves asynchronously, so tests that depend on it need the
    // microtask queue drained first. A macrotask tick is the simplest way.
    ready: () => new Promise(resolve => setTimeout(resolve, 0))
  }
}

describe('registerServiceWorker', () => {
  it('does nothing when disabled', () => {
    const harness = setup({ enabled: false, controlled: true })
    harness.fireControllerChange()
    expect(harness.reloads()).toBe(0)
  })

  // A first visit installs the worker, which claims the page and fires
  // controllerchange. Reloading there would reload every new user once.
  it('does not reload when the page had no controller at load', () => {
    const harness = setup({ controlled: false })
    harness.fireControllerChange()
    expect(harness.reloads()).toBe(0)
  })

  it('reloads once when a new worker takes over a controlled page', () => {
    const harness = setup({ controlled: true })
    harness.fireControllerChange()
    expect(harness.reloads()).toBe(1)
  })

  it('reloads only once no matter how many times the controller changes', () => {
    const harness = setup({ controlled: true })
    harness.fireControllerChange()
    harness.fireControllerChange()
    harness.fireControllerChange()
    expect(harness.reloads()).toBe(1)
  })

  it('refuses to reload once the per-session budget is spent', () => {
    const harness = setup({ controlled: true, readCount: () => MAX_RELOADS_PER_SESSION })
    harness.fireControllerChange()
    expect(harness.reloads()).toBe(0)
  })

  it('spends one reload from the shared budget', () => {
    const harness = setup({ controlled: true })
    harness.fireControllerChange()
    expect(harness.storedCount()).toBe(1)
  })

  // Storage can throw outright in private mode. No usable guard means no
  // automatic reload, because an unbounded loop is the worse failure.
  it('does not reload when the reload guard is unreadable', () => {
    const harness = setup({
      controlled: true,
      readCount: () => { throw new Error('storage disabled') }
    })
    harness.fireControllerChange()
    expect(harness.reloads()).toBe(0)
  })

  it('checks for an update when the page becomes visible', async () => {
    const harness = setup()
    await harness.ready()
    harness.fireVisibilityChange()
    expect(harness.updates()).toBe(1)
  })

  it('does not check for updates while the page is hidden', async () => {
    const harness = setup()
    await harness.ready()
    harness.setVisible(false)
    harness.fireVisibilityChange()
    expect(harness.updates()).toBe(0)
  })

  it('throttles repeated visibility changes', async () => {
    const harness = setup()
    await harness.ready()

    harness.fireVisibilityChange()
    harness.advance(UPDATE_THROTTLE_MS - 1)
    harness.fireVisibilityChange()
    expect(harness.updates()).toBe(1)

    harness.advance(1)
    harness.fireVisibilityChange()
    expect(harness.updates()).toBe(2)
  })

  it('ignores visibility changes that arrive before registration resolves', () => {
    const harness = setup()
    harness.fireVisibilityChange()
    expect(harness.updates()).toBe(0)
  })

  it('reports a failed registration instead of throwing', async () => {
    const failingRegister = async (): Promise<RegistrationLike> => {
      throw new Error('nope')
    }
    const harness = setup({ register: failingRegister })
    await harness.ready()
    await Promise.resolve()
    expect(harness.errors).toHaveLength(1)
  })
})
