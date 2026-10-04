package local.breakdown.mobile

import android.app.Activity
import android.app.Instrumentation
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import local.breakdown.mobile.browser.BrowserBridgeServer
import org.json.JSONArray
import org.json.JSONObject
import java.net.Socket
import java.time.Instant
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

class BrowserIntegrationProbe : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
    override fun onStart() {
        try {
            waitForIdleSync()
            check(targetContext.packageName.endsWith(".verification"))
            val app = targetContext.applicationContext as BreakdownApplication
            check(!app.gate.engine.status().armed) { "Use a fresh verification profile" }
            runOnMainSync {
                app.gate.update {
                    it.selectConversation("browser-test")
                    it.markTestReady("browser-test", it.status().targetRevision)
                    it.arm(Instant.now())
                }
            }
            val token = "fixture-only-key"
            BrowserBridgeServer(token, { route, payload ->
                val task = FutureTask { app.browser.handle(route, payload) }
                Handler(Looper.getMainLooper()).post(task); task.get(3, TimeUnit.SECONDS)
            }, 0).use { server ->
                fun call(route: String, body: JSONObject = JSONObject(), key: String = token): Pair<Int, JSONObject> {
                    Socket("127.0.0.1", server.localPort).use { socket ->
                        socket.soTimeout = 5000
                        val bytes = body.toString().toByteArray(Charsets.UTF_8)
                        socket.getOutputStream().write(("POST $route HTTP/1.1\r\nHost: 127.0.0.1:${server.localPort}\r\nAuthorization: Bearer $key\r\nContent-Length: ${bytes.size}\r\n\r\n").toByteArray())
                        socket.getOutputStream().write(bytes); socket.getOutputStream().flush()
                        val response = socket.getInputStream().bufferedReader().readText()
                        return response.substringBefore("\r\n").split(' ')[1].toInt() to JSONObject(response.substringAfter("\r\n\r\n"))
                    }
                }
                check(call("/v1/state", key = "wrong").first == 401)
                val initial = call("/v1/state", JSONObject().put("browserReady", true)).second
                check(!initial.getBoolean("locked")) { "Upgrade/connection must not enable locking" }
                check(initial.getBoolean("connected"))
                check(app.browser.connected())
                runOnMainSync { app.gate.setRoutineEnabled(true) }
                check(call("/v1/state").second.getBoolean("locked"))
                fun event(type: String, n: Int) = JSONObject().put("type", type).put("userId", "u$n").apply {
                    if (type == "completed") put("assistantId", "a$n")
                }
                fun batch(events: List<JSONObject>, scope: String = initial.getString("scope")) = JSONObject()
                    .put("conversationId", "browser-test").put("scope", scope).put("events", JSONArray(events))
                check(call("/v1/events", batch(listOf(event("submitted",1)), "stale")).first == 400)
                val first = batch(listOf(event("submitted",1), event("completed",1)))
                check(call("/v1/events", first).second.getInt("count") == 1)
                check(call("/v1/events", first).second.getInt("count") == 1)
                val invalid = batch(listOf(event("submitted",2), JSONObject().put("type","unknown").put("userId","bad")))
                check(call("/v1/events", invalid).first == 400)
                check(app.gate.engine.persistedState().turns.none { it.userMessageId == "u2" })
                check(call("/v1/events", batch(listOf(event("submitted",2), event("aborted",2), event("completed",2)))).second.getInt("count") == 1)
                check(call("/v1/events", batch(listOf(event("submitted",2), event("completed",2)))).second.getInt("count") == 2)
                val final = call("/v1/events", batch(listOf(event("submitted",3), event("completed",3)))).second
                check(final.getInt("count") == 3 && final.getBoolean("unlocked") && !final.getBoolean("locked"))
                check(GateRepository(targetContext).engine.status().completedCount == 3)
                check(call("/v1/target", JSONObject().put("url", "https://chatgpt.com/c/replacement")).first == 200)
                check(call("/v1/events", first).first == 400)
            }
            runOnMainSync { app.gate.setRoutineEnabled(false) }
            finish(Activity.RESULT_OK, Bundle().apply { putString("result", "PASS production browser controller over loopback: opt-in lock, auth, scope, atomic validation, duplicates, abort/retry, 1-2-3 unlock and persistence") })
        } catch (error: Throwable) { finish(Activity.RESULT_CANCELED, Bundle().apply { putString("error", error.toString()) }) }
    }
}
