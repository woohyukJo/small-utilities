package local.breakdown.mobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import local.breakdown.mobile.browser.BrowserBridgeServer
import local.breakdown.mobile.core.TurnState
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import java.time.Instant
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

/** Runs the browser round trip with a separate package and gate; never enables blocking. */
class BrowserBridgeActivity : Activity() {
    private val gate get() = (application as BreakdownApplication).gate
    private lateinit var label: TextView
    private val refresh = { render() }
    companion object { private var server: BrowserBridgeServer? = null }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        check(packageName.endsWith(".verification"))
        startForegroundService(Intent(this, BrowserProbeService::class.java))
        val target = intent.getStringExtra("conversation")
        if (gate.engine.status().targetConversationId == null) {
            require(!target.isNullOrEmpty())
            gate.update {
                it.selectConversation(target)
                it.markTestReady(target, it.status().targetRevision)
                it.arm(Instant.now())
            }
        }
        val prefs = getSharedPreferences("browser_probe", MODE_PRIVATE)
        val token = prefs.getString("token", null) ?: ByteArray(32).also { SecureRandom().nextBytes(it) }
            .joinToString("") { "%02x".format(it) }.also { prefs.edit().putString("token", it).commit() }
        if (server == null) server = BrowserBridgeServer(token, { route, payload ->
            val task = FutureTask { handle(route, payload) }
            Handler(Looper.getMainLooper()).post(task)
            task.get(3, TimeUnit.SECONDS)
        })
        label = TextView(this).apply { textSize = 22f }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(24, 64, 24, 24)
            addView(label)
            addView(Button(this@BrowserBridgeActivity).apply {
                text = "Firefox 연결 시험"
                setOnClickListener {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("http://127.0.0.1:18432/pair#key=$token")).setPackage("org.mozilla.firefox"))
                }
            })
        })
        gate.listen(refresh); render()
    }
    private fun render() { label.text = "Firefox 연결 시험 ${gate.engine.status().completedCount}/3\n이 시험 앱은 휴대폰을 잠그지 않아요." }
    private fun handle(route: String, payload: JSONObject): JSONObject {
        val before = gate.engine.status()
        val scope = "${before.activeDayKey}:${before.targetRevision}"
        if (route == "/v1/target") {
            val target = ChatAddress.conversationId(payload.getString("url")) ?: error("Invalid conversation")
            gate.update { it.selectConversation(target) }
        }
        if (route == "/v1/events") {
            require(payload.getString("scope") == scope)
            require(payload.getString("conversationId") == before.targetConversationId)
            val events = payload.getJSONArray("events")
            require(events.length() <= 64)
            if (events.length() > 0) gate.update { engine ->
                for (index in 0 until events.length()) {
                    val event = events.getJSONObject(index)
                    val user = event.getString("userId")
                    when (event.getString("type")) {
                        "submitted" -> engine.submitUser(before.targetConversationId!!, before.targetRevision, user)
                        "aborted" -> engine.abortUser(before.targetConversationId!!, before.targetRevision, user)
                        "completed" -> engine.completeAssistant(before.targetConversationId!!, before.targetRevision, user, event.getString("assistantId"))
                        else -> error("Unknown event")
                    }
                }
            }
        }
        val status = gate.engine.status()
        val turns = gate.engine.persistedState().turns.filter { it.conversationId == status.targetConversationId }
        return JSONObject().apply {
            put("conversationId", status.targetConversationId)
            put("scope", "${status.activeDayKey}:${status.targetRevision}")
            put("pendingUserIds", JSONArray(turns.filter { it.state == TurnState.PENDING }.map { it.userMessageId }))
            put("abortedUserIds", JSONArray(turns.filter { it.state == TurnState.ABORTED }.map { it.userMessageId }))
            put("count", status.completedCount)
            put("unlocked", status.unlocked)
            put("testOnly", true)
        }
    }
    override fun onDestroy() { gate.unlisten(refresh); super.onDestroy() }
}
