import { useIsDesktop } from '~/hooks/is-desktop'
import BottomSheet, { type BottomSheetProps } from './bottom-sheet'
import SidePane from './side-pane'

// The map's detail surface: a bottom sheet on phones, a floating left card on
// desktop. Both take the same props, so callers describe the content and let
// this choose the shape.
//
// Crossing the breakpoint while open swaps the component: the old surface
// unmounts without reporting a close (the selection and its spotlight persist)
// and the new one plays its own entrance, so the detail reappears in the other
// form.
export default function DetailSurface(props: BottomSheetProps) {
  const isDesktop = useIsDesktop()
  return isDesktop ? <SidePane {...props} /> : <BottomSheet {...props} />
}
