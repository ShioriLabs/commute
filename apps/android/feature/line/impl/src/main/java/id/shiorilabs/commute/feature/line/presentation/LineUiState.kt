package id.shiorilabs.commute.feature.line.presentation

import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.line.domain.LineDetail
import id.shiorilabs.commute.feature.line.domain.LineStrip
import id.shiorilabs.commute.feature.station.domain.LineInfo
import java.time.Instant

/**
 * A line's page: the line, the strip it draws with its active branch, and the line dictionary the
 * other-line badges resolve against.
 */
data class LineUiState(
    val line: UIState<LineDetail>,
    /** Null until the line loads. */
    val strip: LineStrip? = null,
    /** Keyed `OPERATOR:CODE`. Empty until it loads; the badges wait for it. */
    val lines: Map<String, LineInfo> = emptyMap(),
    /** When the line shown was last confirmed, for the age line under the offline notice. */
    val updatedAt: Instant? = null,
    /** The line shown couldn't be refreshed when it was due. */
    val isOutdated: Boolean = false,
)
