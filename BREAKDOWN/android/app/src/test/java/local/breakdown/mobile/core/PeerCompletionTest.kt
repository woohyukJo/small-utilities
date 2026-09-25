package local.breakdown.mobile.core

import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class PeerCompletionTest {
    private val today = Instant.parse("2026-09-25T00:00:00Z")
    private fun armed(): GateEngine = GateEngine().apply {
        selectConversation("test-chat"); markTestReady("test-chat", status().targetRevision); arm(today)
    }

    @Test fun sameDayCompletionIsIdempotentAndKeepsLocalProgress() {
        val gate = armed(); val revision = gate.status().targetRevision
        gate.submitUser("test-chat", revision, "local-user"); gate.completeAssistant("test-chat", revision, "local-user", "local-answer")
        val localTurns = gate.persistedState().turns
        gate.acceptPeerCompletion("2026-09-25")
        val once = gate.persistedState()
        gate.acceptPeerCompletion("2026-09-25")
        assertEquals(once, gate.persistedState())
        assertEquals(localTurns, gate.persistedState().turns)
        assertEquals(3, gate.status().completedCount)
        assertEquals(UnlockReason.SYNC, gate.status().unlockReason)
        assertTrue(GateEngine(gate.persistedState()).status().unlocked)
    }

    @Test fun receivingDifferentDayNeverChangesActiveDay() {
        val gate = armed()
        gate.acceptPeerCompletion("2026-09-26")
        assertEquals("2026-09-25", gate.status().activeDayKey)
        assertFalse(gate.status().unlocked)
        gate.onSessionEvent(today.plusSeconds(86400))
        assertTrue(gate.status().unlocked)
        assertEquals("2026-09-26", gate.status().activeDayKey)
        gate.onSessionEvent(today.plusSeconds(172800))
        assertFalse(gate.status().unlocked)
    }

    @Test fun onboardingAndExistingUnlockArePreserved() {
        val fresh = GateEngine(); fresh.acceptPeerCompletion("2026-09-25")
        assertFalse(fresh.status().armed); assertFalse(fresh.status().unlocked)
        val gate = armed(); repeat(10) { gate.emergencyResult(true) }
        gate.acceptPeerCompletion("2026-09-25")
        assertEquals(UnlockReason.EMERGENCY, gate.status().unlockReason)
    }
}
