package local.breakdown.mobile

import android.app.Activity
import android.app.AlarmManager
import android.app.Instrumentation
import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import local.breakdown.mobile.core.GateTime
import java.time.Instant

/** Separate .verification app/profile: never manipulates the installed user's gate or cookies. */
class DailyScheduleProbe : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
    override fun onStart() {
        try {
            waitForIdleSync()
            check(targetContext.packageName.endsWith(".verification"))
            val app = targetContext.applicationContext as BreakdownApplication
            val now = Instant.now()
            val yesterday = now.minusSeconds(86400)
            runOnMainSync {
                app.gate.setRoutineEnabled(true)
                app.gate.update {
                    it.selectConversation("schedule-fixture")
                    val revision = it.status().targetRevision
                    it.markTestReady("schedule-fixture", revision)
                    it.arm(yesterday)
                    repeat(3) { n ->
                        it.submitUser("schedule-fixture", revision, "old-u$n")
                        it.completeAssistant("schedule-fixture", revision, "old-u$n", "old-a$n")
                    }
                }
            }
            check(app.gate.engine.status().unlocked)
            val alarm = targetContext.getSystemService(AlarmManager::class.java)
            check(app.dailySchedule.exactAllowed()) { "Grant exact alarms to the isolated verification package." }
            val delivery = Intent(targetContext, DailyGateReceiver::class.java).setAction(DailyGateScheduler.ACTION_BOUNDARY)
            val operation = PendingIntent.getBroadcast(targetContext, 99, delivery,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 2000, operation)
            val deadline = System.nanoTime() + 20_000_000_000L
            while (app.gate.engine.status().activeDayKey != GateTime.dayKey(now) && System.nanoTime() < deadline) Thread.sleep(100)
            check(app.gate.engine.status().activeDayKey == GateTime.dayKey(now)) { "System alarm did not advance the day." }
            check(!app.gate.engine.status().unlocked)
            check(app.gate.engine.status().completedCount == 0)
            runOnMainSync {
                app.gate.update {
                    val revision = it.status().targetRevision
                    it.submitUser("schedule-fixture", revision, "today-u")
                    it.completeAssistant("schedule-fixture", revision, "today-u", "today-a")
                }
                // Duplicate delivery and reconnect checks must retain today's progress.
                DailyGateReceiver().onReceive(targetContext, delivery)
                app.reconcileDay()
            }
            check(app.gate.engine.status().completedCount == 1)
            check(GateRepository(targetContext).engine.status().completedCount == 1)
            val scheduled = PendingIntent.getBroadcast(targetContext, 4, delivery,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
            check(scheduled != null) { "Next daily alarm was not registered." }
            finish(Activity.RESULT_OK, Bundle().apply { putString("result", "PASS actual AlarmManager delivery, catch-up, duplicate preservation, persistence and rearm") })
        } catch (error: Throwable) {
            finish(Activity.RESULT_CANCELED, Bundle().apply { putString("error", error.toString()) })
        }
    }
}
