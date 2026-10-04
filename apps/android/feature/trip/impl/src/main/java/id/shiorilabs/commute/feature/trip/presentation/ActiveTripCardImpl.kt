package id.shiorilabs.commute.feature.trip.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.query.di.ApplicationScope
import id.shiorilabs.commute.core.ui.components.LineRoundel
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.trip.ActiveTripCard
import id.shiorilabs.commute.feature.trip.runtime.TripControllerImpl
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

private val CardInk = Color(0xFF0F172A)
private val CardMuted = Color(0xFFCBD5E1)

/** Dark, so a running trip reads as something happening rather than one more saved card. */
class ActiveTripCardImpl @Inject constructor(
    private val controller: TripControllerImpl,
    private val lines: LineRepository,
    @param:ApplicationScope scope: CoroutineScope,
) : ActiveTripCard {

    override val visible: StateFlow<Boolean> = controller.active
        .map { it != null }
        .stateIn(scope, SharingStarted.Eagerly, controller.active.value != null)

    @Composable
    override fun Content(modifier: Modifier) {
        val trip by controller.active.collectAsStateWithLifecycle()
        val current = trip ?: return
        val navigator = LocalNavigator.current
        val context = LocalContext.current
        val names = lines.cachedLines().orEmpty()
        val copy = remember(context, names) { TripCopy(context.resources, names) }
        val ride = current.plan.ride(current.state.legIndex)
        val line = names[ride.line]
        val headline = current.headline()

        Row(
            modifier = modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(CardInk)
                .clickable(role = Role.Button) { navigator.goTo(Route.ActiveTrip) }
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LineRoundel(
                code = line?.lineCode ?: ride.line.substringAfter(':'),
                color = line?.colorCode ?: "#94A3B8",
                operator = ride.operator,
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = copy.title(headline),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                copy.source(current)?.let {
                    Text(text = it, style = MaterialTheme.typography.bodySmall, color = CardMuted)
                }
            }
            Icon(imageVector = CommuteIcons.Chevron, contentDescription = null, modifier = Modifier.size(20.dp), tint = CardMuted)
        }
    }
}
