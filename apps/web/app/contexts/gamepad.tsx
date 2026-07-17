import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

// Standard Gamepad mapping button indices.
// https://w3c.github.io/gamepad/#remapping
const BUTTON = {
  A: 0,
  B: 1,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15
} as const

// Left stick axes.
const AXIS_LX = 0
const AXIS_LY = 1
// Sticks rest near 0 but never exactly; ignore anything inside the deadzone.
const STICK_DEADZONE = 0.15
// Triggers likewise can rest at a small nonzero value on some pads.
const TRIGGER_DEADZONE = 0.05

// D-pad / face-button repeat: press fires immediately, then holds pause before
// auto-repeating (initial delay), then repeat at a steady interval — the usual
// key-repeat feel.
const REPEAT_INITIAL_MS = 400
const REPEAT_INTERVAL_MS = 120

export type GamepadDirection = 'up' | 'down' | 'left' | 'right'

// A bottom sheet's snap positions, biggest to smallest. Mirrors SnapState in
// bottom-sheet.tsx (kept as a local type to avoid a component→context import).
export type SheetSnap = 'closed' | 'peek' | 'full'

// Imperative handle a BottomSheet registers so the gamepad layer can snap it
// with the D-pad. The active sheet (if any) is stored on the context.
export interface GamepadSheetHandle {
  snapTo: (snap: SheetSnap) => void
  getSnap: () => SheetSnap
}

// Semantic, surface-agnostic actions the input layer emits. Analog pan/zoom is
// NOT an action — it's read from refs by the map (see pan/zoom below).
export type GamepadAction
  = { type: 'move', direction: GamepadDirection }
    | { type: 'activate' }
    | { type: 'back' }
    | { type: 'tab', direction: 'prev' | 'next' }

type ActionListener = (action: GamepadAction) => void

interface GamepadContextType {
  connected: boolean
  // Subscribe to semantic actions. Returns an unsubscribe. Using a listener set
  // (rather than state) keeps per-frame input from re-rendering the whole app.
  subscribe: (listener: ActionListener) => () => void
  // Live analog channels, read imperatively each frame by the map route. `pan`
  // is the left-stick vector (-1..1, deadzoned); `zoom` is the trigger axis
  // (RT positive = zoom in, LT positive = zoom out).
  pan: React.RefObject<{ x: number, y: number }>
  zoom: React.RefObject<number>
  // Fire controller rumble if the pad supports it (guarded — many don't).
  rumble: (durationMs?: number, strength?: number) => void
  // The currently-open bottom sheet's handle (or null). The focus hook reads
  // this to route D-pad up/down to sheet snapping; sheets register/unregister
  // themselves via registerSheet.
  activeSheet: React.RefObject<GamepadSheetHandle | null>
  registerSheet: (handle: GamepadSheetHandle | null) => void
}

const noopUnsub = () => {}

const GamepadContext = createContext<GamepadContextType>({
  connected: false,
  subscribe: () => noopUnsub,
  pan: { current: { x: 0, y: 0 } },
  zoom: { current: 0 },
  rumble: () => {},
  activeSheet: { current: null },
  registerSheet: () => {}
})

// Per-button repeat bookkeeping: the timestamp at which this held button may
// next emit. Keyed by button index.
interface RepeatState {
  nextFireAt: number
}

export function GamepadProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false)

  const listenersRef = useRef<Set<ActionListener>>(new Set())
  const panRef = useRef<{ x: number, y: number }>({ x: 0, y: 0 })
  const zoomRef = useRef(0)
  const activeSheetRef = useRef<GamepadSheetHandle | null>(null)

  // Repeat state per repeatable input (D-pad + LB/RB shoulder "tab" buttons).
  const repeatRef = useRef<Map<number, RepeatState>>(new Map())
  // Previous frame's pressed state for edge detection of one-shot buttons (A/B).
  const prevPressedRef = useRef<Map<number, boolean>>(new Map())
  const rafRef = useRef(0)

  // The single poll loop — only runs while a pad is connected (see effect).
  useEffect(() => {
    if (!connected) return

    const emit = (action: GamepadAction) => {
      for (const listener of listenersRef.current) listener(action)
    }

    const repeat = repeatRef.current
    const prevPressed = prevPressedRef.current

    // Handle a repeatable directional/tab button: emit on the initial press,
    // then again after the initial delay, then at the repeat interval.
    const handleRepeatable = (index: number, now: number, action: GamepadAction) => {
      const state = repeat.get(index)
      if (!state) {
        repeat.set(index, { nextFireAt: now + REPEAT_INITIAL_MS })
        emit(action)
      } else if (now >= state.nextFireAt) {
        state.nextFireAt = now + REPEAT_INTERVAL_MS
        emit(action)
      }
    }

    // Handle a one-shot button: emit only on the rising edge (press, not hold).
    const handleOneShot = (index: number, pressed: boolean, action: GamepadAction) => {
      const was = prevPressed.get(index) ?? false
      if (pressed && !was) emit(action)
      prevPressed.set(index, pressed)
    }

    const tick = () => {
      const now = performance.now()
      // Chromium requires re-reading getGamepads() each frame; the snapshot is
      // frozen at call time. Use the first connected pad.
      const pads = navigator.getGamepads()
      const pad = pads.find((p): p is Gamepad => p !== null && p.connected)

      if (pad) {
        const pressed = (i: number) => pad.buttons[i]?.pressed ?? false

        // Repeatable: D-pad → move, shoulders → tab. Clear repeat state when
        // released so the next press fires immediately again.
        const repeatable: Array<[number, GamepadAction]> = [
          [BUTTON.DPAD_UP, { type: 'move', direction: 'up' }],
          [BUTTON.DPAD_DOWN, { type: 'move', direction: 'down' }],
          [BUTTON.DPAD_LEFT, { type: 'move', direction: 'left' }],
          [BUTTON.DPAD_RIGHT, { type: 'move', direction: 'right' }],
          [BUTTON.LB, { type: 'tab', direction: 'prev' }],
          [BUTTON.RB, { type: 'tab', direction: 'next' }]
        ]
        for (const [index, action] of repeatable) {
          if (pressed(index)) handleRepeatable(index, now, action)
          else repeat.delete(index)
        }

        // One-shot: A → activate, B → back.
        handleOneShot(BUTTON.A, pressed(BUTTON.A), { type: 'activate' })
        handleOneShot(BUTTON.B, pressed(BUTTON.B), { type: 'back' })

        // Analog channels (deadzoned). Read imperatively by the map.
        const ax = pad.axes[AXIS_LX] ?? 0
        const ay = pad.axes[AXIS_LY] ?? 0
        panRef.current = {
          x: Math.abs(ax) < STICK_DEADZONE ? 0 : ax,
          y: Math.abs(ay) < STICK_DEADZONE ? 0 : ay
        }
        // Triggers report 0..1 (buttons 6/7). RT zooms in, LT zooms out.
        const rt = pad.buttons[BUTTON.RT]?.value ?? 0
        const lt = pad.buttons[BUTTON.LT]?.value ?? 0
        const z = rt - lt
        zoomRef.current = Math.abs(z) < TRIGGER_DEADZONE ? 0 : z
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafRef.current)
      repeat.clear()
      prevPressed.clear()
      panRef.current = { x: 0, y: 0 }
      zoomRef.current = 0
    }
  }, [connected])

  // Activation: flip `connected` from gamepadconnected/disconnected. We also
  // check on mount in case a pad was already connected before we listened.
  useEffect(() => {
    const sync = () => {
      const anyConnected = navigator.getGamepads().some(p => p !== null && p.connected)
      setConnected(anyConnected)
    }

    window.addEventListener('gamepadconnected', sync)
    window.addEventListener('gamepaddisconnected', sync)
    sync()

    return () => {
      window.removeEventListener('gamepadconnected', sync)
      window.removeEventListener('gamepaddisconnected', sync)
    }
  }, [])

  const subscribe = useCallback((listener: ActionListener) => {
    listenersRef.current.add(listener)
    return () => {
      listenersRef.current.delete(listener)
    }
  }, [])

  const rumble = useCallback((durationMs = 80, strength = 0.5) => {
    const pad = navigator.getGamepads().find((p): p is Gamepad => p !== null && p.connected)
    // vibrationActuator is non-standard/experimental and absent on many pads.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actuator = (pad as any)?.vibrationActuator
    if (!actuator?.playEffect) return
    try {
      actuator.playEffect('dual-rumble', {
        duration: durationMs,
        strongMagnitude: strength,
        weakMagnitude: strength
      })
    } catch {
      // ignore — best-effort feedback only
    }
  }, [])

  const registerSheet = useCallback((handle: GamepadSheetHandle | null) => {
    activeSheetRef.current = handle
  }, [])

  const value = useMemo(
    () => ({
      connected,
      subscribe,
      pan: panRef,
      zoom: zoomRef,
      rumble,
      activeSheet: activeSheetRef,
      registerSheet
    }),
    [connected, subscribe, rumble, registerSheet]
  )

  return <GamepadContext.Provider value={value}>{children}</GamepadContext.Provider>
}

export function useGamepad() {
  const context = useContext(GamepadContext)

  if (context === undefined) {
    throw new Error('useGamepad must be used within a GamepadProvider')
  }

  return context
}
