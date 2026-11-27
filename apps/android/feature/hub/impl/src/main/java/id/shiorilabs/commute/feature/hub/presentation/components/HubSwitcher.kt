package id.shiorilabs.commute.feature.hub.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.constants.OPERATOR_NAMES
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.components.RoundelSize
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.theme.Slate100
import id.shiorilabs.commute.core.ui.theme.Slate300
import id.shiorilabs.commute.core.ui.theme.Gray500
import id.shiorilabs.commute.core.ui.theme.Gray600
import id.shiorilabs.commute.feature.hub.R
import id.shiorilabs.commute.feature.hub.domain.Heading
import id.shiorilabs.commute.feature.hub.domain.Hub
import id.shiorilabs.commute.feature.hub.domain.HubMember
import id.shiorilabs.commute.feature.hub.domain.directionLabel
import id.shiorilabs.commute.feature.hub.domain.groupByOperator
import id.shiorilabs.commute.feature.hub.domain.headingOf
import id.shiorilabs.commute.feature.hub.domain.isAirportRail
import id.shiorilabs.commute.feature.hub.domain.orderDirections
import id.shiorilabs.commute.feature.hub.domain.resolveMember
import id.shiorilabs.commute.feature.hub.domain.tileLabel
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.sortLineKeysForDisplay

/*
 * A place hub's header, the web's hub-switcher: one tile per operator inline with the title, then a
 * pill per side when that operator's halte is split by direction. No operator logos, which can't
 * be used: a tile is a filled mode glyph plus a short label instead.
 */

private val Amber400 = Color(0xFFFBBF24)

/**
 * Which member of a place hub is showing. Switching operator returns to the side last picked on
 * that operator, so LRT -> BRT -> LRT -> BRT lands back where the rider was rather than on the
 * first side every time.
 */
@Stable
class HubSelection internal constructor(
    val hub: Hub,
    private val memberId: MutableState<String?>,
    private val onChange: State<(HubMember) -> Unit>,
) {
    private val lastByOperator = mutableMapOf<String, String>()

    /** Never null: a place hub has members, and an unknown id falls back to the first. */
    val member: HubMember get() = resolveMember(hub.members, memberId.value) ?: hub.members.first()

    /** The selected member's operator, its sides in pill order. */
    val sides: List<HubMember> get() = orderDirections(hub.members.filter { it.operator == member.operator })

    /** More than one operator: tiles are shown and the operator gets named. */
    val multiOperator: Boolean get() = hub.members.map { it.operator }.distinct().size > 1

    fun selectMember(id: String) {
        hub.members.firstOrNull { it.id == id }?.let(::select)
    }

    fun selectOperator(operator: String) {
        val remembered = lastByOperator[operator]
        val next = hub.members.firstOrNull { it.id == remembered }
            ?: hub.members.firstOrNull { it.operator == operator }
        next?.let(::select)
    }

    private fun select(next: HubMember) {
        lastByOperator[next.operator] = next.id
        memberId.value = next.id
        onChange.value(next)
    }
}

/**
 * The selection for [hub], starting on [initialMemberId] (a `?m=` link, a map tap). A different hub
 * or a new requested member restarts it. [onChange] hears every pick, for the sheet's open-page
 * link to follow.
 */
@Composable
fun rememberHubSelection(
    hub: Hub,
    initialMemberId: String?,
    onChange: (HubMember) -> Unit = {},
): HubSelection {
    // The pick survives rotation and process death; the per-operator memory need not.
    val memberId = rememberSaveable(hub.slug, initialMemberId) { mutableStateOf(initialMemberId) }
    val latestOnChange = rememberUpdatedState(onChange)
    return remember(hub, memberId) { HubSelection(hub, memberId, latestOnChange) }
}

/** The tile row inline with the name, or the name alone for a single operator. */
@Composable
fun HubPlaceTitle(selection: HubSelection, modifier: Modifier = Modifier) {
    val groups = groupByOperator(selection.hub.members)
    // One operator (a directional halte, BRT only) has nothing to switch between: the title stands
    // alone and the Arah pills below do the switching.
    if (groups.size < 2) {
        HubTitle(selection.hub.name, modifier)
        return
    }
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(
            modifier = Modifier.padding(top = 4.dp, end = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            groups.forEach { group ->
                val selected = group.operator == selection.member.operator
                OperatorTile(
                    // The selected operator's tile shows the member actually selected, so its arrow
                    // badge follows the side.
                    member = if (selected) selection.member else group.members.first(),
                    selected = selected,
                    onSelect = { if (!selected) selection.selectOperator(group.operator) },
                )
            }
        }
        HubTitle(selection.hub.name, Modifier.weight(1f))
    }
}

@Composable
private fun HubTitle(name: String, modifier: Modifier = Modifier) {
    // "Soekarno-Hatta" must not wrap at its hyphen, which would leave "Soekarno-" dangling.
    Text(
        text = buildAnnotatedString {
            val phrase = KeepTogether.firstOrNull { it in name }
            if (phrase == null) {
                append(name)
            } else {
                val at = name.indexOf(phrase)
                append(name.substring(0, at))
                append(phrase.replace('-', '‑'))
                append(name.substring(at + phrase.length))
            }
        },
        style = MaterialTheme.typography.titleLarge,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onBackground,
        modifier = modifier.semantics { heading() },
    )
}

private val KeepTogether = listOf("Soekarno-Hatta")

@Composable
private fun OperatorTile(member: HubMember, selected: Boolean, onSelect: () -> Unit) {
    val name = OPERATOR_NAMES[member.operator] ?: member.operator
    val heading = headingOf(member)
    val ink = MaterialTheme.colorScheme.background
    Box(
        modifier = Modifier
            .semantics(mergeDescendants = true) {
                contentDescription = name
                this.selected = selected
            }
            .widthIn(min = 48.dp)
            .heightIn(min = 48.dp)
            .background(
                color = if (selected) MaterialTheme.colorScheme.onBackground else Slate100,
                shape = RoundedCornerShape(12.dp),
            )
            .clickable(role = Role.Tab, onClick = onSelect)
            .padding(horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Icon(
                imageVector = modeIcon(member),
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = if (selected) ink else Gray500,
            )
            Text(
                text = tileLabel(member),
                fontSize = 10.sp,
                lineHeight = 10.sp,
                fontWeight = FontWeight.Bold,
                color = if (selected) ink else Gray500,
            )
        }
        if (heading != null && selected) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = 10.dp, y = (-10).dp)
                    .size(20.dp)
                    .background(MaterialTheme.colorScheme.background, CircleShape)
                    .padding(2.dp)
                    .background(Amber400, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = arrowIcon(heading),
                    contentDescription = null,
                    modifier = Modifier.size(12.dp),
                    tint = Color(0xFF111827),
                )
            }
        }
    }
}

private fun modeIcon(member: HubMember): ImageVector = when {
    isAirportRail(member) -> CommuteIcons.ModeAirportRail
    member.operator == "MRTJ" -> CommuteIcons.ModeSubway
    member.operator == "LRTJ" || member.operator == "LRTJBDB" || member.operator == "APCGK" -> CommuteIcons.ModeTram
    member.operator == "TJ" -> CommuteIcons.ModeBus
    else -> CommuteIcons.ModeRail
}

private fun arrowIcon(heading: Heading): ImageVector = when (heading) {
    Heading.UP -> CommuteIcons.ArrowUp
    Heading.DOWN -> CommuteIcons.ArrowDown
    Heading.LEFT -> CommuteIcons.ArrowLeft
    Heading.RIGHT -> CommuteIcons.ArrowRight
}

/** Operator name, the side pills when split, and the selected member's lines. */
@Composable
fun HubMemberSummary(
    selection: HubSelection,
    lines: Map<String, LineInfo>,
    modifier: Modifier = Modifier,
) {
    val member = selection.member
    val sides = selection.sides
    // Until the dictionary loads there is nothing to draw a roundel with.
    val resolved = sortLineKeysForDisplay(member.lineKeys, member.operator).mapNotNull { lines[it] }
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        // A single-operator hub (a directional halte) needs no naming: it has no tiles to tell
        // apart, and its pills already say what it is.
        if (selection.multiOperator) {
            Text(
                text = OPERATOR_NAMES[member.operator] ?: member.operator,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = Gray600,
            )
        }
        if (sides.size > 1) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                sides.forEach { side ->
                    DirectionPill(side, selected = side.id == member.id, onSelect = { selection.selectMember(side.id) })
                }
            }
        }
        if (resolved.isNotEmpty()) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                resolved.forEach { line ->
                    LineRoundel(
                        code = line.lineCode,
                        color = line.colorCode,
                        operator = line.operator,
                        size = RoundelSize.SM,
                    )
                }
            }
        }
    }
}

@Composable
private fun DirectionPill(member: HubMember, selected: Boolean, onSelect: () -> Unit) {
    val heading = headingOf(member)
    // A right-pointing arrow trails its text, every other leads.
    val trailing = heading == Heading.RIGHT
    val badge: @Composable () -> Unit = {
        if (heading != null) {
            Box(
                modifier = Modifier
                    .size(20.dp)
                    .background(
                        if (selected) Color(0xFF111827) else Slate300,
                        CircleShape,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = arrowIcon(heading),
                    contentDescription = null,
                    modifier = Modifier.size(12.dp),
                    tint = if (selected) Amber400 else Color.White,
                )
            }
        }
    }
    Row(
        modifier = Modifier
            .semantics { this.selected = selected }
            .background(
                color = if (selected) Amber400 else Slate100,
                shape = CircleShape,
            )
            .clickable(role = Role.Tab, onClick = onSelect)
            .padding(
                start = if (trailing) 10.dp else 2.dp,
                end = if (trailing) 2.dp else 10.dp,
                top = 2.dp,
                bottom = 2.dp,
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (!trailing) badge()
        Text(
            text = directionLabel(member).orEmpty(),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Bold,
            color = if (selected) Color(0xFF111827) else Gray500,
        )
        if (trailing) badge()
    }
}
