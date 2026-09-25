package local.breakdown.mobile.web

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.webkit.*
import android.widget.FrameLayout
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/** Uses only this app's persistent WebView profile; account login is a real-device acceptance gate. */
class ChatWebPanel(
    private val activity: Activity,
    private val onSnapshot: (String) -> Unit,
    private val onNavigation: (String) -> Unit,
    private val onProblem: (String) -> Unit
) : FrameLayout(activity) {
    private val handler = Handler(Looper.getMainLooper())
    private val web = WebView(activity)
    private val popups = mutableMapOf<WebView, Dialog>()
    private val script = activity.assets.open("chat-probe.js").bufferedReader().use { it.readText() }
    private var contextJson = JSONObject().put("conversationId", JSONObject.NULL).put("scope", "")
        .put("pendingUserIds", JSONArray()).put("abortedUserIds", JSONArray()).toString()
    private var generation = 0L
    private var resumed = false
    private var disposed = false
    private var loading = false
    private var evaluating = false
    private val poll = object : Runnable {
        override fun run() {
            if (!resumed || disposed) return
            inspectPage()
            handler.postDelayed(this, 1000)
        }
    }

    init {
        CookieManager.getInstance().setAcceptCookie(true)
        configure(web)
        addView(web, LayoutParams(-1, -1))
    }

    fun open(url: String) {
        if (disposed) return
        if (!allowed(url)) { onProblem("HTTPS 주소만 앱 안에서 열 수 있어요."); return }
        generation++
        evaluating = false
        web.loadUrl(url)
    }
    fun currentUrl(): String = web.url ?: ""
    fun setObservationContext(conversationId: String?, scope: String, pendingUserIds: List<String>, abortedUserIds: List<String>) {
        val previous = JSONObject(contextJson)
        val next = JSONObject().put("conversationId", conversationId ?: JSONObject.NULL).put("scope", scope)
            .put("pendingUserIds", JSONArray(pendingUserIds)).put("abortedUserIds", JSONArray(abortedUserIds))
            .put("ackObserver", if (previous.optString("scope") == scope) previous.optString("ackObserver") else "")
            .put("ackSequence", if (previous.optString("scope") == scope) previous.optLong("ackSequence") else 0).toString()
        if (next == contextJson) return
        contextJson = next; generation++; evaluating = false
    }
    fun acknowledgeSnapshot(scope: String, observerId: String, sequence: Long) {
        val current = JSONObject(contextJson)
        if (current.optString("scope") != scope) return
        contextJson = current.put("ackObserver", observerId).put("ackSequence", sequence).toString()
    }
    fun resumeObservation() {
        if (disposed || resumed) return
        resumed = true; web.onResume(); handler.post(poll)
    }
    fun pauseObservation() {
        resumed = false; generation++; evaluating = false
        handler.removeCallbacks(poll); web.onPause(); CookieManager.getInstance().flush()
    }
    fun destroyPanel() {
        if (disposed) return
        pauseObservation(); disposed = true
        popups.values.toList().forEach { it.dismiss() }
        removeView(web); web.stopLoading(); web.destroy()
    }
    private fun allowed(url: String) = runCatching { Uri.parse(url).scheme == "https" }.getOrDefault(false)
    private fun chatOrigin(url: String) = runCatching { Uri.parse(url).let { it.scheme == "https" && it.host == "chatgpt.com" && it.port in listOf(-1,443) } }.getOrDefault(false)

    @SuppressLint("SetJavaScriptEnabled")
    private fun configure(view: WebView) {
        view.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true
            allowFileAccess = false; allowContentAccess = false
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        // Keep the platform WebView user-agent and cookie defaults. No OAuth user-agent workaround.
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (url == "about:blank" && view !== web) return false
                if (allowed(url)) return false
                if (request.isForMainFrame) onProblem("이 로그인 이동은 앱 안에서 지원되지 않아요: ${request.url.scheme ?: "unknown"}")
                return true
            }
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                if (view === web) { generation++; evaluating = false; loading = true }
            }
            override fun onPageFinished(view: WebView, url: String?) {
                CookieManager.getInstance().flush()
                if (view === web) { loading = false; onNavigation(url ?: "") }
            }
            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                if (view === web) { generation++; evaluating = false; onNavigation(url ?: "") }
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) { if (view === web) loading = false; onProblem("페이지 연결 실패: ${error.description}") }
            }
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                if (view === web) { pauseObservation(); onProblem("웹 화면이 종료됐어요. 앱을 다시 열어 주세요.") }
                else popups[view]?.dismiss()
                return true
            }
        }
        view.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
                if (disposed) return false
                val child = WebView(activity); configure(child)
                val dialog = Dialog(activity)
                dialog.setContentView(child); popups[child] = dialog
                dialog.setOnDismissListener {
                    popups.remove(child); child.stopLoading(); child.destroy()
                    CookieManager.getInstance().flush()
                }
                dialog.show(); dialog.window?.setLayout(-1,-1)
                (resultMsg.obj as WebView.WebViewTransport).webView = child
                resultMsg.sendToTarget()
                return true
            }
            override fun onCloseWindow(window: WebView) { popups[window]?.dismiss() }
        }
    }

    private fun inspectPage() {
        if (loading || evaluating || popups.isNotEmpty() || !chatOrigin(currentUrl())) return
        evaluating = true
        val epoch = generation
        val payload = script.replace("/*BREAKDOWN_CONTEXT*/", contextJson)
        web.evaluateJavascript(payload) { encoded ->
            if (epoch != generation || !resumed || disposed) return@evaluateJavascript
            evaluating = false
            try {
                val result = JSONTokener(encoded).nextValue()
                if (result is String) onSnapshot(result)
                else onProblem("대화 감지를 준비하고 있어요. 로그인과 대화 화면을 확인하세요.")
            } catch (_: Exception) { onProblem("대화 상태를 읽지 못했어요. 다시 연결해 주세요.") }
        }
    }
}
