import { Link, type LinkProps } from 'react-router'
import { usePaneStack } from './context'
import { paneUrl, type PaneDescriptor } from './model'

interface PaneLinkProps extends Omit<LinkProps, 'to'> {
  pane: PaneDescriptor
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
 */
export default function PaneLink({ pane, onClick, children, ...rest }: PaneLinkProps) {
  const stack = usePaneStack()

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
        if (stack.push(pane, event.currentTarget)) event.preventDefault()
      }}
      {...rest}
    >
      {children}
    </Link>
  )
}
