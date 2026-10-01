package id.shiorilabs.commute.core.type

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

class FailureMappingTest {

    @Test
    fun `an ApiException maps to Remote with its status and message`() {
        val exception = ApiException(status = 404, message = "Not found")

        val failure = exception.toFailure()

        assertEquals(Failure.Remote(code = 404, message = "Not found", cause = exception), failure)
    }

    @Test
    fun `an unknown host maps to NoConnection`() {
        assertTrue(UnknownHostException().toFailure() is Failure.Network.NoConnection)
    }

    @Test
    fun `any other IOException maps to NoConnection`() {
        assertTrue(IOException("reset").toFailure() is Failure.Network.NoConnection)
    }

    @Test
    fun `a socket timeout maps to Timeout`() {
        assertTrue(SocketTimeoutException().toFailure() is Failure.Network.Timeout)
    }

    @Test
    fun `anything else maps to Unknown and keeps the cause`() {
        val exception = IllegalStateException("boom")

        val failure = exception.toFailure()

        assertTrue(failure is Failure.Unknown)
        assertSame(exception, failure.cause)
    }
}
