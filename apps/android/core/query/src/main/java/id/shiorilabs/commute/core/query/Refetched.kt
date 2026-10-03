package id.shiorilabs.commute.core.query

/**
 * What a [QueryClient.refetch] found, counted by key: answers that differ from the ones held,
 * answers the server confirmed (a 304, or the same body again), and refetches that failed or
 * couldn't start offline.
 */
data class Refetched(
    val changed: Int = 0,
    val unchanged: Int = 0,
    val failed: Int = 0,
) {

    operator fun plus(other: Refetched): Refetched =
        Refetched(changed + other.changed, unchanged + other.unchanged, failed + other.failed)
}
