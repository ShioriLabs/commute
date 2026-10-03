package id.shiorilabs.commute.feature.hub.presentation

import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.hub.domain.Hub
import id.shiorilabs.commute.feature.station.domain.LineInfo
import java.time.Instant

/** A hub's page: the hub, and the line dictionary its members' roundels resolve against. */
data class HubUiState(
    val hub: UIState<Hub>,
    /** Keyed `OPERATOR:CODE`. Empty until it loads; the roundels wait for it. */
    val lines: Map<String, LineInfo>,
    /** When the hub shown was last confirmed, for the age line under the offline notice. */
    val updatedAt: Instant? = null,
    /** The hub shown couldn't be refreshed when it was due. */
    val isOutdated: Boolean = false,
)
