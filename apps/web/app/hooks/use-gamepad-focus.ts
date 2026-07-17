import { useEffect } from 'react'
import { haptic } from 'utils/haptics'
import { useGamepad, type GamepadAction, type GamepadDirection, type GamepadSheetHandle } from '~/contexts/gamepad'

// Everything the gamepad can move focus to. Extends the interactive-element
// probe used in bottom-sheet.tsx (button, a, input, [role="button"]) to the
// full focusable set.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[role="button"]:not([aria-disabled="true"])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

// A candidate must not be perpendicular-only offset by more than this multiple
// of its primary-axis distance, or it's off to the side rather than "in that
// direction". Standard spatial-navigation guard.
const PERPENDICULAR_PENALTY = 2

function isVisible(el: HTMLElement): boolean {
  // offsetParent is null for display:none (and position:fixed, hence the rect
  // fallback). A zero-area rect means collapsed/hidden.
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return false
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false
  return true
}

// When a Headless UI Dialog is open it traps focus inside its panel; scope the
// query there so we don't move focus to elements behind the backdrop. The panel
// is the [role="dialog"] node (search/fare/settings sheets). Custom BottomSheet
// is also role="dialog", so this covers both.
function getScope(): ParentNode {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]')
  // Last one in the DOM is the topmost open dialog.
  const top = dialogs[dialogs.length - 1]
  return top ?? document
}

function getFocusables(scope: ParentNode): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible)
}

interface Point {
  x: number
  y: number
}

function center(el: HTMLElement): Point {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

// Score a candidate for movement in `direction` from `origin`. Lower is better;
// null means the candidate is not in that direction at all.
function score(origin: Point, target: Point, direction: GamepadDirection): number | null {
  const dx = target.x - origin.x
  const dy = target.y - origin.y

  let primary: number
  let perpendicular: number
  switch (direction) {
    case 'up':
      if (dy >= 0) return null
      primary = -dy
      perpendicular = Math.abs(dx)
      break
    case 'down':
      if (dy <= 0) return null
      primary = dy
      perpendicular = Math.abs(dx)
      break
    case 'left':
      if (dx >= 0) return null
      primary = -dx
      perpendicular = Math.abs(dy)
      break
    case 'right':
      if (dx <= 0) return null
      primary = dx
      perpendicular = Math.abs(dy)
      break
  }

  // Reject candidates that are mostly off to the side.
  if (perpendicular > primary * PERPENDICULAR_PENALTY) return null
  // Primary distance dominates; perpendicular offset breaks ties toward
  // straight-ahead elements.
  return primary + perpendicular * PERPENDICULAR_PENALTY
}

function isTextInput(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA') return true
  if (tag !== 'INPUT') return false
  // Buttons, checkboxes etc. are INPUTs but not "typing" targets.
  const type = (el as HTMLInputElement).type
  return !['button', 'submit', 'checkbox', 'radio', 'range', 'reset', 'color'].includes(type)
}

// Move focus within the nearest chip row / segmented switcher (role="group" or
// a run of aria-pressed toggles). Returns true if it handled the tab.
function tabWithinGroup(direction: 'prev' | 'next'): boolean {
  const active = document.activeElement as HTMLElement | null
  if (!active) return false
  const group = active.closest('[role="group"]')
  if (!group) return false
  const items = getFocusables(group)
  const index = items.indexOf(active)
  if (index === -1) return false
  const next = direction === 'next' ? index + 1 : index - 1
  if (next < 0 || next >= items.length) return true // stay put at the ends
  items[next].focus()
  haptic()
  return true
}

// Close the topmost surface: a registered BottomSheet (no key handler of its
// own) is snapped shut directly; a Headless UI Dialog closes on a single Escape
// (its listener is on the document, which the event bubbles to); otherwise go
// back in history.
function goBack(sheet: GamepadSheetHandle | null) {
  if (sheet && sheet.getSnap() !== 'closed') {
    sheet.snapTo('closed')
    return
  }
  const dialog = document.querySelector('[role="dialog"]')
  if (dialog) {
    dialog.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
    return
  }
  window.history.back()
}

/**
 * Drives DOM focus from gamepad actions. Mount once, under GamepadProvider.
 * D-pad moves the focus ring spatially, A activates, B goes back/closes, LB/RB
 * cycle chip rows. When a bottom sheet is open, D-pad up/down snaps it instead
 * of moving focus.
 */
export function useGamepadFocus() {
  const { connected, subscribe, activeSheet, rumble } = useGamepad()

  useEffect(() => {
    if (!connected) return

    // Pick the best focusable in `direction` from `origin` (excluding `except`).
    const bestInDirection = (
      focusables: HTMLElement[],
      origin: Point,
      direction: GamepadDirection,
      except: HTMLElement | null
    ): HTMLElement | null => {
      let best: HTMLElement | null = null
      let bestScore = Infinity
      for (const el of focusables) {
        if (el === except) continue
        const s = score(origin, center(el), direction)
        if (s !== null && s < bestScore) {
          bestScore = s
          best = el
        }
      }
      return best
    }

    // Snap the open bottom sheet in the given vertical direction. Returns true
    // if it did anything.
    const snapSheet = (direction: 'up' | 'down'): boolean => {
      const sheet = activeSheet.current
      if (!sheet) return false
      const snap = sheet.getSnap()
      if (direction === 'up') {
        if (snap === 'full') return false
        sheet.snapTo('full')
      } else {
        sheet.snapTo(snap === 'full' ? 'peek' : 'closed')
      }
      haptic()
      return true
    }

    const move = (direction: GamepadDirection) => {
      const active = document.activeElement as HTMLElement | null

      // Don't hijack left/right arrows while typing in a text field.
      if (isTextInput(active) && (direction === 'left' || direction === 'right')) return

      const scope = getScope()
      const focusables = getFocusables(scope)

      // With nothing focused in-scope, seed focus: the directionally-nearest
      // candidate from the pointer-less "edge" the user is moving away from,
      // falling back to the first focusable if none scores. Preserves the
      // pressed direction instead of always jumping to focusables[0].
      if (focusables.length > 0 && (!active || !focusables.includes(active))) {
        // Anchor the search at the viewport edge opposite the travel direction
        // so e.g. pressing "up" seeds from the bottom and finds the lowest item.
        const w = window.innerWidth
        const h = window.innerHeight
        const seed: Point
          = direction === 'up'
            ? { x: w / 2, y: h }
            : direction === 'down'
              ? { x: w / 2, y: 0 }
              : direction === 'left'
                ? { x: w, y: h / 2 }
                : { x: 0, y: h / 2 }
        const best = bestInDirection(focusables, seed, direction, null)
        ;(best ?? focusables[0]).focus()
        return
      }

      // Focus is in-scope: try to move it spatially first.
      if (active && focusables.includes(active)) {
        const best = bestInDirection(focusables, center(active), direction, active)
        if (best) {
          best.focus()
          return
        }
      }

      // No candidate in that direction. If a bottom sheet is open and we're
      // moving vertically, use up/down to snap it (so you can expand/collapse
      // once focus has reached the top/bottom of the content).
      if (direction === 'up' || direction === 'down') snapSheet(direction)
    }

    const listener = (action: GamepadAction) => {
      switch (action.type) {
        case 'move':
          move(action.direction)
          break
        case 'activate': {
          const active = document.activeElement as HTMLElement | null
          if (active && active !== document.body) {
            active.click()
            rumble(60, 0.4)
            haptic()
          }
          break
        }
        case 'back':
          goBack(activeSheet.current)
          rumble(50, 0.3)
          break
        case 'tab':
          if (!tabWithinGroup(action.direction)) {
            // Fall back to plain spatial left/right.
            move(action.direction === 'next' ? 'right' : 'left')
          }
          break
      }
    }

    return subscribe(listener)
  }, [connected, subscribe, activeSheet, rumble])
}
