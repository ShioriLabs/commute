import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useIsDesktop } from '~/hooks/is-desktop'
import { DeckSlotContext, PaneStackContext, type DeckSlot, type PaneStackApi } from './context'
import PaneCard from './pane-content'
import { canPush, MAX_PANE_STACK_DEPTH, paneKey, paneUrl, type PaneDescriptor } from './model'

// Identifies a history entry as one of ours. Module scope so ids stay unique
// across remounts — the same reason sheet-button.tsx keeps its sheetEntrySeq
// here rather than in a ref.
let paneEntrySeq = 0

interface PaneEntry {
  /** Also the id stamped on this entry's history state. */
  id: number
  pane: PaneDescriptor
  key: string
  /** Exit animation in flight. The card is still mounted but no longer counts
   * toward the deck depth, so the card underneath starts moving forward in the
   * same commit the exit begins. */
  exiting: boolean
  /** The card's own animated close, handed back via the deck slot. */
  close: (() => void) | null
  /** What to focus once this card is gone. */
  returnFocus: HTMLElement | null
}

interface PaneStackProviderProps {
  /**
   * Identity of the map's current base selection (`station:KCI/MRI`,
   * `hub:dukuh-atas`, or `null` when nothing is selected). Any change means the
   * thing the deck was built on top of is gone, so the deck collapses. One prop
   * covers both "base card dismissed" and "a different marker was tapped".
   */
  baseKey: string | null
  children: ReactNode
}

/**
 * Hosts the cards pushed on top of the map's detail surface.
 *
 * The base card is not owned here — it stays driven by the map's own
 * `selectedStation` / `selectedHubSlug` state, so the spotlight, fly-to and
 * chrome logic in map.tsx are untouched. This owns only what sits above it.
 */
export default function PaneStackProvider({ baseKey, children }: PaneStackProviderProps) {
  const isDesktop = useIsDesktop()
  const [entries, setEntries] = useState<PaneEntry[]>([])

  // Mirror of `entries` that is correct *during* an event handler. React batches,
  // so two clicks in one frame would both read a stale `entries` and push twice —
  // the same failure sheet-button.tsx's isOpenRef guard documents, except here it
  // would strand a duplicate history entry as well as a duplicate card.
  const entriesRef = useRef<PaneEntry[]>(entries)
  const commit = useCallback((next: PaneEntry[]) => {
    entriesRef.current = next
    setEntries(next)
  }, [])

  // The base card's animated close, so closeAll can dismiss the whole deck as
  // one motion instead of yanking the base out from under a pushed card.
  const baseCloseRef = useRef<(() => void) | null>(null)
  const registerBaseClose = useCallback((close: (() => void) | null) => {
    baseCloseRef.current = close
  }, [])

  // A pop is waiting on an exit animation to land before it touches history.
  // Holds the id of the entry whose history entry we still owe the browser.
  const pendingBackRef = useRef<number | null>(null)
  // A popstate we caused ourselves and should not react to.
  const selfPopRef = useRef(false)

  const isDesktopRef = useRef(isDesktop)
  useEffect(() => {
    isDesktopRef.current = isDesktop
  })

  // Pop this entry's history entry, if it is still ours to pop.
  const runPendingBack = useCallback(() => {
    const id = pendingBackRef.current
    if (id === null) return
    pendingBackRef.current = null

    // Ownership check, lifted from sheet-button.tsx's runPendingBack. A
    // react-router navigation from inside the card (the "open full page" link,
    // or a departure pick heading to /fare) rewrites the entry we pushed. Popping
    // blind would then take a step that belongs to someone else.
    if (window.history.state?.paneEntryId !== id) return

    selfPopRef.current = true
    window.history.back()
  }, [])

  const push = useCallback((pane: PaneDescriptor, trigger: HTMLElement | null) => {
    if (!isDesktopRef.current) return false
    if (!canPush(entriesRef.current, pane)) return false

    const id = ++paneEntrySeq
    window.history.pushState(
      {
        ...window.history.state,
        // react-router tracks its history position in `state.idx` and computes
        // the next one as `getIndex() + 1`. Omitting it here leaves the index
        // NaN for any router-driven navigation made from inside the card, which
        // is reachable via the card's own "open full page" link.
        idx: (window.history.state?.idx ?? 0) + 1,
        paneEntryId: id
      },
      '',
      paneUrl(pane)
    )

    commit([...entriesRef.current, {
      id,
      pane,
      key: paneKey(pane),
      exiting: false,
      close: null,
      returnFocus: trigger
    }])
    return true
  }, [commit])

  // Start the exit for every entry at or above `from`, and note that we owe the
  // browser a step back. Returns false if there was nothing live to dismiss.
  const beginExit = useCallback((from: number) => {
    const live = entriesRef.current.filter(entry => !entry.exiting)
    if (live.length === 0) return false

    const doomed = entriesRef.current.slice(from)
    commit(entriesRef.current.map((entry, i) => (i >= from ? { ...entry, exiting: true } : entry)))
    // Deliberately after the commit: `close()` schedules onClose on a timer, and
    // the card underneath needs the new depth in the same frame the exit starts
    // so the two motions read as one.
    doomed.forEach(entry => entry.close?.())

    // Every pushed entry sits directly on the map's own history entry (see
    // MAX_PANE_STACK_DEPTH), so one step back always lands there.
    pendingBackRef.current = doomed[0]?.id ?? null
    return true
  }, [commit])

  const pop = useCallback(() => {
    beginExit(entriesRef.current.length - 1)
  }, [beginExit])

  const closeAll = useCallback(() => {
    // Pushed cards and the base leave together. If there is nothing pushed this
    // is just the base card's own dismissal.
    beginExit(0)
    baseCloseRef.current?.()
  }, [beginExit])

  // A card finished animating out: drop it, restore focus, and only then touch
  // history. Calling history.back() any earlier lets react-router process its POP
  // while the leave transition is starting and stomp it — with a route this size
  // underneath, that re-render is not something to run mid-animation.
  // Stable across renders so the card's registration effect does not re-run on
  // every commit. Writing onto the entry rather than into state on purpose: the
  // close handle is machinery, and putting it in state would re-render the deck
  // every time a card mounted.
  const registerCardClose = useCallback((id: number, close: (() => void) | null) => {
    const target = entriesRef.current.find(candidate => candidate.id === id)
    if (target) target.close = close
  }, [])

  const handleCardClosed = useCallback((id: number) => {
    const entry = entriesRef.current.find(candidate => candidate.id === id)
    commit(entriesRef.current.filter(candidate => candidate.id !== id))

    const target = entry?.returnFocus
    if (target?.isConnected) target.focus()

    if (entriesRef.current.every(candidate => !candidate.exiting)) runPendingBack()
  }, [commit, runPendingBack])

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      // Our own deferred back() landing. Nothing to reconcile.
      if (selfPopRef.current) {
        selfPopRef.current = false
        return
      }

      if (pendingBackRef.current !== null) {
        // The user pressed Back while an exit was still animating. That press
        // already consumed the entry we were going to pop, so firing ours too
        // would take a second step the user never asked for.
        pendingBackRef.current = null
        return
      }

      const live = entriesRef.current.filter(entry => !entry.exiting)
      if (live.length === 0) return

      // Still on our own entry — a forward press back onto the open card.
      if (event.state?.paneEntryId === live[live.length - 1].id) return

      // Back out of the card. The browser has already moved history, so this
      // only animates. Deferred a tick so react-router's POP re-render, which
      // happens in this same popstate, commits before the leave starts.
      window.setTimeout(() => {
        const stillLive = entriesRef.current.filter(entry => !entry.exiting)
        if (stillLive.length === 0) return
        commit(entriesRef.current.map(entry => ({ ...entry, exiting: true })))
        stillLive.forEach(entry => entry.close?.())
        pendingBackRef.current = null
      }, 0)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [commit])

  // The base selection changed or went away: whatever was stacked on it no
  // longer has anything to sit on. Covers the base card being dismissed and a
  // different marker being tapped, both of which run through map.tsx's existing
  // selection state without needing a callback of their own.
  const previousBaseKey = useRef(baseKey)
  useEffect(() => {
    if (previousBaseKey.current === baseKey) return
    previousBaseKey.current = baseKey
    beginExit(0)
  }, [baseKey, beginExit])

  // Crossing below the desktop breakpoint swaps SidePane out for BottomSheet,
  // which has no notion of a deck. Collapse rather than leave orphaned cards and
  // history entries behind; the base selection survives the swap and reappears
  // in the sheet, which is the documented behaviour of that crossing.
  useEffect(() => {
    if (isDesktop) return
    beginExit(0)
  }, [isDesktop, beginExit])

  useEffect(() => () => {
    // Never fire a deferred back() from a cleanup: an unmount here means a real
    // navigation away, which is exactly when popping would be wrong.
    pendingBackRef.current = null
  }, [])

  const liveCount = entries.filter(entry => !entry.exiting).length

  const api = useMemo<PaneStackApi>(() => ({
    canPush: isDesktop,
    push,
    pop,
    closeAll
  }), [isDesktop, push, pop, closeAll])

  const baseSlot = useMemo<DeckSlot>(() => ({
    above: Math.min(liveCount, MAX_PANE_STACK_DEPTH),
    role: 'base',
    registerClose: registerBaseClose,
    onCloseAll: closeAll
  }), [liveCount, registerBaseClose, closeAll])

  return (
    <PaneStackContext.Provider value={api}>
      {/* Base card first: all cards are `fixed z-30` siblings, so DOM order is
          what paints one over another. Do not reorder. */}
      <DeckSlotContext.Provider value={baseSlot}>
        {children}
      </DeckSlotContext.Provider>
      {entries.map((entry, index) => (
        <PaneSlot
          key={entry.id}
          entry={entry}
          above={Math.min(liveCount - 1 - index, MAX_PANE_STACK_DEPTH)}
          onBack={pop}
          onCloseAll={closeAll}
          onClosed={handleCardClosed}
          onRegisterClose={registerCardClose}
        />
      ))}
    </PaneStackContext.Provider>
  )
}

interface PaneSlotProps {
  entry: PaneEntry
  above: number
  onBack: () => void
  onCloseAll: () => void
  onClosed: (id: number) => void
  onRegisterClose: (id: number, close: (() => void) | null) => void
}

function PaneSlot({ entry, above, onBack, onCloseAll, onClosed, onRegisterClose }: PaneSlotProps) {
  const id = entry.id
  const registerClose = useCallback(
    (close: (() => void) | null) => onRegisterClose(id, close),
    [onRegisterClose, id]
  )
  const handleClose = useCallback(() => onClosed(id), [onClosed, id])

  const slot = useMemo<DeckSlot>(() => ({
    above: Math.max(above, 0),
    role: 'pushed',
    registerClose,
    onBack,
    onCloseAll
  }), [above, registerClose, onBack, onCloseAll])

  return (
    <DeckSlotContext.Provider value={slot}>
      <PaneCard pane={entry.pane} onClose={handleClose} />
    </DeckSlotContext.Provider>
  )
}
