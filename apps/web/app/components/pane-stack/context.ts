import { createContext, useContext } from 'react'
import type { PaneDescriptor } from './model'

// Two contexts rather than one, because they change at different rates and have
// different consumers: the api object is stable for the life of the provider and
// is read by links anywhere in the detail content, while the deck slot changes
// on every push and pop and is read only by the cards themselves.

export interface PaneStackApi {
  /** Whether a push would be honoured at all: a provider is mounted and the
   * viewport is desktop-width. Links read this to decide between pushing and
   * navigating, without needing to know either condition. */
  canPush: boolean
  /**
   * Push a card onto the deck. Returns whether it was accepted — `false` means
   * the caller should let its navigation happen instead (the deck is full, an
   * exit is in flight, or it would duplicate the top card).
   *
   * `trigger` is the element that started the push; focus returns to it on pop.
   */
  push: (pane: PaneDescriptor, trigger: HTMLElement | null) => boolean
  /** Remove the top card. */
  pop: () => void
  /** Dismiss the whole surface — every pushed card and the base beneath them. */
  closeAll: () => void
}

// Null default, unlike the noop-controller pattern map-morph.tsx uses: "is there
// a host?" has to be answerable, because station-content and hub-content render
// both inside the map's deck and on their own standalone routes, where their
// links must stay ordinary navigations.
export const PaneStackContext = createContext<PaneStackApi | null>(null)

export function usePaneStack(): PaneStackApi | null {
  return useContext(PaneStackContext)
}

export interface DeckSlot {
  /** How many cards are stacked on top of this one. 0 is the top card. */
  above: number
  /** `base` keeps the map surface's own entrance and dismissal; `pushed` cards
   * arrive from the trailing edge and can be popped. */
  role: 'base' | 'pushed'
  /** Lets a card hand its animated close back to the provider, so the deck can
   * be dismissed as one motion. Without it the provider could only flip `open`
   * off, which unmounts a card outright with no exit animation. Called with
   * `null` when the card stops being the one that answers for this slot. */
  registerClose?: (close: (() => void) | null) => void
  /** Pop this card. Only meaningful for `pushed` cards. */
  onBack?: () => void
  /** Dismiss the entire surface. */
  onCloseAll?: () => void
}

// The base card is the default: a SidePane rendered without a provider (or by a
// provider with an empty stack) behaves exactly as it did before the deck
// existed.
const BASE_SLOT: DeckSlot = { above: 0, role: 'base' }

export const DeckSlotContext = createContext<DeckSlot>(BASE_SLOT)

export function useDeckSlot(): DeckSlot {
  return useContext(DeckSlotContext)
}
