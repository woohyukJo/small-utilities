package local.breakdown.mobile.core

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class GateEngineTest {
    private val conversationA = "conversation-a"
    private val conversationB = "conversation-b"
    private val beforeBoundary = Instant.parse("2026-09-23T18:59:59Z") // KST 03:59:59
    private val afterBoundary = Instant.parse("2026-09-23T19:00:00Z") // KST 04:00:00

    @Test
    fun armingRequiresSelectedConversationAndReadyRevision() {
        val engine = GateEngine()
        val noTarget = assertThrows(GateRejectedException::class.java) { engine.arm(beforeBoundary) }
        assertEquals(GateRejection.TARGET_REQUIRED, noTarget.rejection)

        engine.selectConversation(conversationA)
        val revision = engine.status().targetRevision
        val notReady = assertThrows(GateRejectedException::class.java) { engine.arm(beforeBoundary) }
        assertEquals(GateRejection.TEST_NOT_READY, notReady.rejection)

        engine.markTestReady(conversationA, revision)
        engine.arm(beforeBoundary)
        assertTrue(engine.status().armed)
        assertEquals("2026-09-23", engine.status().activeDayKey)
    }

    @Test
    fun dayBoundaryMovesOnlyOnExplicitSessionAndRestartPreservesProgress() {
        assertEquals("2026-09-23", GateTime.dayKey(beforeBoundary))
        assertEquals("2026-09-24", GateTime.dayKey(afterBoundary))
        assertEquals(afterBoundary, GateTime.dayStart("2026-09-24"))

        val engine = armedEngine(beforeBoundary)
        val revision = engine.status().targetRevision
        engine.submitUser(conversationA, revision, "u1")
        engine.completeAssistant(conversationA, revision, "u1", "a1")

        val restartedAfterBoundary = GateEngine(engine.persistedState())
        assertEquals("2026-09-23", restartedAfterBoundary.status().activeDayKey)
        assertEquals(1, restartedAfterBoundary.status().completedCount)

        restartedAfterBoundary.onSessionEvent(afterBoundary)
        assertEquals("2026-09-24", restartedAfterBoundary.status().activeDayKey)
        assertEquals(0, restartedAfterBoundary.status().completedCount)
        assertEquals(conversationA, restartedAfterBoundary.status().targetConversationId)

        val newRevision = restartedAfterBoundary.status().targetRevision
        restartedAfterBoundary.submitUser(conversationA, newRevision, "u2")
        restartedAfterBoundary.completeAssistant(conversationA, newRevision, "u2", "a2")
        restartedAfterBoundary.onSessionEvent(afterBoundary.plusSeconds(60))
        assertEquals(1, restartedAfterBoundary.status().completedCount)
    }

    @Test
    fun threeIdentityPairsUnlockWithoutAnyContentInput() {
        val engine = armedEngine(beforeBoundary)
        val revision = engine.status().targetRevision

        repeat(3) { index ->
            // The domain API receives identities only; "." or any other user/assistant text never enters it.
            engine.submitUser(conversationA, revision, "user-$index")
            engine.completeAssistant(conversationA, revision, "user-$index", "assistant-$index")
        }

        assertTrue(engine.status().unlocked)
        assertEquals(3, engine.status().completedCount)
        assertEquals(UnlockReason.CONVERSATION, engine.status().unlockReason)
    }

    @Test
    fun targetSwitchRetiresPendingRejectsStaleRevisionAndDeduplicatesPairs() {
        val engine = armedEngine(beforeBoundary)
        val revisionA1 = engine.status().targetRevision

        engine.submitUser(conversationA, revisionA1, "done-user")
        engine.completeAssistant(conversationA, revisionA1, "done-user", "done-assistant")
        engine.submitUser(conversationA, revisionA1, "pending-user")

        engine.selectConversation(conversationA)
        assertEquals(revisionA1, engine.status().targetRevision)
        assertTrue(engine.persistedState().turns.any { it.userMessageId == "pending-user" && it.state == TurnState.PENDING })

        engine.selectConversation(conversationB)
        val revisionB = engine.status().targetRevision
        assertNotEquals(revisionA1, revisionB)
        assertEquals(1, engine.status().completedCount)
        assertTrue(engine.persistedState().turns.any { it.userMessageId == "pending-user" && it.state == TurnState.ABORTED })

        engine.completeAssistant(conversationB, revisionB, "historical-user", "historical-assistant")
        assertEquals(1, engine.status().completedCount)

        engine.selectConversation(conversationA)
        val revisionA2 = engine.status().targetRevision
        assertNotEquals(revisionA1, revisionA2)

        val staleSubmit = assertThrows(GateRejectedException::class.java) {
            engine.submitUser(conversationA, revisionA1, "stale-user")
        }
        assertEquals(GateRejection.STALE_REVISION, staleSubmit.rejection)
        val staleReady = assertThrows(GateRejectedException::class.java) {
            engine.markTestReady(conversationA, revisionA1)
        }
        assertEquals(GateRejection.STALE_REVISION, staleReady.rejection)
        val staleAbort = assertThrows(GateRejectedException::class.java) {
            engine.abortUser(conversationA, revisionA1, "pending-user")
        }
        assertEquals(GateRejection.STALE_REVISION, staleAbort.rejection)
        val staleComplete = assertThrows(GateRejectedException::class.java) {
            engine.completeAssistant(conversationA, revisionA1, "pending-user", "stale-assistant")
        }
        assertEquals(GateRejection.STALE_REVISION, staleComplete.rejection)

        engine.submitUser(conversationA, revisionA2, "done-user")
        engine.completeAssistant(conversationA, revisionA2, "done-user", "replacement-assistant")
        assertEquals(1, engine.status().completedCount)

        engine.completeAssistant(conversationA, revisionA2, "pending-user", "late-assistant")
        assertEquals(1, engine.status().completedCount)
        engine.submitUser(conversationA, revisionA2, "pending-user")
        engine.completeAssistant(conversationA, revisionA2, "pending-user", "fresh-assistant")
        assertEquals(2, engine.status().completedCount)

        engine.submitUser(conversationA, revisionA2, "dedup-user")
        engine.completeAssistant(conversationA, revisionA2, "dedup-user", "fresh-assistant")
        assertEquals(2, engine.status().completedCount)
        engine.completeAssistant(conversationA, revisionA2, "dedup-user", "dedup-assistant")
        assertEquals(3, engine.status().completedCount)
        assertEquals(UnlockReason.CONVERSATION, engine.status().unlockReason)

        engine.selectConversation(conversationB)
        assertEquals(3, engine.status().completedCount)
        assertEquals(UnlockReason.CONVERSATION, engine.status().unlockReason)
    }

    @Test
    fun abortedTurnRequiresExplicitResubmit() {
        val engine = armedEngine(beforeBoundary)
        val revision = engine.status().targetRevision
        engine.submitUser(conversationA, revision, "retry-user")
        engine.abortUser(conversationA, revision, "retry-user")

        engine.completeAssistant(conversationA, revision, "retry-user", "ignored-assistant")
        assertEquals(0, engine.status().completedCount)

        engine.submitUser(conversationA, revision, "retry-user")
        engine.completeAssistant(conversationA, revision, "retry-user", "accepted-assistant")
        assertEquals(1, engine.status().completedCount)
    }

    @Test
    fun emergencyNeedsTenConsecutiveResultsAndRestartResetsOnlyStreak() {
        val engine = armedEngine(beforeBoundary)
        repeat(4) { engine.emergencyResult(true) }
        assertEquals(4, engine.status().emergencyStreak)

        val beforeRestart = engine.persistedState()
        val restarted = GateEngine(beforeRestart)
        assertEquals(0, restarted.status().emergencyStreak)
        assertEquals(beforeRestart, restarted.persistedState())

        repeat(9) { restarted.emergencyResult(true) }
        assertFalse(restarted.status().unlocked)
        assertEquals(9, restarted.status().emergencyStreak)
        restarted.emergencyResult(false)
        assertEquals(0, restarted.status().emergencyStreak)

        restarted.emergencyResult(true)
        restarted.cancelEmergency()
        assertEquals(0, restarted.status().emergencyStreak)

        repeat(10) { restarted.emergencyResult(true) }
        assertTrue(restarted.status().unlocked)
        assertEquals(UnlockReason.EMERGENCY, restarted.status().unlockReason)
        assertEquals(0, restarted.status().emergencyStreak)

        restarted.onSessionEvent(beforeBoundary)
        assertTrue(restarted.status().unlocked)
        restarted.onSessionEvent(afterBoundary)
        assertFalse(restarted.status().unlocked)
        assertEquals(conversationA, restarted.status().targetConversationId)
    }

    private fun armedEngine(now: Instant): GateEngine {
        val engine = GateEngine()
        engine.selectConversation(conversationA)
        val revision = engine.status().targetRevision
        engine.markTestReady(conversationA, revision)
        engine.arm(now)
        return engine
    }
}
