# BREAKDOWN Android lock model

Status: researched against current official Android/Samsung documentation on 2026-09-25. This is a feasibility/implementation note only; no real Samsung phone was tested.

## Decision

**Best implementable default on an already-used personal Samsung phone:** a user-enabled `AccessibilityService` that watches foreground/window changes and, while the daily gate is active, allows only BREAKDOWN + the selected ChatGPT app and places a full-screen **`TYPE_ACCESSIBILITY_OVERLAY`** over other app windows. Keep all gate state locally. Do **not** depend on a permanently running foreground service, repeated background `startActivity()` calls, `SYSTEM_ALERT_WINDOW`, screen pinning, ADB, or Device Owner for the default.

This gives strong routine friction but is **not an OS-level device lock**. A normal app cannot honestly guarantee that the user cannot revoke its accessibility access, force-stop/uninstall it, use system-level recovery paths, or defeat it after some reboot/vendor lifecycle scenarios. Android's true kiosk-style Lock Task mode is a different privilege tier controlled by a Device Policy Controller (DPC)/Device Owner.

**Optional stronger mode:** real Lock Task mode under Device Owner / fully-managed-device provisioning. Treat this as a separate, explicit opt-in because Android's supported dedicated-device provisioning flow normally starts from a factory reset, while the development ADB path requires a suitable unprovisioned/no-account state. Without the DPC allowlist, `startLockTask()` is only **screen pinning**, which the user can exit.

Official basis: [AccessibilityService](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService), [TYPE_ACCESSIBILITY_OVERLAY](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#TYPE_ACCESSIBILITY_OVERLAY), [Lock task mode](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode), [Dedicated devices](https://developer.android.com/work/dpc/dedicated-devices).

## Why this default

### 1. Foreground-app interception: feasible with AccessibilityService

An enabled accessibility service receives UI/window accessibility events and can inspect the active window when configured with `canRetrieveWindowContent=true`. Track `event.packageName` plus `TYPE_WINDOW_STATE_CHANGED`, `TYPE_WINDOWS_CHANGED`, and selected `TYPE_WINDOW_CONTENT_CHANGED` events. Use these to maintain an allowlist state machine rather than continuously polling usage stats.

Android explicitly says accessibility-service lifecycle is system managed: the service starts only after the user turns it on in Settings, and the system binds it. Do not try to keep it alive by calling `startService()` on the accessibility service itself. [AccessibilityService lifecycle/configuration](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService) and [create an accessibility service](https://developer.android.com/guide/topics/ui/accessibility/service).

The platform documentation describes AccessibilityService as an assistive API. For this personal sideload prototype that is a design/distribution caveat, not an extra device-admin capability: enabling it still requires an explicit user action and it still does not become Device Owner.

### 2. Use an accessibility overlay before an application overlay

`TYPE_ACCESSIBILITY_OVERLAY` exists specifically for windows drawn by a connected `AccessibilityService`; Android documents it as able to intercept user interaction while still allowing the service to introspect the windows underneath. That makes it a better lock-screen surface for this architecture than repeatedly launching BREAKDOWN's Activity from the background. [TYPE_ACCESSIBILITY_OVERLAY](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#TYPE_ACCESSIBILITY_OVERLAY).

On API 34+, `AccessibilityService.attachAccessibilityOverlayToDisplay()` / `attachAccessibilityOverlayToWindow()` are also available; a normal `WindowManager` accessibility-overlay window remains the simplest portable approach for API 26+ phones. [AccessibilityService overlay APIs](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService#attachAccessibilityOverlayToDisplay(int,%20android.view.SurfaceControl)).

`TYPE_APPLICATION_OVERLAY` is a supported fallback, but it requires user-granted `SYSTEM_ALERT_WINDOW`. Android says these windows sit above ordinary Activity windows but below critical system windows such as the status bar/IME, and the system may change their size, position, or visibility. It therefore cannot be sold as a complete device lock. [TYPE_APPLICATION_OVERLAY](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#TYPE_APPLICATION_OVERLAY), [Settings.canDrawOverlays / ACTION_MANAGE_OVERLAY_PERMISSION](https://developer.android.com/reference/android/provider/Settings#canDrawOverlays(android.content.Context)).

Avoid making `SYSTEM_ALERT_WINDOW` + a foreground service the core design. Android 12+ restricts background foreground-service starts; for apps targeting Android 15/API 35+, the `SYSTEM_ALERT_WINDOW` exemption requires an already-visible overlay. [FGS background-start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start), [Android 15 behavior changes](https://developer.android.com/about/versions/15/behavior-changes-15).

### 3. Do not rely on background Activity launches as the lock primitive

Android has restricted background Activity launches since Android 10. Current official guidance lists user-granted `SYSTEM_ALERT_WINDOW` as one exception, but accessibility-service callbacks themselves are not a blanket promise that arbitrary background `startActivity()` will always win a foreground race. A touchable accessibility overlay avoids that race and avoids visible Activity churn. [Activity security / background launches](https://developer.android.com/guide/components/activities/secure-bal).

## Daily gate semantics

Implement the user's rule as a local state machine. No exact alarm and no model API are required.

Use `ZoneId.of("Asia/Seoul")`. Define a routine-day key as `nowKst.minusHours(4).toLocalDate()`. This makes 04:00 KST the day boundary. Store at least:

```text
lastSatisfiedRoutineDay
gateActive
pairCount              // 0..3
awaitingAssistant      // user turn observed, waiting for completed assistant turn
emergencyConsecutive   // 0..10
```

The gate is **not** activated merely because the wall clock crosses 04:00 while the phone remains in use. It activates on the next unlock/presence transition after the routine-day key advances. While the service is connected, register a receiver for `ACTION_USER_PRESENT` (Android defines it as sent when the user is present after wake/keyguard is gone) and keep a `KeyguardManager`/first-post-unlock event fallback. [ACTION_USER_PRESENT](https://developer.android.com/reference/android/content/Intent#ACTION_USER_PRESENT).

On that unlock:

1. If `routineDay > lastSatisfiedRoutineDay`, set `gateActive=true`, reset `pairCount=0`, `awaitingAssistant=false`, and show/enforce the gate.
2. Allow BREAKDOWN and the configured ChatGPT package to remain interactive. Overlay other ordinary app windows.
3. When `pairCount == 3`, set `lastSatisfiedRoutineDay=routineDay`, clear the overlay, and set `gateActive=false`.
4. Emergency password: each submitted correct password increments `emergencyConsecutive`; any wrong submission resets it to 0. On the 10th consecutive correct submission, clear the gate and mark the current routine day satisfied so the app does not immediately re-lock on the same unlock/day.

No text-quality judgment is needed. `.` is a valid user turn exactly like any other content.

## Counting 3 new user + completed GPT response pairs without a model API

This is feasible only as **UI-state recognition**, so it is the most brittle part and must be isolated behind one detector interface.

At gate activation, snapshot/baseline the current ChatGPT conversation state. Count only turns that appear after that baseline. A pair is:

1. a **new user turn** observed after the gate starts; then
2. a **new assistant turn that reaches the app's completed/idle UI state** after that user turn.

Do not score or parse semantic content. Prefer stable accessibility roles, view IDs, content descriptions, and generation-state controls. Avoid matching the actual message text beyond deduplication. Because ChatGPT's native UI/accessibility tree can change, the exact selectors must be validated on the target installed app version; this research did not test the phone or ChatGPT UI.

Failure policy: if the detector cannot confidently distinguish a new completed pair, do not fabricate progress. Keep the emergency-password route available and surface a local diagnostic such as “ChatGPT turn detector needs update.”

## Setup on the Samsung phone

1. Sideload/install BREAKDOWN and open it once.
2. On Android 13+, a sideloaded app may have sensitive settings blocked until the user explicitly chooses **Settings > Apps > BREAKDOWN > More > Allow restricted settings**. Google's current Android Help documents this flow and specifically mentions accessibility access. [Restricted settings](https://support.google.com/android/answer/12623953).
3. Open **Settings > Accessibility** and enable the BREAKDOWN accessibility service. The app can deep-link the user to `Settings.ACTION_ACCESSIBILITY_SETTINGS`, but cannot silently enable itself. [Settings.ACTION_ACCESSIBILITY_SETTINGS](https://developer.android.com/reference/android/provider/Settings#ACTION_ACCESSIBILITY_SETTINGS).
4. On Samsung, add BREAKDOWN to **Never sleeping apps** / remove it from Sleeping or Deep sleeping apps. Samsung documents that deep-sleeping apps do not run in the background and that Never sleeping apps are kept from automatically sleeping. [Samsung sleeping apps](https://www.samsung.com/us/support/answer/ANS10003442/).
5. Only if the implementation chooses the `TYPE_APPLICATION_OVERLAY` fallback, request **Display over other apps** separately and verify `Settings.canDrawOverlays()`.

## Boot, unlock, force-stop, and lifecycle limits

- **Normal reboot:** an enabled AccessibilityService is system-managed, but do not claim instantaneous enforcement before first credential unlock. This product's rule is “apply at next unlock,” so credential-protected storage is sufficient for the core state.
- **Direct Boot is optional:** if later code must run before first unlock, mark only the required components `directBootAware=true`, use device-protected storage, and listen for `ACTION_LOCKED_BOOT_COMPLETED`. [Direct Boot](https://developer.android.com/privacy-and-security/direct-boot).
- **BOOT_COMPLETED is not a magic keepalive:** it is useful for ordinary initialization, but an app placed in the stopped state by Force Stop will not normally run until direct/indirect user action removes that state. Android 15 also cancels pending intents while the package is stopped. [ApplicationInfo.FLAG_STOPPED](https://developer.android.com/reference/android/content/pm/ApplicationInfo#FLAG_STOPPED), [Android 15 stopped-state changes](https://developer.android.com/about/versions/15/behavior-changes-all).
- **Vendor battery policy matters:** Samsung can place apps in sleep/deep sleep and restrict background behavior. The setup must include the Never sleeping-app step above. This improves reliability; it does not convert the app into a protected system component.
- **Permission revocation:** if the user disables the accessibility service, the interception layer is gone. A normal sideload app cannot prevent that at the OS policy level.
- **Force Stop / uninstall:** both defeat the default mode. This is an expected boundary of a normal app, not an implementation bug.
- **Reboot / Safe Mode:** Safe Mode disables downloaded third-party apps, so it is a deliberate recovery path and therefore also a bypass path for the default mode. Samsung documents how to enter Safe Mode and that third-party apps do not run there. [Samsung Safe Mode](https://www.samsung.com/us/support/answer/ANS10003495/).

## What the default cannot honestly block

Do not state that the default can completely lock the phone. In particular, it cannot guarantee blocking or surviving:

- accessibility-permission revocation;
- Force Stop or uninstall;
- Safe Mode;
- all system UI, hardware-key, power/reboot, emergency, or OEM recovery surfaces;
- vendor process/battery management in every One UI build;
- an accessibility tree/UI change in the ChatGPT app that breaks pair detection;
- all reboot-time gaps before the system rebinds the service and the user unlocks.

An application overlay is explicitly below critical system windows; an accessibility overlay is stronger for this use but still does not grant Device Owner policy control.

## Safe emergency recovery

Keep at least two independent recovery paths:

1. **In-app emergency route:** emergency password entry is always reachable from the gate overlay. Require 10 consecutive correct submissions; a wrong submission resets the counter. On success, release the current routine day and persist that state before removing the overlay.
2. **OS recovery route:** Samsung Safe Mode disables downloaded apps. From there the user can uninstall BREAKDOWN or boot normally and change its settings. This must remain possible in the default personal-sideload mode.

Also make overlay rendering fail-safe: catch `BadTokenException`/window errors, never spin a crash/relaunch loop, and persist state before UI transitions. If the service loses its connection, show status the next time the main app opens rather than trying to simulate Device Owner behavior.

## Real Lock Task vs screen pinning vs Device Owner

`Activity.startLockTask()` has two materially different outcomes:

- If the package is allowlisted by `DevicePolicyManager.setLockTaskPackages()`, Android enters real **Lock Task mode**. Users typically cannot reach notifications, non-allowlisted apps, Home, or Overview until the kiosk/DPC permits exit.
- If the package is **not** allowlisted, the same call enters **screen pinning** after a system confirmation prompt, and the user can exit it. This is not a meaningful stronger security layer for BREAKDOWN. [Activity.startLockTask](https://developer.android.com/reference/android/app/Activity#startLockTask()).

Only a Device Owner / appropriate profile owner / privileged policy holder can configure the lock-task allowlist. [DevicePolicyManager.setLockTaskPackages](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setLockTaskPackages(android.content.ComponentName,%20java.lang.String%5B%5D)).

For dedicated devices, Android's supported production flow says to factory-reset and enroll the device (QR recommended). The development cookbook documents an ADB `dpm set-device-owner` path only after installing the DPC and ensuring there are no accounts. [Dedicated-device provisioning](https://developer.android.com/work/dpc/dedicated-devices), [dedicated-device cookbook](https://developer.android.com/work/dpc/dedicated-devices/cookbook).

Therefore the supported optional stronger mode is:

```text
EXPLICIT USER CHOICE ONLY
factory-reset / supported fully-managed enrollment
    -> BREAKDOWN DPC becomes Device Owner
    -> allowlist BREAKDOWN (+ ChatGPT only if desired) for Lock Task
    -> optionally restrict extra windows/system features
    -> keep the same 3-pair gate and 10x emergency exit inside the kiosk UI
```

Do not silently attempt ADB provisioning or ask the user to factory-reset as part of the normal install.

## Minimal default manifest/service blueprint

Recommended baseline for a modern Samsung build: `minSdk 26`. `TYPE_ACCESSIBILITY_OVERLAY` itself dates to API 22; API 26 keeps the rest of this prototype on modern overlay/background semantics. Android 16 is API 36. Current Android 17 SDK docs expose API 37 but still label the SDK as preview as of 2026-09-01, so for a personal sideload prototype it is reasonable to keep the stable scaffold on `targetSdk 36` and test/raise to 37 when the parent project chooses to adopt the Android 17 target behavior. Do not lower `targetSdk` just to evade platform restrictions. [Android 16 SDK](https://developer.android.com/about/versions/16/setup-sdk), [Android 17 SDK](https://developer.android.com/about/versions/17/setup-sdk).

```xml
<!-- AndroidManifest.xml: core default mode only -->
<manifest ...>
    <application ...>
        <service
            android:name=".lock.BreakdownAccessibilityService"
            android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"
            android:exported="true"
            android:label="@string/accessibility_service_label">
            <intent-filter>
                <action android:name="android.accessibilityservice.AccessibilityService" />
            </intent-filter>
            <meta-data
                android:name="android.accessibilityservice"
                android:resource="@xml/breakdown_accessibility_service" />
        </service>
    </application>
</manifest>
```

```xml
<!-- res/xml/breakdown_accessibility_service.xml -->
<accessibility-service
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="typeWindowStateChanged|typeWindowsChanged|typeWindowContentChanged|typeViewClicked"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:notificationTimeout="80"
    android:canRetrieveWindowContent="true"
    android:accessibilityFlags="flagReportViewIds|flagRetrieveInteractiveWindows"
    android:description="@string/accessibility_service_description" />
```

```kotlin
class BreakdownAccessibilityService : AccessibilityService() {
    override fun onServiceConnected() {
        // Load local gate state; register ACTION_USER_PRESENT while connected.
        // Do not start this AccessibilityService manually as an ordinary service.
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        val pkg = event.packageName?.toString() ?: return

        if (unlockTransitionObserved()) maybeActivateDailyGateKst04()
        if (!state.gateActive) return

        when {
            pkg == configuredChatGptPackage -> {
                hideBlockingOverlay()
                pairDetector.observe(event, rootInActiveWindow)
                if (pairDetector.completedPairs >= 3) satisfyTodayAndRelease()
            }
            pkg == packageName -> hideBlockingOverlay()
            else -> showBlockingAccessibilityOverlay()
        }
    }

    override fun onInterrupt() = Unit
}
```

Implementation notes:

- Resolve/store the user's actual installed ChatGPT package during setup instead of assuming a package name.
- Keep the overlay idempotent (`show` when absent, update in place, `remove` once) to avoid WindowManager churn.
- Do not use `performGlobalAction(BACK/HOME)` as the primary blocker; it is more race-prone and disruptive than holding a touchable overlay over disallowed app content.
- If API 34+ display-attached accessibility overlays are used, guard them with `SDK_INT >= 34`; otherwise use the ordinary `TYPE_ACCESSIBILITY_OVERLAY` WindowManager path.
- Add `SYSTEM_ALERT_WINDOW` only if the team deliberately implements the application-overlay fallback. It is not required by the recommended accessibility-overlay default.
- Add boot/direct-boot receivers only for a concrete need. They are not required to implement “04:00 KST, apply at next unlock.”

## Implementation order

1. Accessibility service setup + Samsung/restricted-setting onboarding.
2. Local KST04 routine-day state machine and `ACTION_USER_PRESENT`/keyguard transition tracking.
3. Full-screen `TYPE_ACCESSIBILITY_OVERLAY` with BREAKDOWN/ChatGPT allowlist and 10x emergency password.
4. ChatGPT new-pair detector behind a replaceable interface; validate selectors on the actual phone/app version.
5. Reboot, permission-revoke, Force Stop, Safe Mode, and Samsung sleep-state manual test matrix.
6. Only if explicitly chosen later: separate Device Owner/DPC + real Lock Task mode workstream.

## Primary official sources

- Android AccessibilityService: https://developer.android.com/reference/android/accessibilityservice/AccessibilityService
- Android accessibility-service guide: https://developer.android.com/guide/topics/ui/accessibility/service
- Android WindowManager overlay types: https://developer.android.com/reference/android/view/WindowManager.LayoutParams
- Android Settings overlay/accessibility actions: https://developer.android.com/reference/android/provider/Settings
- Android background Activity launch security: https://developer.android.com/guide/components/activities/secure-bal
- Android foreground-service background-start restrictions: https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- Android Direct Boot: https://developer.android.com/privacy-and-security/direct-boot
- Android Intent broadcasts (`USER_PRESENT`, `BOOT_COMPLETED`): https://developer.android.com/reference/android/content/Intent
- Android stopped package state: https://developer.android.com/reference/android/content/pm/ApplicationInfo#FLAG_STOPPED
- Android Lock Task mode: https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode
- Android dedicated devices/provisioning: https://developer.android.com/work/dpc/dedicated-devices
- Android dedicated-device cookbook / ADB dev provisioning: https://developer.android.com/work/dpc/dedicated-devices/cookbook
- Android 17 SDK setup (current preview API 37): https://developer.android.com/about/versions/17/setup-sdk
- Google Android Help restricted settings: https://support.google.com/android/answer/12623953
- Samsung sleeping apps: https://www.samsung.com/us/support/answer/ANS10003442/
- Samsung Safe Mode: https://www.samsung.com/us/support/answer/ANS10003495/
