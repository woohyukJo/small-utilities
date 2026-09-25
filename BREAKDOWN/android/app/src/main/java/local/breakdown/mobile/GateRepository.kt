package local.breakdown.mobile

import android.content.Context
import android.util.Base64
import local.breakdown.mobile.core.*
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/** Local gate state only: no conversation text, browser cookies, or account credentials. */
class GateRepository(context: Context) {
    private val preferences = context.getSharedPreferences("breakdown_gate", Context.MODE_PRIVATE)
    val engine = GateEngine(load())
    private val listeners = mutableSetOf<() -> Unit>()

    fun listen(listener: () -> Unit) { listeners.add(listener) }
    fun unlisten(listener: () -> Unit) { listeners.remove(listener) }
    fun hasPassword(): Boolean = preferences.contains("passwordHash")
    fun peerConfiguration(): String? = preferences.getString("peer.config", null)
    fun setPeerConfiguration(raw: String?) {
        check(preferences.edit().putString("peer.config", raw).commit())
    }
    fun completedDays(): List<String> = ((preferences.getStringSet("completedDays", emptySet()) ?: emptySet()) +
        engine.persistedState().peerCompletedDays).sortedDescending().take(32)

    fun update(action: (GateEngine) -> Unit): GateStatus {
        action(engine)
        val state = engine.persistedState()
        val turns = JSONArray()
        state.turns.forEach { turn -> turns.put(JSONObject().apply {
            put("conversationId", turn.conversationId)
            put("userId", turn.userMessageId)
            put("assistantId", turn.assistantMessageId ?: JSONObject.NULL)
            put("state", turn.state.name)
        }) }
        val json = JSONObject().apply {
            put("armed", state.armed)
            put("conversationId", state.targetConversationId ?: JSONObject.NULL)
            put("revision", state.targetRevision)
            put("ready", state.testReady)
            put("day", state.activeDayKey ?: JSONObject.NULL)
            put("reason", state.unlockReason?.name ?: JSONObject.NULL)
            put("turns", turns)
            put("peerCompletedDays", JSONArray(state.peerCompletedDays.toList()))
        }
        val days = (preferences.getStringSet("completedDays", emptySet()) ?: emptySet()).toMutableSet()
        if (state.unlockReason != null) state.activeDayKey?.let { days.add(it) }
        check(preferences.edit().putString("state.v1", json.toString()).putStringSet("completedDays", days.sortedDescending().take(32).toSet()).commit()) { "진행 상태를 저장하지 못했습니다." }
        listeners.toList().forEach { it() }
        return engine.status()
    }

    data class PreparedPassword(val salt: String, val hash: String, val previousHash: String?)

    fun preparePassword(password: CharArray, current: CharArray = charArrayOf()): PreparedPassword {
        require(password.isNotEmpty() && password.size <= 1024) { "비밀번호는 1~1024자로 입력하세요." }
        val status = engine.status()
        check(!status.armed || status.unlocked) { "잠금 해제 후 비밀번호를 변경하세요." }
        if (hasPassword()) require(checkPassword(current)) { "기존 비밀번호를 확인하세요." }
        val previousHash = preferences.getString("passwordHash", null)
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val hash = derive(password, salt)
        return PreparedPassword(encode(salt), encode(hash), previousHash)
    }
    fun commitPassword(prepared: PreparedPassword) {
        val status = engine.status()
        check(!status.armed || status.unlocked) { "잠금 해제 후 비밀번호를 변경하세요." }
        check(preferences.getString("passwordHash", null) == prepared.previousHash) { "비밀번호가 변경됐어요. 다시 확인하세요." }
        check(preferences.edit().putString("passwordSalt", prepared.salt).putString("passwordHash", prepared.hash).commit())
    }

    fun checkPassword(password: CharArray): Boolean {
        if (!hasPassword() || password.size > 1024) return false
        val salt = Base64.decode(preferences.getString("passwordSalt", ""), Base64.NO_WRAP)
        val expected = Base64.decode(preferences.getString("passwordHash", ""), Base64.NO_WRAP)
        return MessageDigest.isEqual(expected, derive(password, salt))
    }

    private fun load(): GatePersistentState {
        val raw = preferences.getString("state.v1", null) ?: return GatePersistentState()
        // Do not silently reset an existing armed gate if a persisted record cannot be decoded.
        val json = JSONObject(raw)
        fun optional(name: String) = if (json.isNull(name)) null else json.getString(name)
        val list = json.getJSONArray("turns")
        val turns = (0 until list.length()).map { index ->
            val turn = list.getJSONObject(index)
            GateTurn(turn.getString("conversationId"), turn.getString("userId"),
                if (turn.isNull("assistantId")) null else turn.getString("assistantId"), TurnState.valueOf(turn.getString("state")))
        }
        val peerDays = json.optJSONArray("peerCompletedDays") ?: JSONArray()
        return GatePersistentState(json.getBoolean("armed"), optional("conversationId"), json.getLong("revision"),
            json.getBoolean("ready"), optional("day"), turns, optional("reason")?.let(UnlockReason::valueOf),
            (0 until peerDays.length()).map { peerDays.getString(it) }.toSet())
    }

    private fun derive(password: CharArray, salt: ByteArray): ByteArray {
        val specification = PBEKeySpec(password, salt, 210000, 256)
        return try { SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(specification).encoded }
        finally { specification.clearPassword() }
    }
    private fun encode(value: ByteArray) = Base64.encodeToString(value, Base64.NO_WRAP)
}
