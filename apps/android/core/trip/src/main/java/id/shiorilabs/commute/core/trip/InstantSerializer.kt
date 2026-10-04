package id.shiorilabs.commute.core.trip

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import java.time.Instant

/** An [Instant] as its ISO-8601 string, the way the API writes times. */
object InstantSerializer : KSerializer<Instant> {

    override val descriptor = PrimitiveSerialDescriptor("id.shiorilabs.commute.core.trip.Instant", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: Instant) = encoder.encodeString(value.toString())

    override fun deserialize(decoder: Decoder): Instant = Instant.parse(decoder.decodeString())
}
