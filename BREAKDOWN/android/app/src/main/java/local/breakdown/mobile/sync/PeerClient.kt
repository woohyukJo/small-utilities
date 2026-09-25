package local.breakdown.mobile.sync

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetAddress
import java.net.Proxy
import java.net.Socket
import java.net.URL
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.time.LocalDate
import java.util.Base64
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.X509TrustManager
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/** User-paired peer identity. Construction (including copy) validates all endpoint and credential fields. */
data class PeerConfig(val host: String, val port: Int, val fingerprint: String, val token: String) {
    init {
        val parts = host.split('.')
        require(parts.size == 4 && parts.all {
            it.matches(Regex("0|[1-9][0-9]{0,2}")) && it.toInt() in 0..255
        }) { "Peer must use a literal private IPv4 address." }
        val octets = parts.map(String::toInt)
        require(host == "127.0.0.1" || octets[0] == 10 ||
            (octets[0] == 172 && octets[1] in 16..31) ||
            (octets[0] == 192 && octets[1] == 168)) { "Peer must use a private IPv4 address." }
        require(port in 1..65535) { "Invalid peer port." }
        pinBytes(fingerprint)
        require(token.matches(Regex("[A-Za-z0-9_-]{43}"))) { "Invalid peer token." }
        val decoded = Base64.getUrlDecoder().decode(token)
        require(decoded.size == 32 && Base64.getUrlEncoder().withoutPadding().encodeToString(decoded) == token) {
            "Invalid peer token."
        }
    }

    override fun toString(): String = "PeerConfig(host=$host, port=$port, fingerprint=$fingerprint, token=<redacted>)"

    companion object {
        /** Android JSON implementation; no Android context or persistence is involved. */
        fun parse(raw: String): PeerConfig = parse(raw, ::decodeJsonObject)

        /** Pure decoder seam for JVM tests. Returned values must retain their JSON types. */
        fun parse(raw: String, decode: (String) -> Map<String, Any?>): PeerConfig {
            try {
                require(raw.length <= PeerProtocol.MAX_BYTES)
                val fields = decode(raw)
                require(isVersionOne(fields["version"]))
                val port = fields["port"]
                require(port is Int || port is Long)
                val portValue = (port as Number).toLong()
                require(portValue in 1..65535)
                return PeerConfig(
                    fields["host"] as String, portValue.toInt(),
                    fields["fingerprint"] as String, fields["token"] as String,
                )
            } catch (_: Exception) {
                // JSON exceptions can contain source text, including the bearer token.
                throw IllegalArgumentException("Invalid peer pairing.")
            }
        }
    }
}

/** Blocking client: callers must run exchange off the UI thread and persist any result themselves. */
class PeerClient {
    @Throws(IOException::class)
    fun exchange(config: PeerConfig, completedDays: List<String>): List<String> {
        val days = PeerProtocol.validateDays(completedDays)
        // Dates have a restricted alphabet, so serialization cannot introduce JSON escaping or content.
        val body = "{\"version\":1,\"completedDays\":[${days.joinToString(",") { "\"$it\"" }}]}"
            .toByteArray(Charsets.UTF_8)
        val context = SSLContext.getInstance("TLSv1.2").apply {
            init(null, arrayOf(PinnedPeerTrustManager(config.fingerprint)), null)
        }
        val connection = URL("https", config.host, config.port, "/v1/sync")
            .openConnection(Proxy.NO_PROXY) as HttpsURLConnection
        try {
            connection.sslSocketFactory = Tls12SocketFactory(context.socketFactory)
            connection.hostnameVerifier = peerHostnameVerifier(config.fingerprint)
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 5_000
            connection.readTimeout = 5_000
            connection.useCaches = false
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("Authorization", "Bearer ${config.token}")
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Accept-Encoding", "identity")
            connection.setFixedLengthStreamingMode(body.size)
            connection.outputStream.use { it.write(body) }
            if (connection.responseCode != 200) throw IOException("Peer sync request failed.")
            if (connection.contentLengthLong > PeerProtocol.MAX_BYTES) throw IOException("Peer response is too large.")
            val bytes = connection.inputStream.use(PeerProtocol::readBounded)
            try {
                val json = Charsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes)).toString()
                return PeerProtocol.parseResponse(json)
            } catch (_: Exception) {
                throw IOException("Invalid peer sync response.")
            }
        } finally {
            try { connection.errorStream?.close() } finally { connection.disconnect() }
        }
    }
}

internal object PeerProtocol {
    const val MAX_BYTES = 8192

    fun validateDays(days: List<String>): List<String> {
        val snapshot = days.toList()
        require(snapshot.size <= 32) { "At most 32 completion days are allowed." }
        for (day in snapshot) {
            require(day.matches(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}"))) { "Invalid completion day." }
            try {
                require(LocalDate.parse(day).toString() == day)
            } catch (_: Exception) {
                throw IllegalArgumentException("Invalid completion day.")
            }
        }
        return snapshot
    }

    fun parseResponse(raw: String, decode: (String) -> Map<String, Any?> = ::decodeJsonObject): List<String> {
        require(raw.toByteArray(Charsets.UTF_8).size <= MAX_BYTES) { "Peer response is too large." }
        val fields = decode(raw)
        require(isVersionOne(fields["version"])) { "Invalid sync version." }
        val values = fields["completedDays"] as? List<*> ?: throw IllegalArgumentException("Missing completion days.")
        require(values.size <= 32 && values.all { it is String }) { "Invalid completion days." }
        return validateDays(values.map { it as String })
    }

    fun readBounded(input: InputStream): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(1024)
        while (true) {
            val read = input.read(buffer, 0, minOf(buffer.size, MAX_BYTES + 1 - output.size()))
            if (read < 0) return output.toByteArray()
            output.write(buffer, 0, read)
            if (output.size() > MAX_BYTES) throw IOException("Peer response is too large.")
        }
    }
}

/** Pinning is the sole peer identity check, including for a self-signed leaf. Dates still must be valid. */
internal class PinnedPeerTrustManager(fingerprint: String) : X509TrustManager {
    private val expected = pinBytes(fingerprint)

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        val leaf = chain?.firstOrNull() ?: throw CertificateException("Peer certificate is missing.")
        leaf.checkValidity()
        if (!MessageDigest.isEqual(expected, MessageDigest.getInstance("SHA-256").digest(leaf.encoded))) {
            throw CertificateException("Peer certificate does not match pairing.")
        }
    }

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        throw CertificateException("Client authentication is unsupported.")
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

internal fun peerHostnameVerifier(fingerprint: String): HostnameVerifier {
    val trust = PinnedPeerTrustManager(fingerprint)
    return HostnameVerifier { _, session ->
        try {
            val leaf = session.peerCertificates.firstOrNull() as? X509Certificate
            if (leaf == null) false else {
                trust.checkServerTrusted(arrayOf(leaf), null)
                true
            }
        } catch (_: Exception) { false }
    }
}

private fun pinBytes(fingerprint: String): ByteArray {
    require(fingerprint.matches(Regex("[A-Fa-f0-9]{64}"))) { "Invalid peer certificate fingerprint." }
    return fingerprint.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}

private fun isVersionOne(value: Any?): Boolean = value == 1 || value == 1L

private fun decodeJsonObject(raw: String): Map<String, Any?> {
    val tokenizer = JSONTokener(raw)
    val obj = tokenizer.nextValue() as? JSONObject ?: throw IllegalArgumentException("Expected an object.")
    require(tokenizer.nextClean() == '\u0000') { "Unexpected trailing JSON." }
    return obj.keys().asSequence().associateWith { key ->
        when (val value = obj.get(key)) {
            JSONObject.NULL -> null
            is JSONArray -> (0 until value.length()).map { value.get(it) }
            else -> value
        }
    }
}

/** Explicit TLS 1.2 avoids provider defaults that can enable legacy protocol versions on Android. */
private class Tls12SocketFactory(private val delegate: SSLSocketFactory) : SSLSocketFactory() {
    private fun configure(socket: Socket): Socket = (socket as SSLSocket).apply {
        enabledProtocols = arrayOf("TLSv1.2")
    }
    override fun getDefaultCipherSuites(): Array<String> = delegate.defaultCipherSuites
    override fun getSupportedCipherSuites(): Array<String> = delegate.supportedCipherSuites
    override fun createSocket(): Socket = configure(delegate.createSocket())
    override fun createSocket(s: Socket, host: String, port: Int, autoClose: Boolean): Socket =
        configure(delegate.createSocket(s, host, port, autoClose))
    override fun createSocket(host: String, port: Int): Socket = configure(delegate.createSocket(host, port))
    override fun createSocket(host: String, port: Int, local: InetAddress, localPort: Int): Socket =
        configure(delegate.createSocket(host, port, local, localPort))
    override fun createSocket(host: InetAddress, port: Int): Socket = configure(delegate.createSocket(host, port))
    override fun createSocket(host: InetAddress, port: Int, local: InetAddress, localPort: Int): Socket =
        configure(delegate.createSocket(host, port, local, localPort))
}
