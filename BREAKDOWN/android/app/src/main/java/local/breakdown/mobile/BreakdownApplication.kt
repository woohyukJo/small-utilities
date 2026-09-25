package local.breakdown.mobile

import android.app.Application
import local.breakdown.mobile.lock.GateAccessibilityService
import local.breakdown.mobile.sync.PeerSyncController
import java.time.Instant

class BreakdownApplication : Application() {
    lateinit var gate: GateRepository
        private set
    lateinit var peerSync: PeerSyncController
        private set
    override fun onCreate() {
        super.onCreate()
        gate = GateRepository(this)
        peerSync = PeerSyncController(this, gate)
        GateAccessibilityService.controller = object : GateAccessibilityService.GateController {
            override fun isLocked() = gate.engine.status().let { it.armed && !it.unlocked }
            override fun onDeviceUnlocked() { gate.update { it.onSessionEvent(Instant.now()) }; peerSync.requestSoon() }
        }
        gate.listen { GateAccessibilityService.refreshGate() }
        peerSync.start()
    }
}
