package id.shiorilabs.commute.core.type

/**
 * Returns a human-readable message describing this [Failure], suitable for direct display to the
 * rider.
 *
 * The server's own text on [Failure.Remote] is never shown: the API's error messages are written
 * for developers, in English.
 */
fun Failure.toUserMessage(): String = when (this) {
    is Failure.Network.NoConnection -> "Tidak ada koneksi internet. Coba cek jaringanmu."
    is Failure.Network.Timeout -> "Koneksinya lagi lambat. Coba lagi sebentar lagi."
    is Failure.Remote -> when (code) {
        404 -> "Datanya tidak ditemukan."
        429 -> "Terlalu banyak permintaan. Coba lagi sebentar lagi."
        in 500..599 -> "Server lagi bermasalah. Coba lagi nanti."
        else -> "Ada yang salah. Coba lagi."
    }
    is Failure.Unknown -> "Ada yang salah. Coba lagi."
}
