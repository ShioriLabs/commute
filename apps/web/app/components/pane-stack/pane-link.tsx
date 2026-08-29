import { Link, type LinkProps } from 'react-router'
import { usePaneStack } from './context'
import { paneUrl, type PaneDescriptor } from './model'
import { resolveExit } from '~/lib/exit-links'

interface PaneLinkProps extends Omit<LinkProps, 'to'> {
  pane: PaneDescriptor
  /*
   * Runs only when the push is actually accepted — not on a refusal, and not on
   * a modified click that the user meant as a real navigation.
   *
   * `onClick` fires for every one of those, so a side effect that belongs to the
   * card (the map isolating the line the card describes) has to hang here
   * instead, or it would fire while the rider opens a new tab and leave the map
   * changed with nothing on screen accounting for it.
   */
  onPushed?: (pane: PaneDescriptor) => void
}

/**
 * A link that pushes a card onto the map's pane stack when there is one to push
 * onto, and navigates normally when there is not.
 *
 * Deliberately a real `<Link>` rather than a button: station-content and
 * hub-content render on their own standalone routes as well as inside the map's
 * deck, and on those routes — and on phones, where there is no deck — this has
 * to be an ordinary navigation. Keeping the `<a href>` also keeps ⌘-click,
 * middle-click and "copy link address" working even when a push is available.
 *
 * In the lite build every pane target is off-surface: station and timetable
 * pages are not hosted there (see app/lib/exit-links.ts), so pushing one onto
 * the deck would open a card the bundle cannot fill. Those become plain
 * anchors to the full app instead, which is what ExitLink does everywhere else.
 * Rollup folds the check away in the normal build.
 */
export default function PaneLink({ pane, onClick, onPushed, children, ...rest }: PaneLinkProps) {
  const stack = usePaneStack()
  const exit = resolveExit(paneUrl(pane))

  if (exit.kind === 'external') {
    return (
      <a href={exit.href} target="_blank" rel="noopener" {...rest}>
        {children}
      </a>
    )
  }

  return (
    <Link
      to={paneUrl(pane)}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        if (!stack?.canPush) return
        // Anything but a plain left click means the user asked for a real
        // navigation — a new tab, a new window, a download.
        if (event.button !== 0) return
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        // A refused push (deck full, exit in flight, duplicate) falls through to
        // the navigation, so this is never a dead click.
        if (stack.push(pane, event.currentTarget)) {
          event.preventDefault()
          onPushed?.(pane)
        }
      }}
      {...rest}
    >
      {children}
    </Link>
  )
}
