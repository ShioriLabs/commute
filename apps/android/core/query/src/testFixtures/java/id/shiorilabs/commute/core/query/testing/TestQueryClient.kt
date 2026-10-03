package id.shiorilabs.commute.core.query.testing

import id.shiorilabs.commute.core.connectivity.NetworkMonitor
import id.shiorilabs.commute.core.query.QueryClient
import id.shiorilabs.commute.core.query.store.QueryStore
import kotlinx.coroutines.CoroutineScope
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

/**
 * A real [QueryClient] over in-memory fakes, for a repository test. Pass a test's `backgroundScope`
 * as [scope], so fetches run on its scheduler and stop with it.
 */
fun testQueryClient(
    scope: CoroutineScope,
    clock: Clock = Clock.fixed(Instant.parse("2026-10-03T10:00:00Z"), ZoneOffset.UTC),
    store: QueryStore = FakeQueryStore(),
    networkMonitor: NetworkMonitor = FakeNetworkMonitor(),
): QueryClient = QueryClient(store, networkMonitor, clock, scope)
