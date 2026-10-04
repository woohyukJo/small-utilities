package local.breakdown.mobile.browser

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import local.breakdown.mobile.BreakdownApplication
import local.breakdown.mobile.MainActivity
import local.breakdown.mobile.lock.GateAccessibilityService
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

class BrowserBridgeService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private var server: BrowserBridgeServer? = null
    private val check = object : Runnable {
        override fun run() { GateAccessibilityService.refreshGate(); main.postDelayed(this, 2000) }
    }
    override fun onCreate() {
        super.onCreate()
        val app = application as BreakdownApplication
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel("firefox", "Firefox 대화 연결", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        startForeground(18432, Notification.Builder(this, "firefox")
            .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("BREAKDOWN · Firefox 연결")
            .setContentText("대화 횟수를 이 휴대폰에서 확인하고 있어요.").setContentIntent(open).build())
        try {
            server = BrowserBridgeServer(app.gate.browserToken(), { route, payload ->
                val request = FutureTask { app.browser.handle(route, payload) }
                main.post(request)
                request.get(3, TimeUnit.SECONDS)
            })
            app.browser.lastError = null
            app.browser.serviceRunning = true
            main.post(check)
        } catch (_: Exception) {
            app.browser.lastError = "Firefox 연결을 시작하지 못했어요. 시험 앱을 종료하고 다시 열어 주세요."
            stopSelf()
        }
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_STICKY
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onDestroy() { main.removeCallbacks(check); server?.close(); (application as BreakdownApplication).browser.serviceRunning = false; super.onDestroy() }
    companion object {
        fun ensureRunning(context: Context) { context.startForegroundService(Intent(context, BrowserBridgeService::class.java)) }
    }
}
