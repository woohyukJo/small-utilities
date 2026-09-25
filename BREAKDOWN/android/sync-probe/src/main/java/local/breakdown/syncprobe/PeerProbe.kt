package local.breakdown.syncprobe

import android.app.Activity
import android.app.Instrumentation
import android.os.Bundle
import java.util.Base64
import local.breakdown.mobile.sync.PeerClient
import local.breakdown.mobile.sync.PeerConfig

class PeerProbe : Instrumentation() {
    private lateinit var probeArguments: Bundle

    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        probeArguments = Bundle(arguments ?: Bundle())
        // Instrumentation.start() dispatches onStart() on the instrumentation thread.
        start()
    }

    override fun onStart() {
        try {
            val pairing = probeArguments.getString("pairing")
                ?: throw IllegalArgumentException("Missing pairing argument.")
            val completedDay = probeArguments.getString("completedDay")
                ?: throw IllegalArgumentException("Missing completedDay argument.")

            val config = PeerConfig.parse(pairing)
            val client = PeerClient()

            client.exchange(config, emptyList())

            val first = client.exchange(config, listOf(completedDay)).toSet()
            check(completedDay in first)

            val duplicate = client.exchange(config, listOf(completedDay)).toSet()
            check(duplicate == first)

            expectFailure {
                client.exchange(config.copy(token = differentToken(config.token)), emptyList())
            }
            expectFailure {
                client.exchange(
                    config.copy(fingerprint = differentFingerprint(config.fingerprint)),
                    emptyList(),
                )
            }

            finish(
                Activity.RESULT_OK,
                Bundle().apply {
                    putString("stream", "PASS sync-probe\n")
                    putBoolean("success", true)
                },
            )
        } catch (failure: Throwable) {
            finish(
                Activity.RESULT_CANCELED,
                Bundle().apply {
                    putString("stream", "FAIL ${safeClassName(failure)}\n")
                    putBoolean("success", false)
                },
            )
        }
    }

    private fun expectFailure(block: () -> Unit) {
        var failed = false
        try {
            block()
        } catch (_: Exception) {
            failed = true
        }
        check(failed)
    }

    private fun differentToken(token: String): String {
        val bytes = Base64.getUrlDecoder().decode(token)
        bytes[0] = (bytes[0].toInt() xor 1).toByte()
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    private fun differentFingerprint(fingerprint: String): String {
        val replacement = if (fingerprint[0] == '0') '1' else '0'
        return replacement + fingerprint.substring(1)
    }

    private fun safeClassName(failure: Throwable): String =
        failure.javaClass.simpleName.takeIf { it.matches(Regex("[A-Za-z0-9_$]+")) }
            ?: "Throwable"
}
