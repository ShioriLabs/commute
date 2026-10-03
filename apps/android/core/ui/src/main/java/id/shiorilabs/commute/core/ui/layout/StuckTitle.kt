package id.shiorilabs.commute.core.ui.layout

import kotlin.math.min

/**
 * Where a section's title row sits in a list's layout: a station's name on the home feed, a line's
 * header in a timetable. [offset] is in the list's content coordinates: 0 is the top of the content.
 */
data class TitleSlot(
    val index: Int,
    val offset: Int,
)

/**
 * The title the bar over the list shows: the section whose title row is [index], with the bar
 * moved up by [pushOffset] (zero or negative) while the next section's title pushes it out.
 */
data class StuckTitle(
    val index: Int,
    val pushOffset: Int,
)

/**
 * Which section the list is scrolled into, and how far the next one is pushing its title out: the
 * rules of a sticky header, worked out from the list's layout so the bar can be drawn over the list
 * rather than in it, where it can be frosted over what passes beneath.
 *
 * The current section is the last whose title has reached the top of the content. When none of the
 * titles on screen has, it is the last one above the first visible row, scrolled off with its rows
 * still showing. The next title starts pushing once it is within [titleHeight] of the top.
 *
 * @param visibleTitles title rows on screen.
 * @param titleIndices every title row's index in the list, in order.
 * @param firstVisibleIndex the index of the first row on screen.
 * @param titleHeight the height of the bar's title.
 */
fun stuckTitle(
    visibleTitles: List<TitleSlot>,
    titleIndices: List<Int>,
    firstVisibleIndex: Int,
    titleHeight: Int,
): StuckTitle? {
    val current = visibleTitles.filter { it.offset <= 0 }.maxByOrNull { it.index }?.index
        ?: titleIndices.lastOrNull { it <= firstVisibleIndex }
        ?: return null
    val next = visibleTitles.filter { it.index > current }.minByOrNull { it.index }
    val push = next?.let { min(0, it.offset - titleHeight) } ?: 0
    return StuckTitle(current, push)
}
