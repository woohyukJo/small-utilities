package local.breakdown.mobile

import android.app.Application
import local.breakdown.mobile.lock.GateAccessibilityService
import local.breakdown.mobile.sync.PeerSyncController
import java.time.Instant
import local.breakdown.mobile.core.GateTime
import local.breakdown.mobile.browser.BrowserController
import local.breakdown.mobile.browser.BrowserBridgeService

class BreakdownApplication : Application() {
    lateinit var gate: GateRepository
        private set
    lateinit var peerSync: PeerSyncController
        private set
    lateinit var dailySchedule: DailyGateScheduler
        private set
    lateinit var browser: BrowserController
        private set
    override fun onCreate() {
        super.onCreate()
        gate = GateRepository(this)
        peerSync = PeerSyncController(this, gate)
        dailySchedule = DailyGateScheduler(this)
        browser = BrowserController(this, gate)
        GateAccessibilityService.controller = object : GateAccessibilityService.GateController {
            override fun isLocked() = browser.locked()
            override fun allowsFirefox() = browser.browserAllowed()
            override fun openRoutine(): Boolean = runCatching { browser.openConversation(); true }.getOrDefault(false)
            override fun activeDay() = gate.engine.status().activeDayKey
            override fun onDeviceUnlocked() { reconcileDay() }
        }
        gate.listen {
            dailySchedule.schedule(gate.engine.status().armed && gate.routineEnabled())
            GateAccessibilityService.refreshGate()
        }
        dailySchedule.schedule(gate.engine.status().armed && gate.routineEnabled())
        peerSync.start()
    }

    fun reconcileDay() {
        val now = Instant.now()
        val status = gate.engine.status()
        if (status.armed && (status.activeDayKey == null || GateTime.dayKey(now) > status.activeDayKey))
            gate.update { it.onSessionEvent(now) }
        dailySchedule.schedule(gate.engine.status().armed && gate.routineEnabled(), now)
        if (gate.routineEnabled()) runCatching { BrowserBridgeService.ensureRunning(this) }
        GateAccessibilityService.refreshGate()
    }
}
