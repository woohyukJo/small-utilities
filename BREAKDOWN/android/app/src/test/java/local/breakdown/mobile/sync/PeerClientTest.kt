package local.breakdown.mobile.sync

import java.io.ByteArrayInputStream
import java.io.IOException
import java.math.BigInteger
import java.security.MessageDigest
import java.security.Principal
import java.security.PublicKey
import java.security.cert.Certificate
import java.security.cert.X509Certificate
import java.time.LocalDate
import java.util.Base64
import java.util.Date
import javax.net.ssl.SSLPeerUnverifiedException
import javax.net.ssl.SSLSession
import javax.net.ssl.X509TrustManager
import javax.security.auth.x500.X500Principal
import org.junit.Assert.*
import org.junit.Test

class PeerClientTest {
    private val token: String = Base64.getUrlEncoder().withoutPadding()
        .encodeToString(ByteArray(32) { it.toByte() })
    private val fingerprint = "aF".repeat(32)

    private fun config(
        host: String = "192.168.1.10",
        port: Int = 443,
        fingerprint: String = this.fingerprint,
        token: String = this.token,
    ) = PeerConfig(host, port, fingerprint, token)

    private fun assertInvalid(block: () -> Unit) {
        assertThrows(IllegalArgumentException::class.java) { block() }
    }

    private fun assertRejected(block: () -> Unit) {
        try {
            block()
            fail("Expected value to be rejected")
        } catch (_: Exception) {
        }
    }

    @Test fun acceptsOnlyCanonicalPrivateOrLoopbackIpv4Endpoints() {
        listOf(
            "10.0.0.1",
            "10.255.255.255",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.0.1",
            "192.168.255.255",
            "127.0.0.1",
        ).forEach { host -> assertEquals(host, config(host = host).host) }

        listOf(
            "8.8.8.8",
            "172.15.255.255",
            "172.32.0.1",
            "127.0.0.2",
            "192.168.001.1",
            "192.168.1.01",
            "192.168.1.256",
            "localhost",
            "example.test",
            "::1",
        ).forEach { host -> assertInvalid { config(host = host) } }

        assertInvalid { config(port = 0) }
        assertInvalid { config(port = 65536) }
        assertEquals(1, config(port = 1).port)
        assertEquals(65535, config(port = 65535).port)
    }

    @Test fun validatesFingerprintAndCanonicalBase64UrlTokenAndRedactsToken() {
        assertEquals(fingerprint, config().fingerprint)
        assertInvalid { config(fingerprint = "a".repeat(63)) }
        assertInvalid { config(fingerprint = "g".repeat(64)) }

        assertEquals(43, token.length)
        assertEquals(token, config().token)
        assertInvalid { config(token = token + "=") }
        assertInvalid { config(token = token.dropLast(1)) }
        assertInvalid { config(token = "/" + token.drop(1)) }
        assertInvalid { config(token = token.dropLast(1) + "B") }

        val rendered = config().toString()
        assertFalse(rendered.contains(token))
    }

    @Test fun parseUsesInjectedDecoderAndRequiresVersionOneAsAnInteger() {
        var seenRaw: String? = null
        val decoded = mapOf<String, Any?>(
            "version" to 1,
            "host" to "10.2.3.4",
            "port" to 8443,
            "fingerprint" to fingerprint,
            "token" to token,
        )
        val parsed = PeerConfig.parse("fixture") { raw ->
            seenRaw = raw
            decoded
        }
        assertEquals("fixture", seenRaw)
        assertEquals(PeerConfig("10.2.3.4", 8443, fingerprint, token), parsed)

        listOf<Any?>(0, 2, 1.0, "1", null).forEach { version ->
            assertInvalid {
                PeerConfig.parse("fixture") { decoded + ("version" to version) }
            }
        }
    }

    @Test fun validateDaysChecksShapeCalendarAndLimitWhileKeepingDuplicates() {
        val input = mutableListOf("2026-09-25", "2026-09-25", "2024-02-29")
        val validated = PeerProtocol.validateDays(input)
        assertEquals(input, validated)
        assertNotSame(input, validated)
        input[0] = "2026-09-24"
        assertEquals("2026-09-25", validated[0])

        listOf("2026-9-25", "2026-09-5", "2026-02-29", "2026-13-01", "2026-00-01").forEach { day ->
            assertInvalid { PeerProtocol.validateDays(listOf(day)) }
        }

        val thirtyTwo = List(32) { LocalDate.of(2026, 1, 1).plusDays(it.toLong()).toString() }
        assertEquals(thirtyTwo, PeerProtocol.validateDays(thirtyTwo))
        assertInvalid { PeerProtocol.validateDays(thirtyTwo + "2026-02-02") }
    }

    @Test fun parseResponseUsesInjectedDecoderAndRejectsBadVersionOrDayTypes() {
        var seenRaw: String? = null
        val decoded = mapOf<String, Any?>(
            "version" to 1,
            "completedDays" to listOf("2026-09-25", "2026-09-25"),
        )
        val parsed = PeerProtocol.parseResponse("fixture") { raw ->
            seenRaw = raw
            decoded
        }
        assertEquals("fixture", seenRaw)
        assertEquals(listOf("2026-09-25", "2026-09-25"), parsed)

        listOf<Any?>(0, 2, 1.0, "1", null).forEach { version ->
            assertInvalid {
                PeerProtocol.parseResponse("fixture") { decoded + ("version" to version) }
            }
        }
        listOf<Any?>(null, "2026-09-25", listOf("2026-09-25", 20260926)).forEach { days ->
            assertInvalid {
                PeerProtocol.parseResponse("fixture") { decoded + ("completedDays" to days) }
            }
        }
    }

    @Test fun parseResponseAndReadBoundedEnforceThe8192ByteLimit() {
        val exact = ByteArray(PeerProtocol.MAX_BYTES) { 'x'.code.toByte() }
        assertArrayEquals(exact, PeerProtocol.readBounded(ByteArrayInputStream(exact)))

        val oversized = ByteArray(PeerProtocol.MAX_BYTES + 1) { 'x'.code.toByte() }
        assertThrows(IOException::class.java) {
            PeerProtocol.readBounded(ByteArrayInputStream(oversized))
        }
        assertInvalid {
            PeerProtocol.parseResponse("é".repeat(PeerProtocol.MAX_BYTES / 2 + 1)) {
                mapOf("version" to 1, "completedDays" to emptyList<String>())
            }
        }
    }

    @Test fun trustManagerPinsOnlyTheLeafAndChecksItsValidity() {
        val leaf = FakeCertificate("self-signed-leaf".toByteArray())
        val unrelatedIssuer = FakeCertificate("unrelated-issuer".toByteArray())
        val pin = sha256Hex(leaf.encoded)
        val manager = PinnedPeerTrustManager(pin)

        manager.checkServerTrusted(arrayOf(leaf), "RSA")
        manager.checkServerTrusted(arrayOf(leaf, unrelatedIssuer), "RSA")

        assertRejected { manager.checkServerTrusted(arrayOf(FakeCertificate("other".toByteArray())), "RSA") }
        assertRejected { manager.checkServerTrusted(arrayOf(FakeCertificate(leaf.encoded, Validity.EXPIRED)), "RSA") }
        assertRejected { manager.checkServerTrusted(arrayOf(FakeCertificate(leaf.encoded, Validity.NOT_YET_VALID)), "RSA") }
        assertRejected { manager.checkServerTrusted(emptyArray(), "RSA") }

        val asInterface: X509TrustManager = manager
        assertRejected { asInterface.checkServerTrusted(null, "RSA") }
    }

    @Test fun hostnameVerifierUsesThePinnedLeafAsPeerIdentity() {
        val leaf = FakeCertificate("peer-leaf".toByteArray())
        val pin = sha256Hex(leaf.encoded)
        val verifier = peerHostnameVerifier(pin)

        assertTrue(verifier.verify("name-not-present-in-certificate.example", sslSession(leaf)))
        assertFalse(verifier.verify("anything.example", sslSession(FakeCertificate("other".toByteArray()))))
        assertFalse(verifier.verify("anything.example", sslSession()))
        assertFalse(
            verifier.verify(
                "anything.example",
                sslSession(FakeCertificate(leaf.encoded, Validity.EXPIRED)),
            ),
        )
    }

    private fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { byte -> (byte.toInt() and 0xff).toString(16).padStart(2, '0') }

    private fun sslSession(vararg certificates: X509Certificate): SSLSession {
        return java.lang.reflect.Proxy.newProxyInstance(
            SSLSession::class.java.classLoader,
            arrayOf(SSLSession::class.java),
        ) { _, method, _ ->
            when (method.name) {
                "getPeerCertificates" -> {
                    if (certificates.isEmpty()) throw SSLPeerUnverifiedException("no peer certificate")
                    Array<Certificate>(certificates.size) { certificates[it] }
                }
                "getPeerHost" -> "fixture.invalid"
                "getPeerPort", "getPacketBufferSize", "getApplicationBufferSize" -> 0
                "getCreationTime", "getLastAccessedTime" -> 0L
                "isValid" -> true
                "getId" -> ByteArray(0)
                "getValueNames" -> emptyArray<String>()
                "getCipherSuite", "getProtocol" -> "fixture"
                else -> null
            }
        } as SSLSession
    }

    private enum class Validity { VALID, EXPIRED, NOT_YET_VALID }

    private class FakeCertificate(
        private val bytes: ByteArray,
        private val validity: Validity = Validity.VALID,
    ) : X509Certificate() {
        override fun checkValidity() {
            when (validity) {
                Validity.VALID -> Unit
                Validity.EXPIRED -> throw java.security.cert.CertificateExpiredException("expired")
                Validity.NOT_YET_VALID -> throw java.security.cert.CertificateNotYetValidException("not yet valid")
            }
        }

        override fun checkValidity(date: Date) = checkValidity()
        override fun getVersion(): Int = 3
        override fun getSerialNumber(): BigInteger = BigInteger.ONE
        override fun getIssuerDN(): Principal = X500Principal("CN=Self Signed Fixture")
        override fun getSubjectDN(): Principal = X500Principal("CN=Self Signed Fixture")
        override fun getNotBefore(): Date = Date(0)
        override fun getNotAfter(): Date = Date(Long.MAX_VALUE)
        override fun getTBSCertificate(): ByteArray = bytes.clone()
        override fun getSignature(): ByteArray = ByteArray(0)
        override fun getSigAlgName(): String = "NONE"
        override fun getSigAlgOID(): String = "0.0"
        override fun getSigAlgParams(): ByteArray? = null
        override fun getIssuerUniqueID(): BooleanArray? = null
        override fun getSubjectUniqueID(): BooleanArray? = null
        override fun getKeyUsage(): BooleanArray? = null
        override fun getBasicConstraints(): Int = -1
        override fun getEncoded(): ByteArray = bytes.clone()
        override fun verify(key: PublicKey) = Unit
        override fun verify(key: PublicKey, sigProvider: String) = Unit
        override fun toString(): String = "FakeCertificate"
        override fun getPublicKey(): PublicKey? = null
        override fun hasUnsupportedCriticalExtension(): Boolean = false
        override fun getCriticalExtensionOIDs(): MutableSet<String>? = null
        override fun getNonCriticalExtensionOIDs(): MutableSet<String>? = null
        override fun getExtensionValue(oid: String): ByteArray? = null
    }
}
