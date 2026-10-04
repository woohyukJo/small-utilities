package local.breakdown.mobile.browser

import org.json.JSONObject
import java.io.BufferedInputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore

/** Device-local extension transport. No cookies, passwords, message bodies or LAN listener. */
class BrowserBridgeServer(
    private val token: String,
    private val handler: (String, JSONObject) -> JSONObject,
    private val port: Int = 18432,
) : AutoCloseable {
    private val executor = Executors.newCachedThreadPool { runnable -> Thread(runnable, "breakdown-browser").apply { isDaemon = true } }
    private val slots = Semaphore(4)
    private val server = ServerSocket(port, 4, InetAddress.getByName("127.0.0.1"))
    val localPort: Int get() = server.localPort

    init {
        executor.execute {
            while (!server.isClosed) {
                val socket = try { server.accept() } catch (_: Exception) { break }
                if (!slots.tryAcquire()) { socket.close(); continue }
                executor.execute { try { serve(socket) } finally { slots.release() } }
            }
        }
    }

    private fun serve(socket: Socket) {
        socket.use {
            try {
                socket.soTimeout = 3000
                val input = BufferedInputStream(socket.getInputStream())
                var headerBytes = 0
                fun line(): String {
                    val bytes = ArrayList<Byte>()
                    while (true) {
                        val value = input.read()
                        require(value >= 0 && ++headerBytes <= 8192) { "Invalid HTTP header" }
                        if (value == 10) break
                        bytes.add(value.toByte())
                    }
                    return bytes.toByteArray().toString(StandardCharsets.US_ASCII).trimEnd('\r')
                }
                val request = line().split(' ')
                require(request.size == 3)
                val headers = mutableMapOf<String, String>()
                while (true) {
                    val row = line()
                    if (row.isEmpty()) break
                    val separator = row.indexOf(':')
                    require(separator > 0)
                    val name = row.substring(0, separator).lowercase()
                    require(name !in headers)
                    headers[name] = row.substring(separator + 1).trim()
                }
                require(headers["host"] == "127.0.0.1:$localPort")
                require(headers["transfer-encoding"] == null)
                if (request[0] == "GET" && request[1] == "/pair") {
                    reply(socket, 200, "text/html; charset=utf-8", "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>BREAKDOWN 연결</title><p>Firefox 확장 연결을 확인하고 있어요. 그대로 멈추면 확장이 설치되어 있는지 확인하세요.</p>")
                    return
                }
                if (!MessageDigest.isEqual((headers["authorization"] ?: "").toByteArray(), "Bearer $token".toByteArray())) {
                    reply(socket, 401, "application/json", "{\"error\":\"연결 코드를 확인하세요.\"}")
                    return
                }
                require(request[0] == "POST" && request[1] in setOf("/v1/state", "/v1/events", "/v1/target"))
                val length = headers["content-length"]?.toIntOrNull() ?: 0
                require(length in 0..32768)
                val body = ByteArray(length)
                var offset = 0
                while (offset < length) {
                    val count = input.read(body, offset, length - offset)
                    require(count > 0)
                    offset += count
                }
                val result = handler(request[1], if (length == 0) JSONObject() else JSONObject(body.toString(StandardCharsets.UTF_8)))
                reply(socket, 200, "application/json", result.toString())
            } catch (_: Exception) {
                runCatching { reply(socket, 400, "application/json", "{\"error\":\"연결 요청을 처리하지 못했어요. 다시 연결하세요.\"}") }
            }
        }
    }

    private fun reply(socket: Socket, status: Int, type: String, body: String) {
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        val header = "HTTP/1.1 $status Result\r\nContent-Type: $type\r\nContent-Length: ${bytes.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        socket.getOutputStream().apply { write(header.toByteArray(StandardCharsets.US_ASCII)); write(bytes); flush() }
    }

    override fun close() { server.close(); executor.shutdownNow() }
}
