package id.shiorilabs.commute.feature.line.data.impl

import arrow.core.Either
import id.shiorilabs.commute.core.network.service.CommuteService
import id.shiorilabs.commute.core.query.Query
import id.shiorilabs.commute.core.query.QueryClient
import id.shiorilabs.commute.core.query.QueryPolicy
import id.shiorilabs.commute.core.query.QuerySpec
import id.shiorilabs.commute.core.query.queryKey
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.line.data.LineDetailRepository
import id.shiorilabs.commute.feature.line.domain.LineDetail
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton
import id.shiorilabs.commute.core.model.models.LineDetail as LineDetailDto

/**
 * Serves lines through the [QueryClient] under `line/{OPERATOR}/{code}`. A line's topology only
 * changes with a data deploy, and the API marks it static, so it is held a day at a time.
 */
@Singleton
class LineDetailRepositoryImpl @Inject constructor(
    private val service: CommuteService,
    private val queries: QueryClient,
) : LineDetailRepository {

    private fun lineQuery(operator: String, lineCode: String): QuerySpec<LineDetailDto> =
        QuerySpec(queryKey(LINE, operator, lineCode), LineDetailDto.serializer(), QueryPolicy.Static) { etag ->
            service.getLine(operator, lineCode, etag)
        }

    override suspend fun line(operator: String, lineCode: String): Either<Failure, LineDetail> =
        queries.fetch(lineQuery(operator, lineCode)).map { it.toLineDetail() }

    override fun observeLine(operator: String, lineCode: String): Flow<Query<LineDetail>> =
        queries.observe(lineQuery(operator, lineCode)).map { query -> query.map { it.toLineDetail() } }

    override fun cachedLine(operator: String, lineCode: String): LineDetail? =
        queries.peek(lineQuery(operator, lineCode))?.data?.toLineDetail()

    private companion object {

        const val LINE = "line"
    }
}
