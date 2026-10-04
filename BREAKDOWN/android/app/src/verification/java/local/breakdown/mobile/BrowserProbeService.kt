package local.breakdown.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder

class BrowserProbeService : Service() {
    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel("browser-test", "Firefox 연결 시험", NotificationManager.IMPORTANCE_LOW))
        startForeground(18432, Notification.Builder(this, "browser-test")
            .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("BREAKDOWN Firefox 연결 시험")
            .setContentText("이 휴대폰 안에서 대화 횟수를 확인하고 있어요.").build())
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_NOT_STICKY
    override fun onBind(intent: Intent?): IBinder? = null
}
