package id.shiorilabs.commute.feature.journey.presentation.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.feature.journey.R
import id.shiorilabs.commute.feature.journey.domain.Departure
import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.Modes
import id.shiorilabs.commute.feature.journey.domain.PaymentMethod
import id.shiorilabs.commute.feature.journey.domain.WalkingSpeed
import id.shiorilabs.commute.feature.journey.domain.formatDepartureLabel
import java.time.Instant

/** Which criteria sheet is up; one at a time, so the list closing as a setting opens is one change. */
internal enum class OpenCriterion { ALL, DEPARTURE, PAYMENT, MODES, WALKING }

@Composable
internal fun PaymentMethod.label(): String = stringResource(
    when (this) {
        PaymentMethod.STORED_VALUE -> R.string.journey_payment_stored_value
        PaymentMethod.QRIS_TAP -> R.string.journey_payment_qris
    },
)

@Composable
internal fun PaymentMethod.shortLabel(): String = stringResource(
    when (this) {
        PaymentMethod.STORED_VALUE -> R.string.journey_payment_stored_value_short
        PaymentMethod.QRIS_TAP -> R.string.journey_payment_qris_short
    },
)

@Composable
internal fun PaymentMethod.description(): String = stringResource(
    when (this) {
        PaymentMethod.STORED_VALUE -> R.string.journey_payment_stored_value_description
        PaymentMethod.QRIS_TAP -> R.string.journey_payment_qris_description
    },
)

@Composable
internal fun Modes.label(): String = stringResource(
    when (this) {
        Modes.ALL -> R.string.journey_modes_all
        Modes.RAIL -> R.string.journey_modes_rail
    },
)

@Composable
internal fun Modes.description(): String = stringResource(
    when (this) {
        Modes.ALL -> R.string.journey_modes_all_description
        Modes.RAIL -> R.string.journey_modes_rail_description
    },
)

@Composable
internal fun WalkingSpeed.label(): String = stringResource(
    when (this) {
        WalkingSpeed.BRISK -> R.string.journey_walking_brisk
        WalkingSpeed.AVERAGE -> R.string.journey_walking_average
        WalkingSpeed.SLOW -> R.string.journey_walking_slow
        WalkingSpeed.SLOWEST -> R.string.journey_walking_slowest
    },
)

/** One word, for the chip: "Pelan banget" loses its intensifier there. */
@Composable
internal fun WalkingSpeed.shortLabel(): String =
    if (this == WalkingSpeed.SLOWEST) stringResource(R.string.journey_walking_slowest_short) else label()

@Composable
internal fun WalkingSpeed.description(): String = stringResource(
    when (this) {
        WalkingSpeed.BRISK -> R.string.journey_walking_brisk_description
        WalkingSpeed.AVERAGE -> R.string.journey_walking_average_description
        WalkingSpeed.SLOW -> R.string.journey_walking_slow_description
        WalkingSpeed.SLOWEST -> R.string.journey_walking_slowest_description
    },
)

/**
 * The settings under the Dari/Ke fields: one segmented chip showing what each standing setting is
 * set to, a segment tinted only when it is off its default, and the departure on the right. Each
 * opens a sheet. The web's `CriteriaBar`.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun CriteriaBar(
    criteria: JourneyCriteria,
    now: Instant,
    onChange: (JourneyCriteria) -> Unit,
    modifier: Modifier = Modifier,
) {
    var open by rememberSaveable { mutableStateOf<OpenCriterion?>(null) }
    val defaults = JourneyCriteria()
    val haptics = LocalHapticFeedback.current
    val openSheet = { criterion: OpenCriterion ->
        haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
        open = criterion
    }

    // Wraps rather than squeezes: truncating a departure would drop its day, the one thing that
    // tells two journeys apart.
    FlowRow(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        val settingsDescription = stringResource(
            R.string.journey_settings_description,
            criteria.paymentMethod.label(),
            criteria.modes.label(),
            criteria.walking.label(),
        )
        Row(
            modifier = Modifier
                .height(IntrinsicSize.Min)
                .clip(CircleShape)
                .background(Color.White)
                .border(2.dp, Stone200, CircleShape)
                .clickable { openSheet(OpenCriterion.ALL) }
                .clearAndSetSemantics {
                    contentDescription = settingsDescription
                    role = Role.Button
                },
        ) {
            ChipSegment(modified = criteria.paymentMethod != defaults.paymentMethod) { tint ->
                Icon(imageVector = CommuteIcons.Payment, contentDescription = null, modifier = Modifier.size(16.dp), tint = tint)
                ChipText(criteria.paymentMethod.shortLabel(), tint)
            }
            VerticalDivider(thickness = 2.dp, color = Stone200)
            // A yes/no, so it reads as a mark: "Tanpa TransJakarta" would set the chip's width alone.
            ChipSegment(modified = criteria.modes != defaults.modes) { tint ->
                Icon(imageVector = CommuteIcons.Bus, contentDescription = null, modifier = Modifier.size(16.dp), tint = tint)
                Icon(
                    imageVector = if (criteria.modes == Modes.ALL) CommuteIcons.Check else CommuteIcons.Excluded,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    tint = tint,
                )
            }
            VerticalDivider(thickness = 2.dp, color = Stone200)
            ChipSegment(modified = criteria.walking != defaults.walking) { tint ->
                WalkingIcon(speed = criteria.walking, height = 16.dp, tint = tint, reserve = false)
                ChipText(criteria.walking.shortLabel(), tint)
            }
        }

        val departure = criteria.departure
        val departureLabel = formatDepartureLabel(departure, now)
        val picked = departure is Departure.At
        val departureDescription = stringResource(R.string.journey_departure_description, departureLabel.lowercase())
        Row(
            modifier = Modifier
                .clip(CircleShape)
                .background(if (picked) Rose100 else Color.White)
                .border(2.dp, if (picked) Rose200 else Stone200, CircleShape)
                .clickable { openSheet(OpenCriterion.DEPARTURE) }
                .clearAndSetSemantics {
                    contentDescription = departureDescription
                    role = Role.Button
                }
                .padding(horizontal = 14.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val tint = if (picked) Pink800 else Slate500
            Icon(imageVector = CommuteIcons.Clock, contentDescription = null, modifier = Modifier.size(16.dp), tint = tint)
            ChipText(departureLabel, tint)
        }
    }

    CriteriaSheets(
        open = open,
        criteria = criteria,
        onOpen = { open = it },
        onClose = { open = null },
        onChange = onChange,
    )
}

@Composable
private fun ChipSegment(modified: Boolean, content: @Composable (tint: Color) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxHeight()
            .background(if (modified) Rose100 else Color.Transparent)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        content(if (modified) Pink800 else Slate500)
    }
}

@Composable
private fun ChipText(text: String, tint: Color) {
    Text(text = text, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = tint, maxLines = 1)
}

/**
 * A walker with speed lines trailing it, three at the top tier down to none, the count being what
 * tells four near-identical figures apart; the top tier runs. In a list the lines' slot is kept even
 * empty so the figures stand in one column; alone in the chip ([reserve] false) it collapses.
 */
@Composable
internal fun WalkingIcon(speed: WalkingSpeed, height: Dp, tint: Color, modifier: Modifier = Modifier, reserve: Boolean = true) {
    val lines = when (speed) {
        WalkingSpeed.BRISK -> 3
        WalkingSpeed.AVERAGE -> 2
        WalkingSpeed.SLOW -> 1
        WalkingSpeed.SLOWEST -> 0
    }
    Row(modifier = modifier.height(height), verticalAlignment = Alignment.CenterVertically) {
        if (lines > 0 || reserve) {
            Canvas(modifier = Modifier.width(height / 2).fillMaxHeight()) {
                val unit = size.height / 16f
                listOf(5f, 8f, 11f).take(lines).forEachIndexed { index, y ->
                    drawLine(
                        color = tint,
                        start = Offset((1f + index) * unit, y * unit),
                        end = Offset(7f * unit, y * unit),
                        strokeWidth = 1.75f * unit,
                        cap = StrokeCap.Round,
                    )
                }
            }
        }
        Icon(
            imageVector = if (speed == WalkingSpeed.BRISK) CommuteIcons.Run else CommuteIcons.Walk,
            contentDescription = null,
            modifier = Modifier.size(height),
            tint = tint,
        )
    }
}

/** The settings list, a sheet per setting, and the departure wheels. Only [open] is ever up. */
@Composable
private fun CriteriaSheets(
    open: OpenCriterion?,
    criteria: JourneyCriteria,
    onOpen: (OpenCriterion) -> Unit,
    onClose: () -> Unit,
    onChange: (JourneyCriteria) -> Unit,
) {
    val defaults = JourneyCriteria()
    when (open) {
        null -> Unit
        OpenCriterion.ALL -> SettingsSheet(onDismiss = onClose) {
            Column(modifier = Modifier.padding(bottom = 32.dp)) {
                SettingRow(
                    label = stringResource(R.string.journey_payment),
                    value = criteria.paymentMethod.label(),
                    modified = criteria.paymentMethod != defaults.paymentMethod,
                    onClick = { onOpen(OpenCriterion.PAYMENT) },
                )
                SettingRow(
                    label = stringResource(R.string.journey_modes),
                    value = criteria.modes.label(),
                    modified = criteria.modes != defaults.modes,
                    onClick = { onOpen(OpenCriterion.MODES) },
                )
                SettingRow(
                    label = stringResource(R.string.journey_walking),
                    value = criteria.walking.label(),
                    modified = criteria.walking != defaults.walking,
                    onClick = { onOpen(OpenCriterion.WALKING) },
                )
            }
        }

        OpenCriterion.PAYMENT -> ChoiceSheet(
            title = stringResource(R.string.journey_payment),
            options = PaymentMethod.entries.map { Choice(it, it.label(), it.description()) },
            selected = criteria.paymentMethod,
            onSelect = { onChange(criteria.copy(paymentMethod = it)) },
            onDismiss = onClose,
        )

        OpenCriterion.MODES -> ChoiceSheet(
            title = stringResource(R.string.journey_modes),
            options = Modes.entries.map { Choice(it, it.label(), it.description()) },
            selected = criteria.modes,
            onSelect = { onChange(criteria.copy(modes = it)) },
            onDismiss = onClose,
        )

        OpenCriterion.WALKING -> ChoiceSheet(
            title = stringResource(R.string.journey_walking_speed),
            options = WalkingSpeed.entries.map { Choice(it, it.label(), it.description()) },
            selected = criteria.walking,
            onSelect = { onChange(criteria.copy(walking = it)) },
            onDismiss = onClose,
            icon = { WalkingIcon(speed = it, height = 28.dp, tint = Slate600) },
        )

        OpenCriterion.DEPARTURE -> DepartureSheet(
            departure = criteria.departure,
            onSelect = { onChange(criteria.copy(departure = it)) },
            onDismiss = onClose,
        )
    }
}
