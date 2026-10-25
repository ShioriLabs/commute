package id.shiorilabs.commute.feature.card.reader

import java.io.InputStream

/** A line in Japan, as the table names it: who runs it, and its name when the code is only ever that line. */
internal data class JapanLine(val company: String, val name: String?)

/** Where the table sits in the app's assets, with its MIT licence beside it. */
internal const val JAPAN_IC_LINES_ASSET = "japan_ic/lines.csv"

/**
 * Japan's line codes, cut down from Suica Viewer's station table by spec/japan_ic_lines.awk
 * (JAPAN_IC.md), keyed by the byte a history slot gives a station's line. The table also keys by
 * area, which our one card doesn't show us how to read, so only area 0 is taken: the area its
 * stations are in. Read on first use, from [open].
 */
internal class JapanIcLines(private val open: () -> InputStream) {
    private val byCode: Map<Int, JapanLine> by lazy { open().bufferedReader().useLines(::parse) }

    operator fun get(code: Int): JapanLine? = byCode[code]

    private fun parse(lines: Sequence<String>): Map<Int, JapanLine> = lines
        .drop(1)
        .map { it.split(',') }
        .filter { it.size == 4 && it[0] == "0" }
        .mapNotNull { row ->
            val code = row[1].toIntOrNull(16) ?: return@mapNotNull null
            code to JapanLine(company = row[2], name = row[3].takeUnless { it.isEmpty() || it == "-" })
        }
        .toMap()
}
