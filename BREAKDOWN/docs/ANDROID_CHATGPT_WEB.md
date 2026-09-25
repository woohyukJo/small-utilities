# BREAKDOWN Android: ChatGPT subscription web integration feasibility

Status: **prototype-only / not yet production-go**
Checked against primary documentation on **2026-09-25**.

## Goal and non-goals

BREAKDOWN must use the user's existing ChatGPT subscription and the real ChatGPT website. The user explicitly does not want a paid model API. OpenAI documents ChatGPT billing and API billing as separate systems, so a ChatGPT subscription is not an API entitlement. The Android design therefore has to host or observe the ChatGPT web experience itself rather than quietly switching to the API.

This document does **not** claim that ChatGPT login works inside Android `WebView`. No authentication was attempted for this research. WebView login support is an empirical device/account question, and Google explicitly restricts OAuth authorization in embedded user-agents. The prototype must test the real user's normal login method without bypassing provider protections.

This design also does not copy Chrome/Custom Tabs cookies into WebView, reuse desktop Electron profile data, spoof OAuth clients, intercept authorization codes, or maintain a guessed identity-provider allowlist.

## Desktop behavior that Android must preserve

The Android boundary is defined by the existing desktop implementation, principally `src/page-probe.ts`, `src/turn-tracker.ts`, `src/conversation.ts`, and the polling path in `src/main.ts`.

The desktop observer does not score content and does not export message text. It observes only message identity, role, completion/error state, generation state, submission/stop/retry serials, and the currently open conversation ID.

### Selected conversation boundary

Desktop accepts only `https://chatgpt.com` conversation URLs with either:

- `/c/{conversationId}`
- `/g/{projectSegment}/c/{conversationId}`

The extracted ID is restricted to `[A-Za-z0-9_-]` and the selected runtime target is stored independently of the browser page. The canonical reopening URL is `https://chatgpt.com/c/{conversationId}`.

Counting occurs only when **both** are true:

1. the WebView/browser URL resolves to the selected conversation ID; and
2. the DOM probe reports that same `conversationId` from `location.pathname`.

If the user is on another ChatGPT conversation, desktop reports `wrong_conversation` and returns to the selected target. Android should keep the same rule. A visually similar page, a ChatGPT home page, or a different conversation must never count.

### What counts as a submitted turn

`page-probe.ts` installs document listeners once per document using `globalThis.__breakdownProbe`.

Before a detected send, it snapshots existing DOM IDs from `data-turn-id`, `data-turn-id-container`, and `data-message-id`, then increments `submitSerial`. It detects:

- Enter in the composer, excluding Shift+Enter and IME composition;
- a click on `data-testid="send-button"`;
- and, independently, a newly appended user turn after the previously known user tail.

The last rule is important on mobile. A changed send button, IME behavior, voice input, or missed click hook does not prevent counting if a genuinely new user turn ID appears after the known tail. Re-mounted or prepended history does not count.

### History exclusion and de-duplication

On first observation, every existing message ID is marked seen. Existing history therefore starts at zero.

Each candidate message must have a stable ID and is de-duplicated by role plus ID inside the probe and again by tracker state. Historical turns that later reappear because of virtualization are ignored. A new submission is accepted only when its user ID was not in the submission baseline or it appears after the previously known tail.

### Completion, stop, error, and retry behavior

An assistant message is considered complete by the probe only when:

- an explicit response action control exists on that turn (copy / good response / bad response variants used by the current desktop selector set);
- the page is not currently generating; and
- the turn is not marked as an error.

`TurnTracker` then requires **two consecutive complete observations** of the same assistant ID before emitting `completed`. This avoids counting a transient DOM state.

If the user explicitly stops generation, every pending user turn emits `aborted`, pending state is cleared, and the stopped answer does not count. A later explicit retry/regenerate can re-open the most recent aborted user turn and that retried answer may complete once. Error-marked assistant turns abort their paired user turn.

Pending and aborted user IDs can be restored after app restart, but ordinary historical completed turns still cannot count.

Android should preserve these semantics rather than invent a simpler "assistant node exists" counter.

## Feasibility result

There is one technically honest architecture worth prototyping:

**A persistent, in-app Android `WebView` hosts ChatGPT, and BREAKDOWN polls the loaded ChatGPT DOM with `WebView.evaluateJavascript(...)`.**

Android's official WebView API supports executing JavaScript in the context of the loaded page, which is the capability the desktop design fundamentally needs. `CookieManager` manages cookies used by an application's WebView instances and can flush them to persistent storage. This makes a persistent WebView profile plausible.

However, feasibility is **not established until the real account can log in and stay logged in on a real device**. The largest blocker is authentication, especially Google OAuth.

## Authentication constraints

### ChatGPT subscription and login method

OpenAI's current help documentation states that ChatGPT and API billing are separate. It also tells users who registered through Google, Microsoft, or Apple to continue using the same authentication method when logging in.

Therefore the prototype cannot assume an email/password fallback exists for a social-login account.

### Google OAuth is a concrete blocker for embedded WebView

Google's OAuth 2.0 policy states that developers must not direct Google OAuth authorization requests to an embedded user-agent under the developer's control. Google specifically describes `disallowed_useragent` when the authorization endpoint is shown in such an embedded agent.

An Android WebView is exactly the kind of surface that can run arbitrary application-supplied JavaScript and alter navigation. Therefore, if ChatGPT's normal "Continue with Google" flow reaches Google's OAuth authorization endpoint inside BREAKDOWN's WebView, the prototype must expect that Google may reject it.

This is **not** proof that every current ChatGPT/Google login attempt will fail on every device/account. It is proof that BREAKDOWN cannot promise success or work around the restriction. The go/no-go decision must come from a real device/account test using the user's ordinary sign-in path.

For Microsoft, Apple, password login, MFA, passkeys, or future identity providers, this report intentionally makes no provider-specific success claim and recommends no hard-coded provider host list. Follow the actual HTTPS redirect flow presented by ChatGPT and treat provider rejection as a real blocker rather than trying to route around it.

### No guessed auth host whitelist

The desktop code currently contains an explicit set of known auth hosts. The Android feasibility prototype should not copy that list as an assumption about all future providers.

For the prototype:

- while the user is explicitly in the ChatGPT login flow, allow normal top-level HTTP(S) navigation to proceed inside the same WebView by returning `false` from `WebViewClient.shouldOverrideUrlLoading(...)`;
- suspend all counting whenever the top-level origin is not `https://chatgpt.com`;
- once ChatGPT returns with a visible composer, end the auth state and reload the runtime-selected conversation;
- do not automatically trust or launch arbitrary non-HTTP(S) schemes. If one is required by the real flow, record it as an observed compatibility requirement and decide explicitly.

Android's `shouldOverrideUrlLoading` documentation specifically says that returning `false` lets WebView continue the navigation and warns against cancelling the load and calling `loadUrl()` again with the same URL.

### Popup/new-window handling

Authentication may use `window.open` or a target that requests a new browsing window. Android exposes this through `WebChromeClient.onCreateWindow(...)`.

The prototype should create a temporary child WebView when a genuine popup is requested, attach the same `WebViewClient`/`WebChromeClient` policy, keep it in the **same app process and WebView data profile**, and destroy it when the flow closes or returns to ChatGPT. This mirrors the desktop popup concept without guessing the provider domain.

Do not move the popup into a Custom Tab merely to make login succeed unless the prototype is prepared to abandon DOM counting afterward; the browser and WebView do not share the same cookie store.

## Cookie/profile model

Use Android's application WebView cookie/profile facilities as the only web session for the prototype.

- `CookieManager.getInstance()` manages cookies for the application's WebView instances.
- Cookies are accepted by default; call `setAcceptCookie(true)` explicitly only for clarity if desired.
- `CookieManager.flush()` forces currently accessible cookies to persistent storage.
- Keep the ChatGPT WebView in one application process. Android documents that different WebView data directories do not directly share WebView data.
- If `WebView.setDataDirectorySuffix(...)` is ever introduced for multiprocess isolation, it must be set before WebView initialization and each process must use its own suffix. That creates extra login-cookie synchronization work and is unnecessary for the small prototype.

Do **not** import cookies from Chrome, Custom Tabs, Electron, another app, or a copied config/profile directory. The prototype's validity depends on login completing normally inside its own WebView profile.

Third-party cookies should not be enabled speculatively. Start with WebView defaults. If a real login flow demonstrably fails because a required third-party cookie is blocked, record that as a concrete compatibility finding before changing policy.

## Why Custom Tabs / external browser are not a counting fallback

Normal Android Custom Tabs are powered by the user's preferred browser and, by design, share browser state such as cookies with that browser. Chrome's own documentation contrasts this with WebView, which does not share browser state.

That produces two separate session worlds:

1. Chrome / the browser / normal Custom Tabs; and
2. BREAKDOWN's application WebView `CookieManager` store.

Logging into ChatGPT successfully in a Custom Tab therefore does **not** imply that BREAKDOWN's WebView becomes logged in. There is no supported Android API that gives an app Chrome's authenticated cookie jar for arbitrary reuse in WebView, and this design must not attempt to bypass that boundary.

Custom Tabs also do not expose a `WebView.evaluateJavascript` equivalent for arbitrary DOM inspection. Their AndroidX API exposes navigation/session callbacks and a `postMessage` channel, but `postMessage` is not arbitrary DOM script injection. It requires a messaging relationship/page cooperation; relationship validation mechanisms such as Digital Asset Links do not grant BREAKDOWN ownership of `chatgpt.com` or permission to inject a DOM probe there.

Therefore:

- **external browser / Custom Tab login can be a diagnostic UX option**, showing that the account itself can log in;
- **it is not a viable way to count ChatGPT DOM turns for BREAKDOWN**;
- **it is not a supported bridge that transfers the browser session back into WebView**.

If WebView login is impossible for the user's required identity flow, the subscription-web approach is a no-go unless OpenAI later provides an official integration surface that preserves subscription use and app-side observation.

## Android WebView host design for the prototype

Keep the prototype deliberately small. It should answer only: "Can the real account authenticate in this WebView, reopen the fixed conversation after restart, and reproduce desktop turn counting?"

### WebView configuration

Minimum host behavior:

- one persistent WebView in the main app process;
- JavaScript enabled because ChatGPT and the probe require it;
- DOM storage enabled if required by the site runtime;
- normal HTTPS networking and Safe Browsing left intact;
- `CookieManager` used as the persistent WebView cookie store;
- `WebViewClient` for top-level navigation, load/error signals, and renderer recovery decisions;
- `WebChromeClient` for popup/new-window requests;
- no `addJavascriptInterface` bridge is required for counting. Prefer one-way host polling with `evaluateJavascript` so the third-party page is not given an Android object to call.

Do not call `SslErrorHandler.proceed()` to make authentication or page loading "work". TLS, Safe Browsing, OAuth, and provider errors are blockers to report, not protections to bypass.

### Polling with `evaluateJavascript`

`WebView.evaluateJavascript(script, callback)` runs JavaScript in the context of the loaded page and returns the result asynchronously. Poll on the UI thread, for example every **500-1000 ms** while all of the following are true:

- the Activity/WebView is active;
- top-level origin is `https://chatgpt.com`;
- a selected conversation exists;
- no previous evaluation is still outstanding.

Do not use `onPageFinished` as the signal that the DOM is ready. Android's documentation explicitly says `onPageFinished()` does not guarantee that the next rendered frame reflects the current DOM state. It is useful as a hint to begin polling, not as a completion boundary.

Treat a null result, JavaScript exception, timeout, or JSON parse failure as **no observation**. It must never count or unlock anything.

### Minimal self-contained JavaScript reuse

The lowest-drift strategy is to reuse the desktop detector as JavaScript instead of re-describing ChatGPT selectors in Kotlin.

For the prototype, build or copy a single self-contained JS asset from the existing logic with these properties:

1. include the compiled form of `readChatPage()` from `src/page-probe.ts` unchanged in behavior;
2. include the compiled `TurnTracker` state machine from `src/turn-tracker.ts` unchanged in behavior;
3. expose one idempotent global, for example `globalThis.__breakdownMobile.tick(...)`;
4. on first call for a document, initialize the same probe listeners and construct a tracker using native-supplied `resumePending` / `resumeAborted` IDs;
5. on every call, run `readChatPage()`, feed the snapshot to `TurnTracker.accept()`, and return `JSON.stringify({ snapshotMeta, events })`;
6. return only metadata already used by desktop: IDs, roles, completion/error flags, conversation ID, composer/generating booleans, and serials. Never return message text.

The Android host should decode the `evaluateJavascript` callback result, verify the conversation boundary again natively, and then persist/forward only the resulting `submitted`, `aborted`, and `completed` events.

Because `evaluateJavascript` runs in the page's JavaScript world rather than Electron's isolated world, use a uniquely named global and avoid exposing secrets there. The probe currently stores only counters and DOM IDs, so this difference is acceptable for a feasibility test.

If bundling both modules is inconvenient for the first spike, the second-best prototype is to inject only `readChatPage()` and port `TurnTracker` mechanically to Kotlin. Do not simplify its semantics; the two-stable-observation completion rule, baseline logic, stop/retry handling, de-duplication, and restart state are part of the contract.

## Error recovery requirements

The prototype should fail closed.

| Condition | Required behavior |
|---|---|
| WebView not on `chatgpt.com` | Suspend probe/counting. If in explicit login flow, wait for normal return. Otherwise offer reload of selected conversation. |
| URL conversation ID != selected target | Count nothing; reload the selected canonical `/c/{id}` target. |
| DOM-reported conversation ID != selected target | Count nothing; treat as wrong conversation/unsupported page state. |
| Probe returns malformed/null/exception | Count nothing; retry later. |
| No composer after ChatGPT page load | Show reconnect/login-needed state; do not infer success from URL alone. |
| Network/HTTP load failure | Keep gate locked; allow manual retry/reload. |
| Renderer process gone | Recreate the WebView in the same app process/profile, reload selected conversation, reinject probe, and resume only explicitly persisted pending/aborted IDs. |
| Page refresh/navigation reset | Reinitialize the JS global. First snapshot becomes history baseline; existing completed history does not count. |
| User stops generation | Emit/retain aborted state; do not count answer. |
| User retries an aborted turn | Re-open only the matching aborted user ID and allow one future completion. |
| ChatGPT DOM selectors/IDs change | Mark detection unsupported. Do not guess from message text or visual timing. |
| OAuth/provider rejects WebView | Stop auth attempt and report incompatibility. Do not spoof user-agent, steal/copy browser cookies, or automate around provider restrictions. |

Persist the selected conversation ID, target revision, pending user IDs, and aborted user IDs outside the page exactly as desktop does conceptually. Page-local JS state is disposable.

## Prototype go/no-go sequence

The parent implementation should stop as soon as a mandatory gate fails.

### Gate 1: WebView rendering

**Test:** Load `https://chatgpt.com/` in the persistent WebView on the intended Android version/device with JavaScript enabled.

**GO:** ChatGPT renders normally enough to reach either the login UI or a logged-in composer.

**NO-GO:** ChatGPT itself rejects the WebView/browser environment, repeatedly challenges without reaching a usable page, or the renderer is unstable.

### Gate 2: real-account authentication

**Test:** The user manually follows their normal ChatGPT sign-in method inside the WebView. Do not automate credentials or OAuth.

**GO:** The flow returns to `chatgpt.com`, the composer becomes visible, the app is killed/restarted, and the WebView profile remains authenticated.

**NO-GO:** Required identity flow is rejected as an embedded user-agent, only succeeds in the external browser, requires unsupported handoff with no return session, or loses the session on restart.

For a Google-backed account, a `disallowed_useragent` outcome is a clean no-go for this architecture on that account/device. There is no recommended bypass.

### Gate 3: selected conversation

**Test:** Save one real conversation ID at runtime, reopen its canonical URL, then intentionally navigate to another conversation.

**GO:** Probe reports the selected ID only on the selected conversation; the wrong conversation never emits countable events and the host can return to the target.

**NO-GO:** Mobile ChatGPT URLs/DOM do not expose a stable conversation ID compatible with the desktop contract.

### Gate 4: DOM turn semantics

Run the same small behavioral matrix used by desktop:

1. existing history present before observer starts -> zero;
2. one new Enter/send submission + completed short answer -> exactly one;
3. long streaming answer -> zero until generation stops and completion is stable twice;
4. explicit stop -> aborted, never completed;
5. retry/regenerate after stop -> may complete once;
6. refresh -> old completed history still zero;
7. scroll/history virtualization -> remounted old IDs remain zero;
8. IME/voice/send-hook miss -> newly appended user ID still submits once;
9. switch to wrong conversation -> zero.

**GO:** All nine preserve desktop behavior with stable IDs/selectors.

**NO-GO:** The mobile ChatGPT DOM omits stable turn IDs, completion controls are not observable, or virtualized history cannot be distinguished from new turns using the existing identity rules.

### Final decision

Only after Gates 1-4 pass on the real target device/account should BREAKDOWN proceed with an Android WebView implementation.

If Gate 2 fails but Custom Tab/external-browser login succeeds, treat that as evidence that authentication works in the browser and **not** as evidence that BREAKDOWN integration works. Because browser DOM observation and session reuse are unavailable to the app through supported APIs, that branch is still a no-go for the current subscription-web design.

## Primary sources

Official sources checked 2026-09-25:

- OpenAI Help Center — ChatGPT and API billing are separate:
  https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform
- OpenAI Help Center — login troubleshooting and requirement to use the original social login method:
  https://help.openai.com/en/articles/7426629-why-cant-i-log-in-to-chatgpt
- Android Developers — `WebView` API, including `evaluateJavascript` and WebView data directory behavior:
  https://developer.android.com/reference/android/webkit/WebView
- Android Developers — building web apps in WebView / JavaScript configuration:
  https://developer.android.com/develop/ui/views/layout/webapps/webview
- Android Developers — `CookieManager`, including persistent `flush()`:
  https://developer.android.com/reference/android/webkit/CookieManager
- Android Developers — `WebViewClient`, including `shouldOverrideUrlLoading`, load errors, `onPageFinished`, and renderer callbacks:
  https://developer.android.com/reference/android/webkit/WebViewClient
- Android Developers — `WebChromeClient.onCreateWindow`:
  https://developer.android.com/reference/android/webkit/WebChromeClient
- Google for Developers — OAuth 2.0 policy forbidding developer-controlled embedded user-agents:
  https://developers.google.com/identity/protocols/oauth2/policies
- Google for Developers — OAuth native-app error documentation including `disallowed_useragent`:
  https://developers.google.com/identity/protocols/oauth2/native-app
- Chrome for Developers — Android Custom Tabs overview; normal Custom Tabs use/share the user's browser state:
  https://developer.chrome.com/docs/android/custom-tabs
- Chrome for Developers — opening Custom Tabs from WebView; third-party sites benefit from default-browser cookie sharing:
  https://developer.chrome.com/docs/android/custom-tabs/howto-custom-tab-from-webview
- Android Developers — `CustomTabsSession`, including navigation/session communication, postMessage, and relationship validation APIs:
  https://developer.android.com/reference/androidx/browser/customtabs/CustomTabsSession
- Chrome for Developers — Auth Tab, showing browser-owned authentication with callback/relationship validation rather than WebView DOM access:
  https://developer.chrome.com/docs/android/custom-tabs/guide-auth-tab

## Recommendation

Proceed with a **small feasibility spike only**: one persistent WebView, real manual login, one runtime-selected ChatGPT conversation, `evaluateJavascript` polling, and the existing probe/tracker semantics. Do not build Android gate/product UI around it until real login persistence and the nine DOM tests pass.

The architecture has a credible DOM-observation path, but authentication is a first-class feasibility gate. External browser/Custom Tabs do not solve that gate for BREAKDOWN because they neither share their authenticated cookie store with the app WebView nor provide supported arbitrary ChatGPT DOM evaluation.
