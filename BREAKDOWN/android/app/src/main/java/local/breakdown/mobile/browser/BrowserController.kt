package local.breakdown.mobile.browser

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.os.Handler
import android.os.Looper
import local.breakdown.mobile.ChatAddress
import local.breakdown.mobile.GateRepository
import local.breakdown.mobile.core.TurnState
import org.json.JSONArray
import org.json.JSONObject

/** All gate access runs on the application's main thread; HTTP is only a transport. */
class BrowserController(private val context: Context, private val gate: GateRepository) {
    var lastError: String? = null
    var serviceRunning = false
    private var lastContact = 0L
    private var openingUntil = 0L
    private var testUser: String? = null
    private var testScope: String? = null
    fun connected(): Boolean = lastContact > 0 && SystemClock.elapsedRealtime() - lastContact < 10000
    fun browserAllowed(): Boolean = connected() || SystemClock.elapsedRealtime() < openingUntil
    fun locked(): Boolean = gate.routineEnabled() && gate.engine.status().let { it.armed && !it.unlocked }
    private fun scope(): String = gate.engine.status().let { "firefox:${it.activeDayKey ?: "setup"}:${it.targetRevision}" }

    fun openConversation(pair: Boolean = false) {
        BrowserBridgeService.ensureRunning(context)
        val target = gate.engine.status().targetConversationId
        val url = if (pair) "http://127.0.0.1:18432/pair#key=${gate.browserToken()}"
            else target?.let(ChatAddress::url) ?: "https://chatgpt.com/"
        openingUntil = SystemClock.elapsedRealtime() + 15000
        val main = Handler(Looper.getMainLooper())
        fun launch(attempts: Int) {
            if (!serviceRunning) {
                if (attempts > 0) main.postDelayed({ launch(attempts - 1) }, 100)
                else lastError = "Firefox 연결을 시작하지 못했어요. 앱을 다시 열어 주세요."
                return
            }
            runCatching {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage("org.mozilla.firefox")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }.onFailure { lastError = "Firefox를 설치하고 다시 시도해 주세요." }
        }
        launch(30)
    }

    fun handle(route: String, payload: JSONObject): JSONObject {
        val status = gate.engine.status()
        if (route == "/v1/target") {
            val id = ChatAddress.conversationId(payload.getString("url")) ?: error("Invalid conversation")
            gate.update { it.selectConversation(id) }
            testUser = null
        }
        if (route == "/v1/events") {
            require(payload.getString("scope") == scope())
            require(payload.getString("conversationId") == status.targetConversationId)
            val target = status.targetConversationId ?: error("No target")
            val events = payload.getJSONArray("events")
            require(events.length() <= 64)
            // Validate the entire batch before changing the engine.
            val parsed = (0 until events.length()).map { i ->
                val event = events.getJSONObject(i)
                val type = event.getString("type")
                require(type in setOf("submitted", "aborted", "completed"))
                val user = event.getString("userId")
                val assistant = if (type == "completed") event.getString("assistantId") else null
                for (id in listOfNotNull(user, assistant)) require(id.isNotEmpty() && id.length <= 200 && id.none(Char::isISOControl))
                Triple(type, user, assistant)
            }
            if (testScope != scope()) { testUser = null; testScope = scope() }
            if (parsed.isNotEmpty()) gate.update { engine ->
                for ((type, user, assistant) in parsed) {
                    if (!status.armed) {
                        if (type == "submitted") testUser = user
                        if (type == "aborted" && testUser == user) testUser = null
                        if (type == "completed" && testUser == user) {
                            engine.markTestReady(target, status.targetRevision); testUser = null
                        }
                    } else when (type) {
                        "submitted" -> engine.submitUser(target, status.targetRevision, user)
                        "aborted" -> engine.abortUser(target, status.targetRevision, user)
                        "completed" -> engine.completeAssistant(target, status.targetRevision, user, assistant!!)
                    }
                }
            }
        }
        // Only the extension's background control loop grants the Firefox window lease.
        if (payload.optBoolean("browserReady")) lastContact = SystemClock.elapsedRealtime()
        lastError = null
        return state()
    }

    fun state(): JSONObject {
        val status = gate.engine.status()
        val turns = gate.engine.persistedState().turns.filter { it.conversationId == status.targetConversationId }
        return JSONObject().apply {
            put("conversationId", status.targetConversationId ?: JSONObject.NULL)
            put("scope", scope())
            put("pendingUserIds", JSONArray(turns.filter { it.state == TurnState.PENDING }.map { it.userMessageId }))
            put("abortedUserIds", JSONArray(turns.filter { it.state == TurnState.ABORTED }.map { it.userMessageId }))
            put("count", status.completedCount); put("unlocked", status.unlocked)
            put("connected", connected())
            put("locked", locked()); put("testOnly", false); put("ready", status.testReady)
        }
    }
}
