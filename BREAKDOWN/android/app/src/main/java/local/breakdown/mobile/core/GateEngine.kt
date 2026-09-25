package local.breakdown.mobile.core

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset

/** Time semantics shared by the gate and a future sync adapter. */
object GateTime {
    @JvmField
    val KST_OFFSET: ZoneOffset = ZoneOffset.ofHours(9)

    @JvmField
    val DAY_BOUNDARY: LocalTime = LocalTime.of(4, 0)

    /** Returns the provisional BREAKDOWN day containing [at], using KST 04:00 as its boundary. */
    @JvmStatic
    fun dayKey(at: Instant): String =
        at.atOffset(KST_OFFSET).minusSeconds(DAY_BOUNDARY.toSecondOfDay().toLong()).toLocalDate().toString()

    /** Returns the exact KST 04:00 instant at which [dayKey] starts. */
    @JvmStatic
    fun dayStart(dayKey: String): Instant =
        LocalDate.parse(dayKey).atTime(DAY_BOUNDARY).atOffset(KST_OFFSET).toInstant()
}

enum class UnlockReason {
    CONVERSATION,
    EMERGENCY,
    SYNC,
}

enum class TurnState {
    PENDING,
    ABORTED,
    COMPLETED,
}

data class GateTurn(
    val conversationId: String,
    val userMessageId: String,
    val assistantMessageId: String? = null,
    val state: TurnState,
)

/**
 * Everything the platform persistence layer needs to save. Emergency progress is intentionally absent:
 * reconstructing GateEngine is a process/app restart and must reset that streak only.
 */
data class GatePersistentState(
    val armed: Boolean = false,
    val targetConversationId: String? = null,
    val targetRevision: Long = 0L,
    val testReady: Boolean = false,
    val activeDayKey: String? = null,
    val turns: List<GateTurn> = emptyList(),
    val unlockReason: UnlockReason? = null,
    val peerCompletedDays: Set<String> = emptySet(),
)

data class GateStatus(
    val armed: Boolean,
    val targetConversationId: String?,
    val targetRevision: Long,
    val testReady: Boolean,
    val activeDayKey: String?,
    val completedCount: Int,
    val unlocked: Boolean,
    val unlockReason: UnlockReason?,
    val emergencyStreak: Int,
)

enum class GateRejection {
    INVALID_ID,
    TARGET_REQUIRED,
    TEST_NOT_READY,
    NOT_ARMED,
    NO_ACTIVE_DAY,
    TARGET_MISMATCH,
    STALE_REVISION,
}

class GateRejectedException(
    val rejection: GateRejection,
    message: String,
) : IllegalStateException(message)

/** Pure Kotlin state machine. It has no Android, storage, network, password, timer, or content dependency. */
class GateEngine(persisted: GatePersistentState = GatePersistentState()) {
    private var state: GatePersistentState = persisted.copy(turns = persisted.turns.toList())
    private var emergencyStreak: Int = 0

    @Synchronized
    fun persistedState(): GatePersistentState = state.copy(turns = state.turns.toList())

    @Synchronized
    fun status(): GateStatus = statusUnlocked()

    /** Selects the runtime ChatGPT conversation. Revision changes only when the identity actually changes. */
    @Synchronized
    fun selectConversation(conversationId: String): GateStatus {
        validateId(conversationId)
        if (state.targetConversationId == conversationId) return statusUnlocked()

        val retired = state.turns.map { turn ->
            if (turn.state == TurnState.PENDING) turn.copy(state = TurnState.ABORTED) else turn
        }
        state = state.copy(
            targetConversationId = conversationId,
            targetRevision = state.targetRevision + 1L,
            testReady = false,
            turns = retired,
        )
        return statusUnlocked()
    }

    /** Marks the currently selected revision as having passed the platform's test-chat readiness flow. */
    @Synchronized
    fun markTestReady(conversationId: String, revision: Long): GateStatus {
        validateTargetRequest(conversationId, revision)
        state = state.copy(testReady = true)
        return statusUnlocked()
    }

    /** Arms once. Repeated calls never recompute or roll the day forward. */
    @Synchronized
    fun arm(now: Instant): GateStatus {
        if (state.armed) return statusUnlocked()
        if (state.targetConversationId == null) reject(GateRejection.TARGET_REQUIRED, "Select a conversation before arming.")
        if (!state.testReady) reject(GateRejection.TEST_NOT_READY, "Complete test readiness before arming.")

        state = state.copy(
            armed = true,
            activeDayKey = GateTime.dayKey(now),
            turns = emptyList(),
            unlockReason = if (GateTime.dayKey(now) in state.peerCompletedDays) UnlockReason.SYNC else null,
        )
        emergencyStreak = 0
        return statusUnlocked()
    }

    /**
     * The platform must call this only for an explicit device unlock/session event. This is the only
     * post-arm operation that can roll the provisional KST-04 day forward.
     */
    @Synchronized
    fun onSessionEvent(now: Instant): GateStatus {
        if (!state.armed) return statusUnlocked()
        val nextDay = GateTime.dayKey(now)
        if (state.activeDayKey != nextDay) {
            state = state.copy(
                activeDayKey = nextDay,
                turns = emptyList(),
                unlockReason = if (nextDay in state.peerCompletedDays) UnlockReason.SYNC else null,
            )
            emergencyStreak = 0
        }
        return statusUnlocked()
    }

    /** Records only an opaque user-message identity; no message text/content enters the engine. */
    @Synchronized
    fun submitUser(conversationId: String, revision: Long, userMessageId: String): GateStatus {
        validateMutationContext(conversationId, revision)
        validateId(userMessageId)
        if (state.unlockReason != null) return statusUnlocked()

        val index = state.turns.indexOfFirst {
            it.conversationId == conversationId && it.userMessageId == userMessageId
        }
        state = when {
            index < 0 -> state.copy(
                turns = state.turns + GateTurn(conversationId, userMessageId, state = TurnState.PENDING),
            )
            state.turns[index].state == TurnState.ABORTED -> state.copy(
                turns = state.turns.replaceAt(index, state.turns[index].copy(assistantMessageId = null, state = TurnState.PENDING)),
            )
            else -> state
        }
        return statusUnlocked()
    }

    @Synchronized
    fun abortUser(conversationId: String, revision: Long, userMessageId: String): GateStatus {
        validateMutationContext(conversationId, revision)
        validateId(userMessageId)
        if (state.unlockReason != null) return statusUnlocked()

        val index = state.turns.indexOfFirst {
            it.conversationId == conversationId && it.userMessageId == userMessageId && it.state == TurnState.PENDING
        }
        if (index >= 0) {
            state = state.copy(turns = state.turns.replaceAt(index, state.turns[index].copy(state = TurnState.ABORTED)))
        }
        return statusUnlocked()
    }

    /**
     * Completes a pair only when the matching user identity is currently pending. Historical assistant
     * messages and duplicate assistant identities are ignored, so they cannot increase daily progress.
     */
    @Synchronized
    fun completeAssistant(
        conversationId: String,
        revision: Long,
        userMessageId: String,
        assistantMessageId: String,
    ): GateStatus {
        validateMutationContext(conversationId, revision)
        validateId(userMessageId)
        validateId(assistantMessageId)
        if (state.unlockReason != null) return statusUnlocked()

        val pendingIndex = state.turns.indexOfFirst {
            it.conversationId == conversationId &&
                it.userMessageId == userMessageId &&
                it.state == TurnState.PENDING
        }
        if (pendingIndex < 0) return statusUnlocked()

        val assistantAlreadyCompleted = state.turns.any {
            it.conversationId == conversationId &&
                it.assistantMessageId == assistantMessageId &&
                it.state == TurnState.COMPLETED
        }
        if (assistantAlreadyCompleted) return statusUnlocked()

        val completed = state.turns[pendingIndex].copy(
            assistantMessageId = assistantMessageId,
            state = TurnState.COMPLETED,
        )
        state = state.copy(turns = state.turns.replaceAt(pendingIndex, completed))
        if (completedCount() >= REQUIRED_COMPLETED_PAIRS) {
            state = state.copy(unlockReason = UnlockReason.CONVERSATION)
        }
        return statusUnlocked()
    }

    /** Password verification belongs to the platform layer; this consumes only its boolean result. */
    @Synchronized
    fun emergencyResult(correct: Boolean): GateStatus {
        requireArmedDay()
        if (state.unlockReason != null) {
            emergencyStreak = 0
            return statusUnlocked()
        }
        if (!correct) {
            emergencyStreak = 0
            return statusUnlocked()
        }

        emergencyStreak += 1
        if (emergencyStreak >= REQUIRED_EMERGENCY_SUCCESSES) {
            state = state.copy(unlockReason = UnlockReason.EMERGENCY)
            emergencyStreak = 0
        }
        return statusUnlocked()
    }

    @Synchronized
    fun cancelEmergency(): GateStatus {
        emergencyStreak = 0
        return statusUnlocked()
    }

    /** Called only after the pairing/transport layer has authenticated a peer's completed-day record. */
    @Synchronized
    fun acceptPeerCompletion(dayKey: String): GateStatus {
        require(LocalDate.parse(dayKey).toString() == dayKey) { "Invalid completion day." }
        state = state.copy(peerCompletedDays = state.peerCompletedDays + dayKey)
        if (state.armed && state.activeDayKey == dayKey && state.unlockReason == null) {
            state = state.copy(unlockReason = UnlockReason.SYNC)
            emergencyStreak = 0
        }
        return statusUnlocked()
    }

    private fun statusUnlocked(): GateStatus = GateStatus(
        armed = state.armed,
        targetConversationId = state.targetConversationId,
        targetRevision = state.targetRevision,
        testReady = state.testReady,
        activeDayKey = state.activeDayKey,
        completedCount = if (state.unlockReason == UnlockReason.SYNC) REQUIRED_COMPLETED_PAIRS else completedCount().coerceAtMost(REQUIRED_COMPLETED_PAIRS),
        unlocked = state.unlockReason != null,
        unlockReason = state.unlockReason,
        emergencyStreak = emergencyStreak,
    )

    private fun completedCount(): Int = state.turns.count { it.state == TurnState.COMPLETED }

    private fun validateMutationContext(conversationId: String, revision: Long) {
        requireArmedDay()
        validateTargetRequest(conversationId, revision)
    }

    private fun requireArmedDay() {
        if (!state.armed) reject(GateRejection.NOT_ARMED, "Gate is not armed.")
        if (state.activeDayKey == null) reject(GateRejection.NO_ACTIVE_DAY, "No active day has been established.")
    }

    private fun validateTargetRequest(conversationId: String, revision: Long) {
        validateId(conversationId)
        if (state.targetConversationId != conversationId) {
            reject(GateRejection.TARGET_MISMATCH, "The selected conversation has changed.")
        }
        if (state.targetRevision != revision) {
            reject(GateRejection.STALE_REVISION, "The conversation revision is stale.")
        }
    }

    private fun validateId(id: String) {
        if (id.isEmpty() || id.length > MAX_ID_LENGTH || id.any { it.isISOControl() }) {
            reject(GateRejection.INVALID_ID, "Identity must be a non-empty opaque value up to $MAX_ID_LENGTH characters.")
        }
    }

    private fun reject(reason: GateRejection, message: String): Nothing = throw GateRejectedException(reason, message)

    private fun <T> List<T>.replaceAt(index: Int, value: T): List<T> =
        toMutableList().also { it[index] = value }.toList()

    companion object {
        const val REQUIRED_COMPLETED_PAIRS: Int = 3
        const val REQUIRED_EMERGENCY_SUCCESSES: Int = 10
        private const val MAX_ID_LENGTH: Int = 200
    }
}
