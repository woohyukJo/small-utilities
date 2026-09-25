package local.breakdown.mobile

import android.app.Activity
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.View
import android.view.accessibility.AccessibilityManager
import android.widget.*
import local.breakdown.mobile.core.TurnState
import local.breakdown.mobile.lock.GateAccessibilityService
import local.breakdown.mobile.web.ChatWebPanel
import org.json.JSONObject
import java.time.Instant

class MainActivity : Activity() {
    private val repository get() = (application as BreakdownApplication).gate
    private lateinit var chat: ChatWebPanel
    private lateinit var progress: TextView
    private lateinit var notice: TextView
    private lateinit var address: EditText
    private lateinit var selected: TextView
    private lateinit var settingsContainer: ScrollView
    private lateinit var armButton: Button
    private var renderedTarget: String? = null
    private var scope = ""
    private var testUser: String? = null
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
        row(panel, button("주소 저장") { selectChat(address.text.toString(), true) }, button("현재 대화 선택") { selectChat(chat.currentUrl(), false) })
        row(panel, button("로그인") { chat.open("https://chatgpt.com/auth/login") }, button("선택한 대화 열기") { openSelected() })
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
            repository.update { it.arm(Instant.now()) }
            settingsContainer.visibility = View.GONE
        } }
        panel.addView(armButton)
        panel.addView(button("같은 Wi-Fi PC 연결") { pairingDialog() })
        settingsContainer = ScrollView(this).apply { addView(panel) }
        root.addView(settingsContainer, LinearLayout.LayoutParams(-1, dp(280)))
        chat = ChatWebPanel(this, ::acceptSnapshot, { url ->
            val status = repository.engine.status()
            val id = ChatAddress.conversationId(url)
            if (status.armed && !status.unlocked && status.targetConversationId != null && id != null && id != status.targetConversationId) openSelected()
        }, { problem -> notice.text = problem })
        root.addView(chat, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
        repository.listen(updateListener)
        settingsContainer.visibility = if (repository.engine.status().armed) View.GONE else View.VISIBLE
        render(); openSelected()
        offerPairing(intent)
    }

    private fun render() {
        if (!::chat.isInitialized) return
        val status = repository.engine.status()
        val nextScope = "${status.activeDayKey ?: "setup"}:${status.targetRevision}"
        if (scope != nextScope) { scope = nextScope; testUser = null }
        val target = status.targetConversationId
        if (renderedTarget != target) { renderedTarget = target; address.setText(target?.let(ChatAddress::url) ?: "") }
        selected.text = target?.let { "선택한 대화: ${ChatAddress.url(it)}" } ?: "계속 사용할 대화를 지정하세요."
        progress.text = if (status.armed) "BREAKDOWN  ${status.completedCount} / 3" else "테스트  ${if (status.testReady) 1 else 0} / 1"
        armButton.isEnabled = !status.armed && target != null && status.testReady && repository.hasPassword() && accessibilityEnabled()
        val turns = repository.engine.persistedState().turns.filter { it.conversationId == target }
        chat.setObservationContext(target, scope,
            turns.filter { it.state == TurnState.PENDING }.map { it.userMessageId },
            turns.filter { it.state == TurnState.ABORTED }.map { it.userMessageId })
    }

    private fun selectChat(raw: String, navigate: Boolean) = attempt {
        val id = ChatAddress.conversationId(raw) ?: error("ChatGPT 대화 주소를 입력하거나 대화를 먼저 열어 주세요.")
        val same = repository.engine.status().targetConversationId == id
        if (!same) repository.update { it.selectConversation(id) }
        if (navigate && !same && ChatAddress.conversationId(chat.currentUrl()) != id) chat.open(ChatAddress.url(id))
    }
    private fun openSelected() { chat.open(repository.engine.status().targetConversationId?.let(ChatAddress::url) ?: "https://chatgpt.com/") }

    private fun acceptSnapshot(raw: String) = attempt {
        val result = JSONObject(raw)
        if (result.optString("scope") != scope) return@attempt
        val status = repository.engine.status()
        val target = status.targetConversationId ?: return@attempt
        if (result.getJSONObject("snapshot").optString("conversationId") != target || ChatAddress.conversationId(chat.currentUrl()) != target) return@attempt
        val events = result.getJSONArray("events")
        for (index in 0 until events.length()) {
            val event = events.getJSONObject(index); val user = event.getString("userId")
            if (!status.armed) {
                if (event.getString("type") == "submitted") testUser = user
                if (event.getString("type") == "aborted" && user == testUser) testUser = null
                if (event.getString("type") == "completed" && user == testUser) { repository.update { it.markTestReady(target, status.targetRevision) }; testUser = null }
            } else if (!repository.engine.status().unlocked) {
                repository.update { engine -> when (event.getString("type")) {
                    "submitted" -> engine.submitUser(target, status.targetRevision, user)
                    "aborted" -> engine.abortUser(target, status.targetRevision, user)
                    "completed" -> engine.completeAssistant(target, status.targetRevision, user, event.getString("assistantId"))
                } }
            }
        }
        chat.acknowledgeSnapshot(scope, result.getString("observerId"), result.getLong("sequence"))
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
    override fun onResume() { super.onResume(); GateAccessibilityService.setAppVisible(true); (application as BreakdownApplication).peerSync.requestSoon(); if (::chat.isInitialized) { chat.resumeObservation(); render() } }
    override fun onPause() { if (::chat.isInitialized) chat.pauseObservation(); GateAccessibilityService.setAppVisible(false); super.onPause() }
    override fun onDestroy() { repository.unlisten(updateListener); if (::chat.isInitialized) chat.destroyPanel(); super.onDestroy() }
}
