package id.shiorilabs.commute.feature.line.data

import id.shiorilabs.commute.core.query.Resource
import id.shiorilabs.commute.feature.line.domain.LineDetail

/**
 * Lines' topology, by operator and code. Cached, on disk too, so a line opened before still opens
 * offline, labelled with its age; only with nothing held is the failure returned.
 */
interface LineDetailRepository {

    fun line(operator: String, lineCode: String): Resource<LineDetail>
}
