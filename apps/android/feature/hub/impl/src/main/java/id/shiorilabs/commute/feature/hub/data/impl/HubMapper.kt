package id.shiorilabs.commute.feature.hub.data.impl

import id.shiorilabs.commute.feature.hub.domain.Hub
import id.shiorilabs.commute.feature.hub.domain.HubKind
import id.shiorilabs.commute.feature.hub.domain.HubMember
import id.shiorilabs.commute.core.model.models.Hub as HubDto

internal fun HubDto.toHub(): Hub = Hub(
    slug = slug,
    name = name,
    kind = if (kind == "hub") HubKind.HUB else HubKind.INTEGRATED,
    members = members.map { member ->
        HubMember(
            id = member.id,
            name = member.name,
            operator = member.`operator`,
            lineKeys = member.lines,
        )
    },
)
