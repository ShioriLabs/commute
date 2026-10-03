package id.shiorilabs.commute.feature.line.data.impl

import id.shiorilabs.commute.feature.line.domain.LineDetail
import id.shiorilabs.commute.feature.line.domain.LineSegment
import id.shiorilabs.commute.feature.line.domain.LineStop
import id.shiorilabs.commute.feature.line.domain.SegmentKind
import id.shiorilabs.commute.core.model.models.LineDetail as LineDetailDto
import id.shiorilabs.commute.core.model.models.LineSegment as LineSegmentDto
import id.shiorilabs.commute.core.model.models.LineStation as LineStationDto

internal fun LineDetailDto.toLineDetail(): LineDetail = LineDetail(
    operator = `operator`.code,
    operatorName = `operator`.name,
    name = line.name,
    lineCode = line.lineCode,
    colorCode = line.colorCode,
    segments = segments.map { it.toLineSegment() },
)

private fun LineSegmentDto.toLineSegment(): LineSegment = LineSegment(
    // A plain string on the wire: the API may add kinds, which the strip then leaves out.
    kind = SegmentKind.entries.firstOrNull { it.name == kind } ?: SegmentKind.UNKNOWN,
    joinsAtCode = joinsAtCode,
    stations = stations.map { it.toLineStop() },
)

private fun LineStationDto.toLineStop(): LineStop = LineStop(
    id = id,
    code = code,
    name = name,
    stationNumber = stationNumber,
    isInterchange = isInterchange,
    otherLines = otherLines,
)
