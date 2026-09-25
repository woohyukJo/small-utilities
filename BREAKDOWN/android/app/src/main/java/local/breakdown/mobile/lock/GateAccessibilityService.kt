package local.breakdown.mobile.lock

import android.accessibilityservice.AccessibilityService
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.Button
import android.widget.FrameLayout
import local.breakdown.mobile.MainActivity

/**
 * User-enabled routine blocker for the personal BREAKDOWN app.
 *
 * This service intentionally does not retrieve accessibility node content and does not attempt
 * Device Owner / kiosk behavior. It blocks ordinary external app windows with an accessibility
 * overlay while the parent-provided controller reports the routine gate as locked.
 */
class GateAccessibilityService : AccessibilityService() {

    interface GateController {
        fun isLocked(): Boolean
        fun onDeviceUnlocked()
    }

    companion object {
        @Volatile
        var controller: GateController? = null

        @Volatile
        private var appVisible: Boolean = false

        @Volatile
        private var liveService: GateAccessibilityService? = null

        private val ALLOWED_ESCAPE_PACKAGES = setOf(
            // System UI contains status/keyguard surfaces.
            "com.android.systemui",

            // Settings / permission surfaces let the user disable accessibility access.
            "com.android.settings",
            "com.android.permissioncontroller",
            "com.google.android.permissioncontroller",
            "com.samsung.android.permissioncontroller",

            // Common AOSP / Samsung / Google emergency and phone UI packages.
            "com.android.phone",
            "com.samsung.android.dialer",
            "com.samsung.android.app.telephonyui",
            "com.samsung.android.incallui",
            "com.google.android.dialer"
        )

        /**
         * Parent MainActivity should call this from onResume/onPause.
         * Keeping this separate from accessibility window events avoids overlay self-event flicker.
         */
        @JvmStatic
        fun setAppVisible(visible: Boolean) {
            appVisible = visible
            liveService?.onAppVisibilityChanged(visible)
        }

        /**
         * Parent state/store code should call this after the lock state changes.
         */
        @JvmStatic
        fun refreshGate() {
            liveService?.refreshGateState()
        }
    }

    private val windowManager by lazy {
        getSystemService(Context.WINDOW_SERVICE) as WindowManager
    }

    private val keyguardManager by lazy {
        getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    }

    private var overlayView: View? = null
    private var lastRealForegroundPackage: String? = null
    private var receiverRegistered = false

    private val userPresentReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != Intent.ACTION_USER_PRESENT) return

            controller?.onDeviceUnlocked()
            refreshGateState()
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        liveService = this
        registerUserPresentReceiver()
        refreshGateState()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val eventPackage = event.packageName?.toString() ?: return

        // TYPE_ACCESSIBILITY_OVERLAY can itself generate window events from our own package.
        // When MainActivity is not visible, treat own-package events as overlay noise rather
        // than as a real foreground transition; otherwise the overlay would hide/re-add itself.
        if (eventPackage == packageName && !appVisible) return

        lastRealForegroundPackage = eventPackage
        refreshGateState()
    }

    override fun onInterrupt() {
        // Losing an accessibility callback must never change gate counters or unlock state.
    }

    override fun onUnbind(intent: Intent?): Boolean {
        teardown()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        teardown()
        super.onDestroy()
    }

    private fun onAppVisibilityChanged(visible: Boolean) {
        if (visible) {
            // Prevent a stale external package from causing an overlay flash during onPause/
            // onResume transitions. A later real external window event will replace this.
            lastRealForegroundPackage = packageName
        }
        refreshGateState()
    }

    private fun refreshGateState() {
        val shouldShow = shouldBlock(lastRealForegroundPackage)
        if (shouldShow) {
            showOverlayIfNeeded()
        } else {
            hideOverlayIfNeeded()
        }
    }

    private fun shouldBlock(foregroundPackage: String?): Boolean {
        if (controller?.isLocked() != true) return false
        if (appVisible) return false

        // Never cover the credential/keyguard surface. ACTION_USER_PRESENT will notify the
        // parent controller after unlock so it can apply its KST04/day semantics.
        if (keyguardManager.isKeyguardLocked || keyguardManager.isDeviceLocked) return false

        val pkg = foregroundPackage ?: return false
        if (pkg == packageName) return false
        if (isAllowedEscapePackage(pkg)) return false

        return true
    }

    private fun isAllowedEscapePackage(pkg: String): Boolean {
        return pkg in ALLOWED_ESCAPE_PACKAGES
    }

    private fun showOverlayIfNeeded() {
        if (overlayView != null) return

        val view = buildOverlayView()
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            0,
            PixelFormat.OPAQUE
        ).apply {
            gravity = Gravity.FILL
        }

        try {
            windowManager.addView(view, params)
            overlayView = view
        } catch (_: WindowManager.BadTokenException) {
            // Fail open; parent UI can surface accessibility/service status separately.
        } catch (_: SecurityException) {
            // Service may have been disabled while the gate was refreshing.
        } catch (_: IllegalStateException) {
            // Window manager/service teardown race: leave overlay detached.
        }
    }

    private fun hideOverlayIfNeeded() {
        val view = overlayView ?: return
        overlayView = null

        try {
            windowManager.removeView(view)
        } catch (_: IllegalArgumentException) {
            // Already detached during service/window teardown.
        }
    }

    private fun buildOverlayView(): View {
        return FrameLayout(this).apply {
            setBackgroundColor(Color.rgb(18, 18, 18))

            addView(
                Button(this@GateAccessibilityService).apply {
                    text = "BREAKDOWN 열기"
                    setOnClickListener { openBreakdownFromUserTap() }
                },
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    Gravity.CENTER
                )
            )
        }
    }

    private fun openBreakdownFromUserTap() {
        // The launch is tied to an explicit user tap on the accessibility overlay. Android's
        // background-activity-start policy still applies; this service does not repeatedly or
        // automatically launch activities from accessibility events.
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }

        try {
            startActivity(intent)
        } catch (_: SecurityException) {
            // Keep the overlay available if the platform rejects the launch.
        }
    }

    private fun registerUserPresentReceiver() {
        if (receiverRegistered) return

        val filter = IntentFilter(Intent.ACTION_USER_PRESENT)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(userPresentReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(userPresentReceiver, filter)
        }
        receiverRegistered = true
    }

    private fun teardown() {
        hideOverlayIfNeeded()

        if (receiverRegistered) {
            receiverRegistered = false
            try {
                unregisterReceiver(userPresentReceiver)
            } catch (_: IllegalArgumentException) {
                // Receiver was already removed as part of process/service teardown.
            }
        }

        if (liveService === this) {
            liveService = null
        }
    }

}
