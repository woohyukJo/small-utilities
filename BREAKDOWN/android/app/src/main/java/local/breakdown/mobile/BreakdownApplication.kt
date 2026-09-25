package local.breakdown.mobile

import android.app.Application
import local.breakdown.mobile.lock.GateAccessibilityService
import java.time.Instant

class BreakdownApplication : Application() {
    lateinit var gate: GateRepository
        private set
    override fun onCreate() {
        super.onCreate()
        gate = GateRepository(this)
        GateAccessibilityService.controller = object : GateAccessibilityService.GateController {
            override fun isLocked() = gate.engine.status().let { it.armed && !it.unlocked }
            override fun onDeviceUnlocked() { gate.update { it.onSessionEvent(Instant.now()) } }
        }
        gate.listen { GateAccessibilityService.refreshGate() }
    }
}
