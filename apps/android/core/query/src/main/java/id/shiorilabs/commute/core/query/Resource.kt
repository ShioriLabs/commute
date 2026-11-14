package id.shiorilabs.commute.core.query

import arrow.core.Either
import id.shiorilabs.commute.core.ext.onDataThread
import id.shiorilabs.commute.core.type.Failure
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map

/**
 * One cached answer, and the three ways a caller takes it. A repository hands one out per thing it
 * serves (`stations.timetable(id, day)`), so each is described once and asked for however suits.
 */
interface Resource<out T> {

    /**
     * The answer, once: the one held while it is fresh, else a fetched one. When the fetch fails an
     * answer held of any age is returned instead; only with nothing held is it the failure.
     */
    suspend fun fetch(): Either<Failure, T>

    /**
     * Stale-while-revalidate: what is held first, however old, then a fresh answer if it was due
     * one. Doesn't complete.
     */
    fun observe(): Flow<Query<T>>

    /**
     * The answer as already loaded this session, without asking or reading the disk. A screen
     * opening onto data another one just loaded starts from it, rather than from a skeleton.
     */
    fun cached(): T?
}

/**
 * [spec] through the cache, as the domain's [T]: mapped off the main thread, since an answer can
 * hold thousands of rows.
 */
fun <W, T> QueryClient.resource(spec: QuerySpec<W>, transform: (W) -> T): Resource<T> = object : Resource<T> {

    override suspend fun fetch(): Either<Failure, T> = fetch(spec).let { answer -> onDataThread { answer.map(transform) } }

    override fun observe(): Flow<Query<T>> = observe(spec).map { it.map(transform) }.flowOn(Dispatchers.Default)

    override fun cached(): T? = peek(spec)?.data?.let(transform)
}

/**
 * A [Resource] over a one-shot [fetch], for a source without a cache of its own (a test's fake, an
 * interface's default): observed, it is [cached] alone when there is one, else a fetch in flight
 * and then its answer.
 */
fun <T> resourceOnce(cached: () -> T? = { null }, fetch: suspend () -> Either<Failure, T>): Resource<T> = object : Resource<T> {

    override suspend fun fetch(): Either<Failure, T> = fetch()

    override fun observe(): Flow<Query<T>> = queryOnce(cached(), fetch)

    override fun cached(): T? = cached()
}
