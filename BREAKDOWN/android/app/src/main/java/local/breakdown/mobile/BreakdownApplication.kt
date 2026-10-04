package local.breakdown.mobile

import android.app.Application
import local.breakdown.mobile.lock.GateAccessibilityService
import local.breakdown.mobile.sync.PeerSyncController
import java.time.Instant
import local.breakdown.mobile.core.GateTime

class BreakdownApplication : Application() {
    lateinit var gate: GateRepository
        private set
    lateinit var peerSync: PeerSyncController
        private set
    lateinit var dailySchedule: DailyGateScheduler
        private set
    override fun onCreate() {
        super.onCreate()
        gate = GateRepository(this)
        peerSync = PeerSyncController(this, gate)
        dailySchedule = DailyGateScheduler(this)
        GateAccessibilityService.controller = object : GateAccessibilityService.GateController {
            override fun isLocked() = gate.engine.status().let { it.armed && !it.unlocked }
            override fun activeDay() = gate.engine.status().activeDayKey
            override fun onDeviceUnlocked() { reconcileDay() }
        }
        gate.listen {
            dailySchedule.schedule(gate.engine.status().armed)
            GateAccessibilityService.refreshGate()
        }
        dailySchedule.schedule(gate.engine.status().armed)
        peerSync.start()
    }

    fun reconcileDay() {
        val now = Instant.now()
        val status = gate.engine.status()
        if (status.armed && (status.activeDayKey == null || GateTime.dayKey(now) > status.activeDayKey))
            gate.update { it.onSessionEvent(now) }
        dailySchedule.schedule(gate.engine.status().armed, now)
        GateAccessibilityService.refreshGate()
    }
}
