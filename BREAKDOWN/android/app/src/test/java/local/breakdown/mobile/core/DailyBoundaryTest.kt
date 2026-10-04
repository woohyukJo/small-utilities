package local.breakdown.mobile.core

import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class DailyBoundaryTest {
    private val boundary = Instant.parse("2026-10-04T19:00:00Z")
    @Test fun nextAlarmIsAlwaysTheNextKstFourOClock() {
        assertEquals(boundary, GateTime.nextBoundary(boundary.minusSeconds(1)))
        assertEquals(boundary.plusSeconds(86400), GateTime.nextBoundary(boundary))
        assertEquals(boundary.plusSeconds(86400), GateTime.nextBoundary(boundary.plusSeconds(1)))
    }
    @Test fun alarmCatchesUpMissedDaysAndRepeatedWakeupsKeepProgress() {
        val engine = GateEngine(GatePersistentState(armed = true, targetConversationId = "chat",
            testReady = true, activeDayKey = "2026-09-25", unlockReason = UnlockReason.CONVERSATION))
        engine.onSessionEvent(boundary)
        assertEquals("2026-10-05", engine.status().activeDayKey)
        assertFalse(engine.status().unlocked)
        engine.submitUser("chat", 0, "u")
        engine.completeAssistant("chat", 0, "u", "a")
        engine.onSessionEvent(boundary)
        engine.onSessionEvent(boundary.plusSeconds(3600))
        engine.onSessionEvent(boundary.minusSeconds(86400))
        assertEquals("2026-10-05", engine.status().activeDayKey)
        assertEquals(1, engine.status().completedCount)
        engine.onSessionEvent(boundary.plusSeconds(86400))
        assertEquals(0, engine.status().completedCount)
    }
    @Test fun nextDayPeerCompletionStillAppliesAtTheAlarm() {
        val engine = GateEngine(GatePersistentState(armed = true, targetConversationId = "chat",
            activeDayKey = "2026-10-04", peerCompletedDays = setOf("2026-10-05")))
        engine.onSessionEvent(boundary)
        assertTrue(engine.status().unlocked)
        assertEquals(UnlockReason.SYNC, engine.status().unlockReason)
    }
}
