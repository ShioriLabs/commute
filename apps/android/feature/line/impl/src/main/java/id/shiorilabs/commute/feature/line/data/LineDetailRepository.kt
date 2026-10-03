package id.shiorilabs.commute.feature.line.data

import arrow.core.Either
import id.shiorilabs.commute.core.query.Query
import id.shiorilabs.commute.core.query.queryOnce
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.line.domain.LineDetail
import kotlinx.coroutines.flow.Flow

/**
 * Lines' topology, by operator and code. Cached, on disk too, so a line opened before still opens
 * offline, labelled with its age; only with nothing held is the failure returned.
 */
interface LineDetailRepository {

    suspend fun line(operator: String, lineCode: String): Either<Failure, LineDetail>

    /**
     * [line], as it changes: what is held first, however old, then a fresh answer if it was due
     * one. Doesn't complete. The default serves a fake with no cache of its own from [line].
     */
    fun observeLine(operator: String, lineCode: String): Flow<Query<LineDetail>> =
        queryOnce(cachedLine(operator, lineCode)) { line(operator, lineCode) }

    /** The line as already loaded this session, without asking or reading the disk. */
    fun cachedLine(operator: String, lineCode: String): LineDetail? = null
}
