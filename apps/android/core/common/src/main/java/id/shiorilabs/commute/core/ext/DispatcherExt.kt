package id.shiorilabs.commute.core.ext

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Runs [block] on [Dispatchers.Default] — the pool repositories use for their data work: Ktor's
 * `body()` JSON deserialization and the DTO→domain mapping that follows it. Both are CPU-bound and,
 * left on the caller's dispatcher, run on the main thread (repositories are invoked from
 * `viewModelScope`, whose default dispatcher is `Main.immediate`), causing first-load frame drops.
 *
 * Wrap the whole repository method body so the network decode *and* the mapping land off-main:
 *
 * ```
 * override suspend fun fetch(): Either<Failure, T> = onDataThread {
 *     either { ... }
 * }
 * ```
 *
 * The [CoroutineScope] receiver lets callers use `async`/`coroutineScope` inside without nesting.
 */
suspend fun <T> onDataThread(block: suspend CoroutineScope.() -> T): T =
    withContext(Dispatchers.Default, block)
