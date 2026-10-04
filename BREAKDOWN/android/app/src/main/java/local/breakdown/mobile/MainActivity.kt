package local.breakdown.mobile

import android.app.Activity
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.graphics.Color
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.View
import android.view.accessibility.AccessibilityManager
import android.widget.*
import local.breakdown.mobile.lock.GateAccessibilityService
import local.breakdown.mobile.browser.BrowserBridgeService
import android.os.Handler
import android.os.Looper
import java.time.Instant

class MainActivity : Activity() {
    private val repository get() = (application as BreakdownApplication).gate
    private val app get() = application as BreakdownApplication
    private lateinit var browserStatus: TextView
    private val handler = Handler(Looper.getMainLooper())
    private val refreshStatus = object : Runnable {
        override fun run() { render(); handler.postDelayed(this, 2000) }
    }
    private lateinit var progress: TextView
    private lateinit var notice: TextView
    private lateinit var address: EditText
    private lateinit var selected: TextView
    private lateinit var settingsContainer: ScrollView
    private lateinit var armButton: Button
    private lateinit var scheduleStatus: TextView
    private var renderedTarget: String? = null
    private val updateListener: () -> Unit = { render() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(245,244,239)) }
        root.setOnApplyWindowInsetsListener { view, insets ->
            @Suppress("DEPRECATION")
            view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            insets
        }
        val header = LinearLayout(this).apply { setPadding(dp(12),0,dp(12),0) }
        progress = TextView(this).apply { textSize = 20f; setTextColor(Color.rgb(20,44,49)) }
        header.addView(progress, LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(button("설정") { settingsContainer.visibility = if (settingsContainer.visibility == View.VISIBLE) View.GONE else View.VISIBLE })
        root.addView(header)
        notice = TextView(this).apply { textSize = 12f; setPadding(dp(12),0,dp(12),0) }
        root.addView(notice)
        val panel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12),0,dp(12),dp(8)) }
        selected = TextView(this).apply { textSize = 12f }; panel.addView(selected)
        address = EditText(this).apply { hint = "https://chatgpt.com/c/..."; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI; setSingleLine() }
        panel.addView(address)
        panel.addView(button("주소 저장") { selectChat(address.text.toString(), false) })
        row(panel, button("Firefox 연결") { attempt { app.browser.openConversation(pair = true) } },
            button("선택한 대화 열기") { attempt { app.browser.openConversation() } })
        panel.addView(TextView(this).apply { text = "Firefox의 BREAKDOWN 확장 메뉴에서 ‘현재 대화 선택’도 할 수 있어요."; textSize = 12f })
        row(panel, button("비상 비밀번호") { GatePasswordDialog.show(this, repository, false, ::render) },
            button("오늘 비상 해제") { if (repository.engine.status().armed) GatePasswordDialog.show(this, repository, true, ::render) else notice.text = "잠금 시작 후 사용할 수 있어요." })
        panel.addView(button("사용 제한 권한 설정") {
            AlertDialog.Builder(this).setTitle("BREAKDOWN 사용 제한")
                .setMessage("다른 앱이 열리면 제한 화면을 표시합니다. 다른 앱의 화면 내용이나 입력한 글은 읽지 않습니다. 설정에서 언제든 끌 수 있으며 OS 전체 잠금은 아닙니다.")
                .setNegativeButton("취소", null).setPositiveButton("접근성 설정 열기") { _, _ -> startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }.show()
        })
        armButton = button("하루 한 번 시작") { attempt {
            check(repository.hasPassword()) { "비상 비밀번호를 먼저 설정하세요." }
            check(accessibilityEnabled()) { "사용 제한 권한을 먼저 켜세요." }
            check(app.browser.connected()) { "Firefox 연결을 먼저 확인하세요." }
            repository.update { it.arm(Instant.now()) }
            repository.setRoutineEnabled(true)
            settingsContainer.visibility = View.GONE
            app.browser.openConversation()
        } }
        panel.addView(armButton)
        scheduleStatus = TextView(this).apply { textSize = 12f }
        panel.addView(scheduleStatus)
        panel.addView(button("새벽 4시 자동 시작 설정") {
            if (Build.VERSION.SDK_INT >= 31) startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                Uri.parse("package:$packageName")))
        })
        panel.addView(button("같은 Wi-Fi PC 연결") { pairingDialog() })
        panel.addView(button("연결 알림 허용") {
            if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 41)
        })
        panel.addView(button("잠금 끄고 종료") { attempt {
            check(!app.browser.locked()) { "대화를 완료하거나 비상 해제 후 종료하세요." }
            repository.setRoutineEnabled(false)
            stopService(Intent(this, BrowserBridgeService::class.java))
            finishAndRemoveTask()
        } })
        settingsContainer = ScrollView(this).apply { addView(panel) }
        root.addView(settingsContainer, LinearLayout.LayoutParams(-1, 0, 1f))
        browserStatus = TextView(this).apply { textSize = 16f; setPadding(dp(12), dp(16), dp(12), dp(16)) }
        root.addView(browserStatus)
        root.addView(button("Firefox에서 대화하기") { attempt { app.browser.openConversation() } })
        setContentView(root)
        repository.listen(updateListener)
        settingsContainer.visibility = if (repository.routineEnabled()) View.GONE else View.VISIBLE
        render()
        offerPairing(intent)
    }

    private fun render() {
        if (!::browserStatus.isInitialized) return
        val status = repository.engine.status()
        val target = status.targetConversationId
        if (renderedTarget != target) { renderedTarget = target; address.setText(target?.let(ChatAddress::url) ?: "") }
        selected.text = target?.let { "선택한 대화: ${ChatAddress.url(it)}" } ?: "계속 사용할 대화를 지정하세요."
        progress.text = if (status.armed) "${if (repository.routineEnabled()) "BREAKDOWN" else "잠금 꺼짐"}  ${status.completedCount} / 3" else "테스트  ${if (status.testReady) 1 else 0} / 1"
        armButton.isEnabled = !repository.routineEnabled() && target != null && status.testReady && repository.hasPassword() && accessibilityEnabled() && app.browser.connected()
        browserStatus.text = app.browser.lastError ?: if (app.browser.connected()) "Firefox 연결됨 · 패스키 로그인은 Firefox에서 진행해요." else "Firefox 연결 대기 중 · ‘Firefox 연결’을 눌러 주세요."
        scheduleStatus.text = if ((application as BreakdownApplication).dailySchedule.exactAllowed())
            "매일 오전 4시(KST)에 시작 · 화면이 꺼져 있으면 잠금 해제 후 표시" else
            "정확한 4시 시작을 위해 ‘알람 및 리마인더’를 허용하세요. 미허용 시 시작이 늦어질 수 있어요."
    }

    private fun selectChat(raw: String, navigate: Boolean) = attempt {
        val id = ChatAddress.conversationId(raw) ?: error("ChatGPT 대화 주소를 입력하거나 대화를 먼저 열어 주세요.")
        val same = repository.engine.status().targetConversationId == id
        if (!same) repository.update { it.selectConversation(id) }
        if (navigate) app.browser.openConversation()
    }

    private fun pairingDialog(prefill: String? = null) {
        val input = EditText(this).apply { hint = "PC에서 복사한 연결 정보"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE }
        if (prefill != null) input.setText(prefill)
        val sync = (application as BreakdownApplication).peerSync
        val dialog = AlertDialog.Builder(this).setTitle("같은 Wi-Fi PC 연결")
            .setMessage(sync.statusText + "\nPC의 BREAKDOWN에서 휴대폰 연결을 켠 뒤 연결 정보를 붙여넣으세요.")
            .setView(input).setNegativeButton("취소", null)
            .setNeutralButton("연결 해제") { _, _ -> sync.disconnect() }
            .setPositiveButton("연결", null).create()
        dialog.setOnDismissListener { sync.cancelPairing(); input.text.clear() }
        dialog.setOnShowListener { dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
            sync.pair(input.text.toString()) { error ->
                if (isDestroyed || !dialog.isShowing) return@pair
                if (error == null) { input.text.clear(); dialog.dismiss(); notice.text = sync.statusText }
                else { dialog.setMessage(error); dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true }
            }
        } }
        dialog.show()
    }
    private fun offerPairing(incoming: Intent?) {
        val uri = incoming?.data ?: return
        if (uri.scheme != "breakdown" || uri.host != "pair") return
        val raw = uri.getQueryParameter("data") ?: return
        if (raw.length <= 8192) pairingDialog(raw)
        incoming.data = null
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); offerPairing(intent) }
    private fun accessibilityEnabled(): Boolean = (getSystemService(ACCESSIBILITY_SERVICE) as AccessibilityManager)
        .getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK).any { it.resolveInfo.serviceInfo.let { info -> info.packageName == packageName && info.name == GateAccessibilityService::class.java.name } }
    private fun attempt(action: () -> Unit) { try { action(); notice.text = "" } catch (error: Exception) { notice.text = error.message ?: "연결 상태를 확인하세요." } }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun button(label: String, action: () -> Unit) = Button(this).apply { text = label; textSize = 12f; setOnClickListener { action() } }
    private fun row(parent: LinearLayout, vararg buttons: Button) { parent.addView(LinearLayout(this).apply { buttons.forEach { addView(it, LinearLayout.LayoutParams(0,-2,1f)) } }) }
    override fun onResume() {
        super.onResume(); GateAccessibilityService.setAppVisible(true)
        app.reconcileDay(); app.peerSync.requestSoon()
        attempt { BrowserBridgeService.ensureRunning(this) }
        handler.post(refreshStatus)
    }
    override fun onPause() { handler.removeCallbacks(refreshStatus); GateAccessibilityService.setAppVisible(false); super.onPause() }
    override fun onDestroy() { repository.unlisten(updateListener); super.onDestroy() }
}
