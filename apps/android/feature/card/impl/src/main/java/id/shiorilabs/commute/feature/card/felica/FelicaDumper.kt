package id.shiorilabs.commute.feature.card.felica

import id.shiorilabs.commute.feature.card.dump.CardDump
import java.io.IOException

/** How far a dump has got, for the screen while the card is held. */
data class DumpProgress(
    val step: Step,
    val done: Int,
    val total: Int,
    val services: Int,
    val blocks: Int,
) {
    enum class Step { Systems, Searching, Reading, Mapping }
}

/**
 * Reads everything a FeliCa card shows without a key. In order, so that a card taken away early
 * still leaves the part that matters:
 * 1. Request System Code: every system on the card (UM §4.4.8).
 * 2. Per system, a poll for its own code, then a Request Service sweep over every service code
 *    whose attribute needs no key (UM Table 3-2), then each service found read from block 0 until
 *    the card refuses (UM §4.4.5). Search Service Code would list them outright, but its format
 *    isn't public (UM §4.4.7).
 * 3. Per system again, the same sweep over keyed services and areas: the card's shape, not read.
 * 4. Polls for the systems Request System Code leaves out (TN §2.1 item 10).
 *
 * Knows FeliCa only, never what a particular card's services mean.
 */
internal class FelicaDumper(
    private val transport: FelicaTransport,
    private val now: () -> Long = { System.nanoTime() / 1_000_000 },
    private val onProgress: (DumpProgress) -> Unit = {},
) {
    private val transcript = mutableListOf<CardDump.Exchange>()
    private var started = 0L
    private var servicesFound = 0
    private var blocksRead = 0

    fun dump(tagIdm: ByteArray, tagPmm: ByteArray, tagSystemCode: Int): CardDump {
        transcript.clear()
        started = now()
        val systems = mutableListOf<SystemState>()
        val probes = mutableListOf<CardDump.Probe>()
        var failure: String? = null
        try {
            progress(DumpProgress.Step.Systems, 0, 1)
            val codes = FelicaResponse.requestSystemCode(send(FelicaCommand.requestSystemCode(tagIdm)), tagIdm)
                ?: throw Garbled("Request System Code")
            codes.forEach { systems += SystemState(it) }
            systems.forEach { readable(it) }
            systems.forEach { shape(it) }
            for (code in UNLISTED_SYSTEMS - codes.toSet()) probes += probe(code)
        } catch (e: IOException) {
            failure = e.message ?: e.javaClass.simpleName
        }
        return CardDump(
            tag = CardDump.Tag(tagIdm.hex(), tagPmm.hex(), tagSystemCode.hex4()),
            systems = systems.map { it.toDump() },
            probes = probes,
            complete = failure == null,
            failure = failure,
            transcript = transcript.toList(),
        )
    }

    /** Switches to the system (TN §2.5), finds its keyless services and reads every block. */
    private fun readable(system: SystemState) {
        val answer = poll(system.code)
        system.idm = answer.idm
        system.pmm = answer.pmm
        val found = sweep(answer.idm, NO_KEY_SERVICE_ATTRIBUTES, DumpProgress.Step.Searching)
        found.forEach { (code, version) -> system.services[code] = Read(code, version) }
        servicesFound += found.size
        for ((i, service) in system.services.values.withIndex()) {
            progress(DumpProgress.Step.Reading, i, system.services.size)
            read(answer.idm, service)
        }
    }

    /** The keyed services and the areas: listed with their key versions, never read. */
    private fun shape(system: SystemState) {
        val idm = system.idm ?: return
        poll(system.code)
        val found = sweep(idm, KEYED_SERVICE_ATTRIBUTES + AREA_ATTRIBUTES, DumpProgress.Step.Mapping)
        for ((code, version) in found) {
            if (serviceAttribute(code) in AREA_ATTRIBUTES) system.areas[code] = version else system.services[code] = Read(code, version)
        }
        servicesFound += found.count { serviceAttribute(it.key) !in AREA_ATTRIBUTES }
    }

    /** Request Service over every number with each of [attributes]: the codes the card has. */
    private fun sweep(idm: ByteArray, attributes: List<Int>, step: DumpProgress.Step): Map<Int, Int> {
        val codes = (0 until NODE_NUMBERS).flatMap { number -> attributes.map { serviceCode(number, it) } }
        val batches = codes.chunked(MAX_NODES)
        val found = sortedMapOf<Int, Int>()
        for ((i, batch) in batches.withIndex()) {
            progress(step, i, batches.size)
            val versions = FelicaResponse.requestService(send(FelicaCommand.requestService(idm, batch)), idm)
                ?.takeIf { it.size == batch.size }
                ?: throw Garbled("Request Service")
            batch.zip(versions).filter { it.second != NO_SUCH_NODE }.forEach { (code, version) -> found[code] = version }
        }
        return found
    }

    /**
     * Twelve blocks at a time from block 0. A refused batch is retried a block at a time, since
     * the card refuses the lot for one block past the end (UM §4.4.5); the first refused block
     * ends the service.
     */
    private fun read(idm: ByteArray, service: Read) {
        var next = 0
        while (next < MAX_BLOCKS) {
            val batch = (next until minOf(next + READ_BATCH, MAX_BLOCKS)).toList()
            val answer = readBlocks(idm, service.code, batch)
            if (answer.ok && answer.blocks.size == batch.size) {
                service.take(answer.blocks)
                next += batch.size
                continue
            }
            for (block in batch) {
                val one = if (batch.size == 1) answer else readBlocks(idm, service.code, listOf(block))
                if (!one.ok || one.blocks.size != 1) {
                    service.stop = one.statusFlag1.hex2() + one.statusFlag2.hex2()
                    return
                }
                service.take(one.blocks)
            }
            next += batch.size
        }
    }

    private fun Read.take(read: List<ByteArray>) {
        blocks += read.map { it.hex() }
        blocksRead += read.size
    }

    private fun readBlocks(idm: ByteArray, code: Int, blocks: List<Int>): ReadResponse =
        FelicaResponse.readWithoutEncryption(send(FelicaCommand.readWithoutEncryption(idm, code, blocks)), idm)
            ?: throw Garbled("Read Without Encryption")

    /** A listed system that doesn't answer its own poll is a card gone, as far as a dump can tell. */
    private fun poll(code: Int): PollingResponse =
        FelicaResponse.polling(send(FelicaCommand.polling(code))) ?: throw Garbled("Polling")

    /** A poll nobody answers is an answer too: that system isn't there. */
    private fun probe(code: Int): CardDump.Probe {
        val frame = try {
            send(FelicaCommand.polling(code))
        } catch (_: IOException) {
            return CardDump.Probe(code.hex4())
        }
        val answer = FelicaResponse.polling(frame) ?: return CardDump.Probe(code.hex4())
        return CardDump.Probe(code.hex4(), answer.idm.hex(), answer.pmm.hex())
    }

    /** Every frame goes through here, so the transcript has all of them, answered or not. */
    private fun send(frame: ByteArray): ByteArray {
        val at = now() - started
        val answer = try {
            transport.transceive(frame)
        } catch (e: IOException) {
            transcript += CardDump.Exchange(tx = frame.hex(), ms = at, error = e.message ?: e.javaClass.simpleName)
            throw e
        }
        transcript += CardDump.Exchange(tx = frame.hex(), rx = answer.hex(), ms = at)
        return answer
    }

    private fun progress(step: DumpProgress.Step, done: Int, total: Int) =
        onProgress(DumpProgress(step, done, total, servicesFound, blocksRead))

    private class SystemState(val code: Int) {
        var idm: ByteArray? = null
        var pmm: ByteArray? = null
        val services = sortedMapOf<Int, Read>()
        val areas = sortedMapOf<Int, Int>()

        fun toDump() = CardDump.SystemDump(
            code = code.hex4(),
            idm = idm?.hex(),
            pmm = pmm?.hex(),
            services = services.values.map {
                CardDump.ServiceDump(it.code.hex4(), it.keyVersion.hex4(), it.readable, it.blocks.toList(), it.stop)
            },
            areas = areas.map { (code, version) -> CardDump.Node(code.hex4(), version.hex4()) },
        )
    }

    private class Read(val code: Int, val keyVersion: Int) {
        val readable = serviceAttribute(code) % 2 == 1
        val blocks = mutableListOf<String>()
        var stop: String? = null
    }

    /** An answer that doesn't parse: the dump can't go on trusting the exchange. */
    private class Garbled(command: String) : IOException("Unreadable answer to $command")

    private fun Int.hex2() = hex4().takeLast(2)

    companion object {
        /** FeliCa Lite-S and FeliCa Secure ID (TN §2.1 item 10; CD §3). */
        val UNLISTED_SYSTEMS = listOf(0x88B4, 0x957A)

        /** Well past any product's user blocks (TN §2.1 item 3): a guard, not a limit. */
        const val MAX_BLOCKS = 1024
    }
}
