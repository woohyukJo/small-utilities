package local.breakdown.mobile

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import local.breakdown.mobile.core.GateTime
import java.time.Instant

/** A single persistent alarm; rearmed after delivery, reboot, clock changes and app updates. */
class DailyGateScheduler(private val context: Context) {
    private val alarms = context.getSystemService(AlarmManager::class.java)
    private var scheduledAt: Long? = null
    private var scheduledExact: Boolean? = null

    fun exactAllowed(): Boolean = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()

    fun schedule(armed: Boolean, now: Instant = Instant.now()) {
        val operation = PendingIntent.getBroadcast(context, 4,
            Intent(context, DailyGateReceiver::class.java).setAction(ACTION_BOUNDARY),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        if (!armed) {
            alarms.cancel(operation)
            scheduledAt = null
            return
        }
        val next = GateTime.nextBoundary(now).toEpochMilli()
        val exact = exactAllowed()
        if (scheduledAt == next && scheduledExact == exact) return
        try {
            if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, operation)
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, operation)
            scheduledExact = exact
        } catch (_: SecurityException) {
            // Permission can be revoked between the check and scheduling.
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, operation)
            scheduledExact = false
        }
        scheduledAt = next
    }

    companion object { const val ACTION_BOUNDARY = "local.breakdown.mobile.DAILY_BOUNDARY" }
}

class DailyGateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        (context.applicationContext as BreakdownApplication).reconcileDay()
    }
}
