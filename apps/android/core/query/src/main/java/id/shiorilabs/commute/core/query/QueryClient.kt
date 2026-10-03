package id.shiorilabs.commute.core.query

import arrow.core.Either
import arrow.core.getOrElse
import id.shiorilabs.commute.core.connectivity.NetworkMonitor
import id.shiorilabs.commute.core.query.di.ApplicationScope
import id.shiorilabs.commute.core.query.store.QueryStore
import id.shiorilabs.commute.core.query.store.StoredEntry
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.Fetched
import id.shiorilabs.commute.core.type.toFailure
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.io.IOException
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.ContinuationInterceptor

/**
 * The app's response cache, after TanStack Query (and the web app's SWR): answers are held in
 * memory and on disk under a [QueryKey], served at once however old, and revalidated in the
 * background when their [QueryPolicy] says they've gone stale.
 *
 * - **Stale-while-revalidate.** [observe] emits what is held first, then the fetch's answer.
 * - **Conditional.** A revalidation sends the held copy's ETag, so an unchanged answer costs a 304.
 * - **Deduplicated.** Any number of observers of one key share one fetch.
 * - **Offline.** Nothing is asked while the device is offline; a due fetch is reported as
 *   [Failure.Network.NoConnection] next to the data held, and runs once it is back online.
 * - **Not tied to a screen.** Fetches run in the app's scope, so leaving a screen mid-request still
 *   keeps the answer for the next visit.
 *
 * What is stored is the wire model, as JSON. An entry that no longer decodes (the model changed in
 * an app update) is dropped and treated as never fetched.
 */
@Singleton
class QueryClient @Inject constructor(
    private val store: QueryStore,
    networkMonitor: NetworkMonitor,
    private val clock: Clock,
    @ApplicationScope private val scope: CoroutineScope,
) {

    private val json = Json { ignoreUnknownKeys = true }

    /** Where decoding and encoding run: the app scope's dispatcher, a test's in tests. */
    private val io = scope.coroutineContext[ContinuationInterceptor] ?: Dispatchers.IO

    /** Optimistic until the monitor says otherwise: an offline fetch fails fast anyway. */
    private val online: StateFlow<Boolean> = networkMonitor.isOnline.stateIn(scope, SharingStarted.Eagerly, true)

    /** Every key held in memory, least recently used first. Guarded by itself. */
    private val cells = LinkedHashMap<String, Cell>(16, 0.75f, true)

    init {
        scope.launch {
            var wasOnline = true
            online.collect { isOnline ->
                if (isOnline && !wasOnline) {
                    observedCells().forEach { revalidate(it) }
                }
                wasOnline = isOnline
            }
        }
    }

    /**
     * [spec]'s state for as long as it is collected: what is held (from memory, else disk) first,
     * then every change. Starts a fetch when the answer held is missing, stale or not
     * [usable][QuerySpec.isUsable], and again on reconnecting or [invalidate] while collected.
     *
     * Emits nothing until the disk has been read, so a screen never flashes a loading state over an
     * answer it already has.
     */
    fun <T> observe(spec: QuerySpec<T>): Flow<Query<T>> = flow {
        val cell = cell(spec)
        cell.observers.incrementAndGet()
        try {
            load(cell, spec)
            revalidate(cell, spec)
            emitAll(cell.state.map { it.toQuery<T>() }.distinctUntilChanged())
        } finally {
            cell.observers.decrementAndGet()
        }
    }

    /**
     * [spec]'s answer, once: the one held while it is fresh, else a fetched one. When the fetch
     * fails (or the device is offline) an answer held of any age is still a [Either.Right]; only
     * with nothing held is it the failure.
     */
    suspend fun <T> fetch(spec: QuerySpec<T>): Either<Failure, T> {
        val cell = cell(spec)
        load(cell, spec)
        revalidate(cell, spec)?.await()
        val settled = cell.state.value
        @Suppress("UNCHECKED_CAST")
        return settled.data?.let { Either.Right(it as T) } ?: Either.Left(settled.failure ?: offline())
    }

    /**
     * What memory holds for [spec] right now, without touching the disk or the network: for seeding
     * a screen's first frame. Null when it hasn't been loaded this session.
     */
    fun <T> peek(spec: QuerySpec<T>): Query<T>? =
        synchronized(cells) { cells[spec.key.value] }?.state?.value?.takeIf { it.loaded }?.toQuery()

    /**
     * Marks every key at or under [prefix] stale, and refetches the ones being observed. A retry:
     * what is held stays on screen until the answer replaces it.
     */
    fun invalidate(prefix: QueryKey) {
        val matched = synchronized(cells) { cells.values.filter { it.key.isUnder(prefix) } }
        matched.forEach { cell ->
            cell.state.update { it.copy(invalidated = true) }
            if (cell.observers.get() > 0) {
                revalidate(cell)
            }
        }
    }

    /** Forgets every stored answer. Screens open now keep what they show until they reload. */
    suspend fun clear() {
        attempt { store.clear() }
        synchronized(cells) { cells.values.removeAll { it.observers.get() == 0 } }
    }

    /** Roughly how many bytes the stored answers take on disk. */
    suspend fun size(): Long = attempt { store.size() } ?: 0L

    /**
     * Drops answers nobody has opened in [UNUSED_FOR], then the least recently used until the rest
     * fit in [MAX_SIZE]. Run once a launch.
     */
    suspend fun prune() {
        attempt { store.prune(clock.millis() - UNUSED_FOR.toMillis(), MAX_SIZE) }
    }

    private fun cell(spec: QuerySpec<*>): Cell = synchronized(cells) {
        val cell = cells.getOrPut(spec.key.value) { Cell(spec.key) }
        cell.spec = spec
        if (cells.size > MAX_CELLS) {
            val eldest = cells.values.iterator()
            while (cells.size > MAX_CELLS && eldest.hasNext()) {
                val candidate = eldest.next()
                if (candidate !== cell && candidate.isIdle()) {
                    eldest.remove()
                }
            }
        }
        cell
    }

    private fun observedCells(): List<Cell> = synchronized(cells) { cells.values.filter { it.observers.get() > 0 } }

    /** Reads [cell]'s stored answer into memory, once. */
    private suspend fun <T> load(cell: Cell, spec: QuerySpec<T>) {
        if (cell.state.value.loaded) return
        cell.loadLock.withLock {
            if (cell.state.value.loaded) return
            val key = spec.key.value
            val stored = attempt { store.get(key) }
            val data = stored?.let { entry ->
                withContext(io) { attempt { json.decodeFromString(spec.serializer, entry.body) } }
            }
            when {
                stored == null -> Unit
                data == null -> attempt { store.delete(key) }
                else -> attempt { store.markUsed(key, clock.millis()) }
            }
            cell.state.update {
                if (data == null || stored == null) {
                    it.copy(loaded = true)
                } else {
                    it.copy(
                        loaded = true,
                        data = data,
                        etag = stored.etag,
                        fetchedAt = Instant.ofEpochMilli(stored.fetchedAtMillis),
                    )
                }
            }
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun revalidate(cell: Cell) {
        val spec = cell.spec as QuerySpec<Any?>? ?: return
        revalidate(cell, spec)
    }

    /** Starts [cell]'s fetch if its answer is due one, or joins the one running. */
    private fun <T> revalidate(cell: Cell, spec: QuerySpec<T>): Deferred<Unit>? {
        if (!cell.state.value.needsFetch(spec, clock.instant())) {
            return synchronized(cell) { cell.inFlight?.takeIf { it.isActive } }
        }
        if (!online.value) {
            cell.state.update { it.copy(failure = offline()) }
            return null
        }
        return synchronized(cell) {
            cell.inFlight?.takeIf { it.isActive } ?: run {
                cell.state.update { it.copy(isFetching = true) }
                scope.async { runFetch(cell, spec) }.also { cell.inFlight = it }
            }
        }
    }

    private suspend fun <T> runFetch(cell: Cell, spec: QuerySpec<T>) {
        val key = spec.key.value
        val held = cell.state.value
        val etag = held.etag.takeIf { held.data != null }
        val fetched = Either.catch { spec.fetch(etag) }
            .mapLeft(Throwable::toFailure)
            .getOrElse { failure ->
                cell.state.update { it.copy(isFetching = false, failure = failure) }
                return
            }
        val now = clock.instant()
        when (fetched) {
            is Fetched.Body -> {
                val body = withContext(io) { attempt { json.encodeToString(spec.serializer, fetched.data) } }
                if (body != null) {
                    attempt { store.put(StoredEntry(key, body, fetched.etag, now.toEpochMilli())) }
                }
                cell.state.update {
                    it.copy(
                        data = fetched.data,
                        etag = fetched.etag,
                        fetchedAt = now,
                        isFetching = false,
                        failure = null,
                        invalidated = false,
                    )
                }
            }
            is Fetched.NotModified -> {
                attempt { store.confirm(key, now.toEpochMilli(), fetched.etag) }
                cell.state.update {
                    it.copy(
                        etag = fetched.etag ?: it.etag,
                        fetchedAt = now,
                        isFetching = false,
                        failure = null,
                        invalidated = false,
                    )
                }
            }
        }
    }

    /** One key held in memory: its state, the fetch running for it, and who is watching. */
    private class Cell(val key: QueryKey) {

        val state = MutableStateFlow(Snapshot())
        val loadLock = Mutex()
        val observers = AtomicInteger(0)

        /** The latest spec asked for under this key, for refetches nobody asked for directly. */
        @Volatile
        var spec: QuerySpec<*>? = null

        /** Guarded by the cell itself. */
        var inFlight: Deferred<Unit>? = null

        fun isIdle(): Boolean = observers.get() == 0 && synchronized(this) { inFlight?.isActive != true }
    }

    private data class Snapshot(
        /** Whether the disk has been read; until then nothing is emitted. */
        val loaded: Boolean = false,
        val data: Any? = null,
        val etag: String? = null,
        val fetchedAt: Instant? = null,
        val isFetching: Boolean = false,
        val failure: Failure? = null,
        /** Marked stale by [invalidate], whatever its age. */
        val invalidated: Boolean = false,
    ) {

        @Suppress("UNCHECKED_CAST")
        fun <T> toQuery(): Query<T> = Query(data as T?, fetchedAt, isFetching, failure)

        @Suppress("UNCHECKED_CAST")
        fun <T> needsFetch(spec: QuerySpec<T>, now: Instant): Boolean {
            val held = data ?: return true
            val confirmedAt = fetchedAt ?: return true
            return invalidated || !spec.isUsable(held as T) || now >= spec.policy.staleAt(confirmedAt)
        }
    }

    private companion object {

        /** Keys held decoded in memory; the disk holds the rest. */
        const val MAX_CELLS = 64

        val UNUSED_FOR: Duration = Duration.ofDays(30)

        /** A station's week of timetables is tens of kilobytes; this holds hundreds of them. */
        const val MAX_SIZE = 25L * 1024 * 1024

        /** The failure a due fetch reports while offline, shaped like a real one for the copy. */
        fun offline(): Failure = Failure.Network.NoConnection(cause = IOException("Offline"))

        /**
         * Runs a cache operation that may fail (a disk error, a body that no longer decodes)
         * without failing the query: the cache is an optimisation, never a reason to show nothing.
         */
        inline fun <R> attempt(block: () -> R): R? = try {
            block()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            null
        }
    }
}
