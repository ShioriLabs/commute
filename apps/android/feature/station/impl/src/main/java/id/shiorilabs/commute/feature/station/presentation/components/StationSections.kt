package id.shiorilabs.commute.feature.station.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.shiorilabs.commute.core.constants.AMENITY_LABELS
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.station.R
import id.shiorilabs.commute.feature.station.domain.Amenity

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
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AmenityIcon(amenity.type)
        Text(
            // A type newer than this build's labels still shows, as its raw name.
            text = AMENITY_LABELS[amenity.type] ?: amenity.type,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Text(
            text = amenity.text?.takeIf { it.isNotBlank() } ?: stringResource(R.string.station_amenity_available),
            style = MaterialTheme.typography.bodyLarge,
            color = Gray600,
        )
    }
}

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
    val description = stringResource(R.string.station_open_maps_description)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Slate200)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = stringResource(R.string.station_open_maps),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary,
        )
        Icon(
            imageVector = CommuteIcons.ExternalLink,
            contentDescription = description,
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.primary,
        )
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
