package id.shiorilabs.commute.feature.card.dump

import android.content.Intent

/** Where the dumper keeps what it read: [CardDumpStore] on a phone. */
interface CardDumps {
    /** Saves [dump] with the rider's [note]; gives the file's name. */
    suspend fun save(dump: CardDump, note: String): String

    suspend fun count(): Int

    /** Every dump in one share; null when there's none. */
    suspend fun share(): Intent?

    suspend fun clear()
}
