import { app, BrowserWindow, WebContentsView, ipcMain, session, screen, Tray, Menu, nativeImage, WebContents, dialog, clipboard } from "electron";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { GuardClient } from "./pipe";
import { emptyStatus, GateStatus, PageSnapshot } from "./protocol";
import { NavigationPolicy, isChatConversation } from "./navigation";
import { TurnTracker, TurnEvent } from "./turn-tracker";
import { readChatPage } from "./page-probe";
import { canonicalConversationUrl, conversationIdFromUrl, isConversationTarget } from "./conversation";
import { WindowPresentation, sameBounds } from "./window-presentation";

const smoke = process.argv.includes("--smoke");
const preview = process.argv.includes("--preview") || smoke;
const managed = process.argv.includes("--managed") && !preview;
const pipeIndex = process.argv.indexOf("--pipe");
function defaultPipe(): string {
  if (!app.isPackaged) return "BREAKDOWN-Dev";
  const identity = execFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "whoami.exe"), ["/user", "/fo", "csv", "/nh"], { windowsHide: true, encoding: "utf8" });
  const sid = /S-1-5-[0-9-]+/.exec(identity)?.[0];
  if (!sid) throw new Error("Windows 계정을 확인할 수 없습니다.");
  return "BREAKDOWN-" + sid;
}
const client = new GuardClient(pipeIndex >= 0 ? process.argv[pipeIndex + 1] : defaultPipe());
const userRoot = process.env.LOCALAPPDATA || app.getPath("appData");
const profile = app.isPackaged && !smoke
  ? path.join(userRoot, "BREAKDOWN", preview ? "preview" : "browser")
  : path.join(process.cwd(), ".dev", preview ? "preview" : "browser");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
app.setAppUserModelId("local.breakdown.desktop");
let window: BrowserWindow;
let presentation: WindowPresentation;
let chat: WebContentsView;
let tray: Tray;
let trayLocked: boolean | undefined;
let status: GateStatus = { ...emptyStatus };
let connected = false, shellResponsive = true, modal = false, quitting = false;
let tracker = new TurnTracker();
let error = "", polling = false, restoring = false;
let currentDay = "";
let redirectedFrom: string | null = null;
let testUser = "";
let authPageLoaded = false;
let pendingEvents: TurnEvent[] = [];
let observationEpoch = 0;
let targetChanging = false;
const policy = new NavigationPolicy(false);
const popups = new Set<BrowserWindow>();
const shields = new Map<number, { window: BrowserWindow; locked: boolean }>();
let chatVisible: boolean | undefined;
const shellFile = path.join(__dirname, "..", "ui", "index.html");
const locked = () => managed && status.armed && !status.unlocked;
const safeChatUrl = () => status.conversationId ? canonicalConversationUrl(status.conversationId) : "https://chatgpt.com/";
let lastDetection = { phase: "loading", users: 0, assistants: 0, completedResponses: 0,
  submitSignals: 0, generating: false, composer: false };
async function reportDetection(phase: string, snapshot?: PageSnapshot) {
  lastDetection = snapshot ? {
    phase, users: snapshot.messages.filter(m => m.role === "user").length,
    assistants: snapshot.messages.filter(m => m.role === "assistant").length,
    completedResponses: snapshot.messages.filter(m => m.role === "assistant" && m.complete && !m.error).length,
    submitSignals: snapshot.submitSerial, generating: snapshot.generating, composer: snapshot.composer
  } : { ...lastDetection, phase };
  if (!preview) await client.request("ReportDetectionStatus", lastDetection).catch(() => {});
}
function resetObservation() {
  observationEpoch++;
  testUser = "";
  pendingEvents = [];
  tracker = new TurnTracker(status.pendingUserIds, status.abortedUserIds);
}
async function selectTarget(conversationId: string, navigate: boolean) {
  if (preview) throw new Error("미리보기에서는 대화 설정을 저장하지 않습니다.");
  if (targetChanging) throw new Error("대화 설정을 저장하고 있어요. 잠시 후 다시 시도하세요.");
  if (status.conversationId === conversationId) { error = ""; return; }
  targetChanging = true;
  observationEpoch++;
  try {
    const next = await client.request<GateStatus>("SetConversationTarget", { conversationId });
    await updateStatus(next);
    redirectedFrom = null; error = "";
    if (navigate && !isConversationTarget(chat.webContents.getURL(), conversationId))
      await chat.webContents.loadURL(canonicalConversationUrl(conversationId));
  } finally { observationEpoch++; targetChanging = false; }
}

function publish() {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send("state", {
    ...status, connected, preview: !managed, error, authenticating: policy.authenticating
  });
}
async function updateStatus(next?: GateStatus) {
  const refreshEpoch = observationEpoch;
  if (!next) {
    next = await client.request<GateStatus>("GetGateStatus");
    if (refreshEpoch !== observationEpoch || targetChanging) return;
  }
  const wasLocked = locked();
  const previousTarget = status.conversationId;
  const previousRevision = status.targetRevision;
  status = next;
  policy.setLocked(locked());
  connected = true;
  if (managed && status.uiDismissed && !locked()) { finishQuit(); return; }
  const dayChanged = currentDay !== status.day;
  const targetChanged = previousTarget !== status.conversationId || previousRevision !== status.targetRevision;
  if (dayChanged || targetChanged) resetObservation();
  if (dayChanged) {
    currentDay = status.day; redirectedFrom = null;
    if (chat && !smoke && !policy.authenticating) await chat.webContents.loadURL(safeChatUrl()).catch(() => {});
  }
  if (wasLocked !== locked()) applyLock();
  updateTrayMenu();
  publish();
}
async function requestStatus(method: string, args: Record<string, string> = {}) {
  const epoch = observationEpoch;
  const next = await client.request<GateStatus>(method, args);
  if (epoch === observationEpoch && !targetChanging) await updateStatus(next);
}
function finishQuit() {
  if (quitting) return;
  quitting = true;
  for (const popup of popups) if (!popup.isDestroyed()) popup.destroy();
  for (const shield of shields.values()) if (!shield.window.isDestroyed()) shield.window.destroy();
  shields.clear();
  if (chat && !chat.webContents.isDestroyed()) chat.webContents.close();
  if (tray && !tray.isDestroyed()) tray.destroy();
  app.quit();
}
async function quitFromTray() {
  if (quitting) return;
  try {
    // Persist intentional exit before terminating, so the watchdog doesn't
    // mistake it for a crash. The service checks the current lock state.
    if (managed) await client.request("RequestUiExit");
    finishQuit();
  } catch (e) {
    error = e instanceof Error ? e.message : "종료 상태를 확인하지 못했어요.";
    publish();
  }
}
function updateTrayMenu() {
  if (!tray || tray.isDestroyed() || trayLocked === locked()) return;
  trayLocked = locked();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "대화 열기", click: () => { window.show(); window.focus(); } },
    { label: "종료", enabled: !locked(), click: () => void quitFromTray() }
  ]));
}
function applyLock() {
  if (!window || window.isDestroyed()) return;
  presentation.applyLock(locked(), screen.getPrimaryDisplay().bounds);
  syncShields();
  layout();
}
function syncShields() {
  const primary = screen.getPrimaryDisplay().id;
  const displays = presentation.coversDisplay ? screen.getAllDisplays().filter(d => d.id !== primary) : [];
  const wanted = new Set(displays.map(d => d.id));
  for (const [id, shield] of shields) {
    if (!wanted.has(id)) { shield.window.destroy(); shields.delete(id); }
  }
  for (const display of displays) {
    let entry = shields.get(display.id);
    if (!entry || entry.window.isDestroyed()) {
      const shield = new BrowserWindow({
        ...display.bounds, frame: false, skipTaskbar: true, alwaysOnTop: locked(),
        closable: !locked(), minimizable: !locked(), backgroundColor: "#101820",
        webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true }
      });
      shield.setAlwaysOnTop(locked(), "screen-saver");
      shield.webContents.on("before-input-event", handlePresentationKey);
      void shield.loadURL("data:text/html," + encodeURIComponent('<body style="background:#101820;color:#d0dddb;font:24px system-ui;display:grid;place-content:center;height:90vh">BREAKDOWN<br><small style="font-size:15px">주 화면에서 대화를 이어가세요. 완료 후 ESC로 창 모드.</small></body>'));
      entry = { window: shield, locked: locked() };
      shields.set(display.id, entry);
    }
    if (!sameBounds(entry.window.getBounds(), display.bounds)) entry.window.setBounds(display.bounds);
    if (entry.locked !== locked()) {
      entry.window.setClosable(!locked());
      entry.window.setMinimizable(!locked());
      entry.window.setAlwaysOnTop(locked(), "screen-saver");
      entry.locked = locked();
    }
  }
}
function handlePresentationKey(event: Electron.Event, input: Electron.Input) {
  if (locked() && input.key === "F11") { event.preventDefault(); return; }
  if (input.type !== "keyDown" || input.key !== "Escape" || input.isAutoRepeat ||
      modal || policy.authenticating || popups.size > 0) return;
  if (presentation?.escape()) {
    event.preventDefault();
    syncShields();
    layout();
  }
}
function layout() {
  if (!window || !chat || window.isDestroyed()) return;
  const [width, height] = window.getContentSize();
  const bounds = { x: 320, y: 96, width: Math.max(1, width - 344), height: Math.max(1, height - 120) };
  if (!sameBounds(chat.getBounds(), bounds)) chat.setBounds(bounds);
  const visible = !modal && !smoke;
  if (chatVisible !== visible) { chat.setVisible(visible); chatVisible = visible; }
}
async function returnToTarget(url: string) {
  if (policy.authenticating || !locked() || targetChanging) return;
  const target = status.conversationId;
  if (!target || isConversationTarget(url, target)) { redirectedFrom = null; return; }
  if (redirectedFrom === url) {
    error = "선택한 대화를 아직 열지 못했어요. 로그인 상태나 대화 접근 권한을 확인해 주세요.";
    publish(); return;
  }
  redirectedFrom = url;
  resetObservation();
  await chat.webContents.loadURL(safeChatUrl());
}
function restrict(contents: WebContents) {
  const deny = (url: string, frame: boolean) => !policy.authorizeNavigation(url, frame);
  contents.on("will-frame-navigate", (event) => {
    if (deny(event.url, !event.isMainFrame)) {
      event.preventDefault(); error = "이 링크는 앱에서 열 수 없습니다. ‘로그인 / 다시 연결’로 다시 시작해 주세요."; publish();
    } else if (policy.authenticating) { error = ""; publish(); }
  });
  contents.on("will-redirect", (event, url, _inPlace, mainFrame) => {
    if (deny(url, !mainFrame)) {
      event.preventDefault(); error = "웹 로그인으로 연결되지 않았어요. ‘로그인 / 다시 연결’로 다시 시작해 주세요."; publish();
    } else if (policy.authenticating) { error = ""; publish(); }
  });
  contents.setWindowOpenHandler(details => {
    if (!policy.authorizeNavigation(details.url)) return { action: "deny" };
    if (!policy.authenticating) {
      if (locked()) return { action: "deny" };
      policy.beginAuth();
    }
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        parent: window, modal: true, width: 680, height: 780, autoHideMenuBar: true,
        alwaysOnTop: locked(),
        webPreferences: { partition: "persist:breakdown-chat", sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false }
      }
    };
  });
  contents.on("did-create-window", popup => {
    popups.add(popup); restrict(popup.webContents);
    // A popup may close before the main page finishes its auth callback.
    popup.on("closed", () => { popups.delete(popup); publish(); });
    popup.webContents.on("did-finish-load", async () => {
      if (!isChatConversation(popup.webContents.getURL())) return;
      try {
        const result = await popup.webContents.executeJavaScriptInIsolatedWorld(987, [{ code: "(" + readChatPage.toString() + ")()" }]) as PageSnapshot;
        if (result.composer) {
          policy.endAuth(); authPageLoaded = false;
          for (const other of popups) other.close();
          error = ""; resetObservation(); await chat.webContents.loadURL(safeChatUrl()); publish();
        }
      } catch { /* failed login keeps the gate locked */ }
    });
  });
  contents.on("will-attach-webview", event => event.preventDefault());
  contents.on("before-input-event", (event, input) => {
    if (contents === chat?.webContents) handlePresentationKey(event, input);
    if (input.key === "F12" || ((input.control || input.meta) && input.shift && /[ijc]/i.test(input.key)))
      event.preventDefault();
  });
}
async function resetBrowser() {
  if (quitting || restoring || !chat) return;
  restoring = true;
  try {
    // The shell and native backdrop are separate from this disposable renderer.
    window.contentView.removeChildView(chat);
    if (!chat.webContents.isDestroyed()) chat.webContents.close();
    createChat();
    authPageLoaded = false;
    await chat.webContents.loadURL(policy.authenticating ? "https://chatgpt.com/auth/login" : safeChatUrl());
  } catch { error = "대화 화면 복구에 실패했습니다. 다시 연결하거나 비상 해제를 사용하세요."; }
  finally { restoring = false; publish(); }
}
function createChat() {
  chatVisible = undefined;
  chat = new WebContentsView({ webPreferences: {
    partition: "persist:breakdown-chat", sandbox: true, contextIsolation: true,
    nodeIntegration: false, devTools: false, webSecurity: true
  } });
  chat.setBackgroundColor("#ffffff");
  window.contentView.addChildView(chat); restrict(chat.webContents); layout();
  resetObservation();
  chat.webContents.on("did-finish-load", () => {
    resetObservation();
    if (policy.authenticating) authPageLoaded = true;
  });
  chat.webContents.on("unresponsive", () => { error = "대화 화면을 복구하고 있습니다."; publish(); void resetBrowser(); });
  chat.webContents.on("render-process-gone", () => { void resetBrowser(); });
  chat.webContents.on("did-navigate-in-page", async (_event, url, mainFrame) => {
    if (!mainFrame) return;
    if (policy.authenticating) return;
    if (!policy.allows(url) || isChatConversation(url))
      await returnToTarget(url).catch(() => { error = "선택한 대화 연결을 다시 시도해 주세요."; publish(); });
  });
}
async function poll() {
  if (quitting || polling || smoke || targetChanging) return;
  polling = true;
  try {
    if (!preview) {
      const refreshEpoch = observationEpoch;
      const fresh = await client.request<GateStatus>("GetGateStatus");
      if (refreshEpoch !== observationEpoch) return;
      await updateStatus(fresh);
    }
    if (quitting) return;
    if (!chat.webContents.isDestroyed() && chat.webContents.getURL().startsWith("https://chatgpt.com/")) {
      const epoch = observationEpoch;
      const target = status.conversationId;
      const targetRevision = status.targetRevision;
      const snapshot = await Promise.race([
        chat.webContents.executeJavaScriptInIsolatedWorld(987, [{ code: "(" + readChatPage.toString() + ")()" }]),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("대화 화면 확인 시간 초과")), 2500))
      ]) as PageSnapshot;
      if (epoch !== observationEpoch || target !== status.conversationId) return;
      await reportDetection(policy.authenticating ? "login" : "observing", snapshot);
      if (epoch !== observationEpoch || target !== status.conversationId) return;
      if (policy.authenticating) {
        if (snapshot.composer && authPageLoaded && popups.size === 0 && isChatConversation(chat.webContents.getURL())) {
          policy.endAuth(); authPageLoaded = false; error = "";
          for (const popup of popups) popup.close();
          resetObservation();
          if (status.conversationId && !isConversationTarget(chat.webContents.getURL(), status.conversationId))
            await chat.webContents.loadURL(safeChatUrl());
        } else { publish(); return; }
        return;
      }
      if (!target) { error = ""; publish(); return; }
      if (!isConversationTarget(chat.webContents.getURL(), target) || snapshot.conversationId !== target) {
        await reportDetection("wrong_conversation", snapshot);
        if (epoch !== observationEpoch || target !== status.conversationId) return;
        if (isChatConversation(chat.webContents.getURL())) await returnToTarget(chat.webContents.getURL());
        return;
      }
      redirectedFrom = null;
      const events = tracker.accept(snapshot);
      if (events.length) await reportDetection(events.at(-1)!.type, snapshot);
      if (epoch !== observationEpoch || target !== status.conversationId) return;
      pendingEvents.push(...events);
      if (preview) pendingEvents = [];
      while (pendingEvents.length) {
        if (epoch !== observationEpoch || target !== status.conversationId) { pendingEvents = []; return; }
        const event = pendingEvents[0];
        if (!status.armed) {
          if (event.type === "submitted") testUser = event.userId;
          if (event.type === "completed" && event.userId === testUser) {
            const readyStatus = await client.request<GateStatus>("MarkReady", { conversationId: target, targetRevision });
            if (epoch !== observationEpoch || target !== status.conversationId) { pendingEvents = []; return; }
            await updateStatus(readyStatus); testUser = "";
          }
          if (pendingEvents[0] === event) pendingEvents.shift();
          continue;
        }
        if (status.unlocked) { pendingEvents = []; break; }
        const args = { conversationId: target, targetRevision, ...event };
        if (event.type === "submitted") await client.request("ObserveUserTurn", args);
        if (event.type === "aborted") await client.request("AbortTurn", args);
        if (event.type === "completed") {
          const completedStatus = await client.request<GateStatus>("RecordCompletedTurn", args);
          if (epoch !== observationEpoch || target !== status.conversationId) { pendingEvents = []; return; }
          await updateStatus(completedStatus);
        }
        if (pendingEvents[0] === event) pendingEvents.shift();
      }
      if (!snapshot.composer && !policy.authenticating) error = "선택한 대화를 준비하고 있어요. 필요하면 ‘선택한 대화 열기’로 다시 연결해 주세요.";
      else error = "";
    }
    publish();
  } catch (e) {
    void reportDetection("error");
    error = "연결을 확인하지 못했습니다. " + (e instanceof Error ? e.message : "");
    // Preserve the last known lock on transport failure.
    publish();
  } finally { polling = false; }
}
async function reportHealth() {
  if (preview || !window || window.isDestroyed()) return;
  try {
    const handle = window.getNativeWindowHandle();
    await client.request("ReportUiHealth", {
      handle: Number(handle.length >= 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())),
      responsive: shellResponsive && !window.webContents.isDestroyed() && !window.webContents.isLoading()
    });
  } catch { /* Last known lock remains in both the shell and native guard. */ }
}

if (app.isPackaged && !managed && !preview) {
  app.whenReady().then(async () => {
    try { await client.request("ShowUi"); }
    catch { dialog.showErrorBox("BREAKDOWN", "관리 서비스가 실행되지 않았습니다. 설치·복구 안내를 확인하세요."); }
    app.quit();
  });
}
else if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    const chatSession = session.fromPartition("persist:breakdown-chat");
    chatSession.setPermissionRequestHandler((_web, _permission, callback) => callback(false));
    chatSession.setPermissionCheckHandler(() => false);
    chatSession.on("will-download", event => event.preventDefault());
    if (!preview) {
      try { status = await client.request<GateStatus>("Hello"); connected = true; }
      catch { error = "관리 서비스에 연결할 수 없습니다. 설치 상태를 확인하세요."; }
    }
    if (managed && status.uiDismissed && !locked()) { quitting = true; app.quit(); return; }
    currentDay = status.day;
    policy.setLocked(locked());
    window = new BrowserWindow({
      width: 1360, height: 900, minWidth: 1000, minHeight: 680, show: !smoke,
      frame: false, backgroundColor: "#f5f4ef",
      webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: !app.isPackaged }
    });
    presentation = new WindowPresentation(window);
    window.webContents.on("before-input-event", handlePresentationKey);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.on("close", event => {
      if (!quitting && (locked() || managed)) { event.preventDefault(); if (!locked()) window.hide(); }
    });
    window.on("resize", layout);
    window.on("minimize", () => { if (locked()) window.restore(); });
    window.webContents.on("unresponsive", () => { shellResponsive = false; });
    window.webContents.on("responsive", () => { shellResponsive = true; });
    window.webContents.on("render-process-gone", () => { if (!quitting) { shellResponsive = false; void window.loadFile(shellFile); } });
    window.webContents.on("did-finish-load", () => { shellResponsive = true; publish(); });
    createChat();
    await window.loadFile(shellFile);
    if (!smoke) void chat.webContents.loadURL(safeChatUrl()).catch(() => { error = "ChatGPT 연결 실패"; publish(); });
    const icon = nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
    tray = new Tray(icon); tray.setToolTip("BREAKDOWN");
    updateTrayMenu();
    tray.on("click", () => window.show());
    screen.on("display-added", applyLock); screen.on("display-removed", applyLock); screen.on("display-metrics-changed", applyLock);
    applyLock();
    setInterval(() => void poll(), 1000);
    setInterval(() => {
      void reportHealth();
      if (!policy.authenticating && popups.size) for (const popup of popups) popup.close();
    }, 1000);
    if (smoke) {
      setTimeout(async () => {
        fs.mkdirSync(path.join(process.cwd(), "artifacts"), { recursive: true });
        const image = await window.webContents.capturePage();
        fs.writeFileSync(path.join(process.cwd(), "artifacts", "preview.png"), image.toPNG());
        quitting = true; app.quit();
      }, 1800);
    }
  }).catch(e => { console.error("BREAKDOWN startup:", e.message); app.exit(1); });
}

ipcMain.handle("action", async (event, action: string, args: Record<string, string> = {}) => {
  if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame)
    throw new Error("Unknown UI sender");
  try {
    switch (action) {
      case "status": publish(); return {};
      case "peer-info": return preview ? {enabled:false} : await client.request("GetPeerSync");
      case "peer-enable":
        if (preview) throw new Error("설치된 앱에서 휴대폰 연결을 켜세요.");
        return await client.request("EnablePeerSync");
      case "peer-disable": return preview ? {enabled:false} : await client.request("DisablePeerSync");
      case "peer-copy": clipboard.writeText(args.text ?? ""); return {ok:true};
      case "close": if (!locked()) { if (managed) window.hide(); else { quitting = true; app.quit(); } } break;
      case "modal": modal = args.open === "true"; layout(); if (!modal && !preview) await client.request("ResetEmergency"); break;
      case "login":
        for (const popup of popups) popup.close();
        policy.beginAuth(); authPageLoaded = false; error = ""; publish();
        await chat.webContents.loadURL("https://chatgpt.com/auth/login"); authPageLoaded = true; break;
      case "cancel-login":
        policy.endAuth(); authPageLoaded = false; error = "";
        for (const popup of popups) popup.close();
        await chat.webContents.loadURL(safeChatUrl()); break;
      case "retry": await resetBrowser(); break;
      case "set-target-url": {
        const conversationId = conversationIdFromUrl(args.url ?? "");
        if (!conversationId) throw new Error("https://chatgpt.com/c/... 또는 프로젝트의 /c/... 대화 주소를 입력하세요.");
        await selectTarget(conversationId, true); break;
      }
      case "set-current-target": {
        const conversationId = conversationIdFromUrl(chat.webContents.getURL());
        if (!conversationId) throw new Error("현재 화면이 ChatGPT 대화가 아닙니다. 사용할 대화를 먼저 열어 주세요.");
        await selectTarget(conversationId, false); break;
      }
      case "open-target":
        if (!status.conversationId) throw new Error("먼저 사용할 ChatGPT 대화를 지정하세요.");
        policy.endAuth(); authPageLoaded = false; redirectedFrom = null;
        for (const popup of popups) popup.close();
        resetObservation(); error = ""; await resetBrowser(); break;
      case "password":
        if (preview) throw new Error("미리보기에서는 비밀번호를 저장하지 않습니다.");
        await requestStatus("SetPassword", { password: args.password, current: args.current }); break;
      case "arm":
        if (!managed) throw new Error("설치된 관리 서비스에서 시작한 앱만 잠금을 활성화할 수 있습니다.");
        await requestStatus("Arm");
        resetObservation();
        applyLock(); break;
      case "emergency": {
        if (preview) throw new Error("미리보기에서는 잠금이 없습니다.");
        const epoch = observationEpoch;
        const result = await client.request<{ correct: boolean; status: GateStatus }>("SubmitEmergencyPassword", { password: args.password });
        if (epoch === observationEpoch && !targetChanging) await updateStatus(result.status);
        return result;
      }
      default: throw new Error("Unknown action");
    }
    publish(); return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
});
