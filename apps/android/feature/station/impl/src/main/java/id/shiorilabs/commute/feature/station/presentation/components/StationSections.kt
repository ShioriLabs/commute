package id.shiorilabs.commute.feature.station.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.constants.AMENITY_LABELS
import id.shiorilabs.commute.core.ui.components.CommuteButton
import id.shiorilabs.commute.core.ui.components.CommuteButtonIcon
import id.shiorilabs.commute.core.ui.components.CommuteButtonText
import id.shiorilabs.commute.core.ui.components.CommuteButtonVariant
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.station.R
import id.shiorilabs.commute.feature.station.domain.Amenity
import kotlin.math.roundToInt

// Tailwind's colours, as the web's station page uses them.
private val Gray600 = Color(0xFF4B5563)
private val Gray700 = Color(0xFF374151)
private val Slate200 = Color(0xFFE2E8F0)
private val Blue500 = Color(0xFF3B82F6)
private val Green700 = Color(0xFF15803D)

/** A section of the page under the departures: the web's `mt-8` and `px-4` heading. */
@Composable
internal fun SectionHeading(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        modifier = modifier
            .padding(horizontal = 16.dp)
            .semantics { heading() },
        style = MaterialTheme.typography.titleMedium,
        fontSize = 18.sp,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onBackground,
    )
}

/** The station's facilities, or a line saying the data has none. */
@Composable
fun AmenityList(
    amenities: List<Amenity>,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        SectionHeading(stringResource(R.string.station_amenities_title))
        if (amenities.isEmpty()) {
            Text(
                text = stringResource(R.string.station_amenities_empty),
                modifier = Modifier.padding(start = 16.dp, top = 16.dp, end = 16.dp),
                style = MaterialTheme.typography.bodyLarge,
                color = Gray600,
            )
            return@Column
        }
        Column(
            modifier = Modifier.padding(top = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            amenities.forEach { amenity -> AmenityRow(amenity) }
        }
    }
}

@Composable
private fun AmenityRow(amenity: Amenity) {
    val textStyle = MaterialTheme.typography.bodyLarge
    // Half the capitals' height above the baseline: where the icon's middle goes, so it centres on
    // the letters of the first line rather than on the line's box, which runs lower for descenders.
    val capMiddle = with(LocalDensity.current) { (textStyle.fontSize.toPx() * CAP_HEIGHT_EM / 2).roundToInt() }
    // Everything lines up on the first line's baseline: a wrapped name or detail hangs down from it.
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(modifier = Modifier.alignBy { it.measuredHeight / 2 + capMiddle }) {
            AmenityIcon(amenity.type)
        }
        // The name keeps its width and the detail wraps beside it: "Parkir" broken over two lines
        // reads worse than a long place name over two. Only a name past [AMENITY_NAME_MAX_FRACTION]
        // of the row wraps too, so a short detail is never squeezed to a few letters a line.
        Text(
            // A type newer than this build's labels still shows, as its raw name.
            text = AMENITY_LABELS[amenity.type] ?: amenity.type,
            modifier = Modifier.alignByBaseline().layout { measurable, constraints ->
                val maxWidth = (constraints.maxWidth * AMENITY_NAME_MAX_FRACTION).toInt()
                val placeable = measurable.measure(
                    constraints.copy(minWidth = minOf(constraints.minWidth, maxWidth), maxWidth = maxWidth),
                )
                layout(placeable.width, placeable.height) { placeable.place(0, 0) }
            },
            style = textStyle,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Text(
            text = amenity.text?.takeIf { it.isNotBlank() } ?: stringResource(R.string.station_amenity_available),
            modifier = Modifier
                .weight(1f)
                .alignByBaseline(),
            style = textStyle,
            color = Gray600,
            textAlign = TextAlign.End,
        )
    }
}

/** Plus Jakarta Sans's capital height, as a fraction of its size: 745 of 1000 units. */
private const val CAP_HEIGHT_EM = 0.745f

/** The most of a facility row its name takes before it wraps, leaving the rest to the detail. */
private const val AMENITY_NAME_MAX_FRACTION = 0.6f

/** The web's amenity glyphs. Decorative: the label beside it says what it is. */
@Composable
private fun AmenityIcon(type: String) {
    val (icon, tint) = when (type) {
        "TOILET", "TOILET_ACCESSIBLE" -> CommuteIcons.Toilet to null
        "CHARGING_STATION" -> CommuteIcons.ChargingStation to null
        "ESCALATOR_UNPAID", "ESCALATOR_PAID" -> CommuteIcons.Escalator to null
        "ELEVATOR_UNPAID", "ELEVATOR_PAID" -> CommuteIcons.Elevator to null
        "PRAYING_ROOM" -> CommuteIcons.PrayingRoom to Green700
        "PARKING" -> CommuteIcons.Parking to Blue500
        "WIFI" -> CommuteIcons.Wifi to null
        "BIKE_PARKING" -> CommuteIcons.BikeParking to null
        "LOCKERS" -> CommuteIcons.Lockers to null
        "NURSING_ROOM" -> CommuteIcons.NursingRoom to null
        // Keeps the labels in one column when a type arrives that has no glyph yet.
        else -> null to null
    }
    Box(modifier = Modifier.size(24.dp)) {
        if (icon != null) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(24.dp),
                tint = tint ?: MaterialTheme.colorScheme.onBackground,
            )
        }
        if (type == "TOILET_ACCESSIBLE") {
            // The web badges the toilet with a wheelchair in a blue disc at its corner.
            Icon(
                imageVector = CommuteIcons.Wheelchair,
                contentDescription = null,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .offset(x = 2.dp, y = 2.dp)
                    .size(16.dp)
                    .background(Blue500, CircleShape)
                    .padding(1.dp),
                tint = Color.White,
            )
        }
    }
}

/** Opens the station's coordinates in Google Maps, the web's slate button. */
@Composable
fun OpenInMapsButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    CommuteButton(onClick = onClick, modifier = modifier.fillMaxWidth(), variant = CommuteButtonVariant.Secondary) {
        CommuteButtonText(stringResource(R.string.station_open_maps))
        CommuteButtonIcon(CommuteIcons.ExternalLink, contentDescription = stringResource(R.string.station_open_maps_description))
    }
}

/**
 * In memoriam, Stasiun Bekasi Timur. On 27 April 2026 a KRL struck a car on level crossing JPL 85
 * and the Argo Bromo Anggrek behind it could not stop; sixteen people were killed, every one of them
 * a woman, and around ninety injured.
 *
 * Ported from the web's `BekasiTimurMemorial` and deliberately as restrained: no icon, no colour, no
 * card. Its copy is plain and factual rather than the house voice; see the strings.
 */
@Composable
fun BekasiTimurMemorial(modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth()) {
        HorizontalDivider(color = Slate200)
        Column(modifier = Modifier.padding(top = 24.dp)) {
            SectionHeading(stringResource(R.string.station_memorial_title))
            Text(
                text = stringResource(R.string.station_memorial_body),
                modifier = Modifier.padding(start = 16.dp, top = 12.dp, end = 16.dp),
                style = MaterialTheme.typography.bodyLarge,
                color = Gray700,
            )
            Text(
                text = stringResource(R.string.station_memorial_closing),
                modifier = Modifier.padding(start = 16.dp, top = 12.dp, end = 16.dp),
                style = MaterialTheme.typography.bodyLarge,
                color = Gray700,
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun AmenityListPreview() {
    CommutePreviewScaffold {
        AmenityList(
            amenities = listOf(
                Amenity("TOILET_ACCESSIBLE", null),
                Amenity("PRAYING_ROOM", null),
                Amenity("ESCALATOR_UNPAID", "Kedua sisi pintu masuk"),
                Amenity("PARKING", null),
                Amenity("SOMETHING_ADDED_LATER", null),
            ),
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun OpenInMapsButtonPreview() {
    CommutePreviewScaffold {
        OpenInMapsButton(onClick = {}, modifier = Modifier.padding(16.dp))
    }
}
