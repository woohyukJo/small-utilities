import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { readChatPage } from "./page-probe";
import { PageSnapshot } from "./protocol";
import { TurnTracker } from "./turn-tracker";
import { WindowPresentation } from "./window-presentation";
const fixtureConversationId = "11111111-2222-4333-8444-555555555555";
app.disableHardwareAcceleration();
app.setPath("userData", process.env.BREAKDOWN_DOM_FIXTURE || path.resolve(".dev", "dom-fixture"));
app.whenReady().then(async () => {
  const win = new BrowserWindow({show: false, webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false}});
  try {
    await win.loadURL("data:text/html," + encodeURIComponent('<div id="prompt-textarea" contenteditable="true">.</div><button data-testid="send-button">Send</button><main id="messages"></main>'));
    const probe = () => win.webContents.executeJavaScriptInIsolatedWorld(987, [{code:"(" + readChatPage.toString() + ")()"}]) as Promise<PageSnapshot>;
    const tracker = new TurnTracker();
    const first = await probe(); assert.ok(first.composer); tracker.accept(first);
    await win.webContents.executeJavaScript('document.querySelector("button").click(); document.getElementById("messages").innerHTML = \'<article data-turn-id="turn1"><div data-message-author-role="user" data-message-id="user1">.</div></article>\';');
    assert.equal(tracker.accept(await probe())[0].type, "submitted");
    await win.webContents.executeJavaScript('document.getElementById("messages").insertAdjacentHTML("beforeend",\'<article data-turn-id="turn2"><div data-message-author-role="assistant" data-message-id="assistant1">A response</div><button data-testid="copy-turn-action-button">Copy</button></article>\');');
    tracker.accept(await probe());
    const events = tracker.accept(await probe());
    assert.equal(events[0].type, "completed");
    assert.equal(JSON.stringify(await probe()).includes("A response"), false);
    assert.deepEqual(tracker.accept(await probe()), []);
    // Current outer-turn markup variant must work without a message-author-role descendant.
    await win.webContents.executeJavaScript('document.getElementById("messages").innerHTML = \'<article data-testid="conversation-turn-1" data-turn="user" data-turn-id="stable-user">.</article><article data-testid="conversation-turn-2" data-turn="assistant" data-turn-id="stable-answer"><p>Answer</p><button data-testid="copy-turn-action-button">Copy</button></article>\';');
    const modern = await probe();
    assert.equal(modern.messages[0].id,"stable-user");
    assert.equal(modern.messages[1].id,"stable-answer");
    assert.equal(modern.messages[1].complete,true);
    const missedInput = new TurnTracker();
    missedInput.accept(modern);
    // No key/click event: represent IME/voice/a new send control.
    await win.webContents.executeJavaScript('document.getElementById("messages").insertAdjacentHTML("beforeend", \'<article data-testid="conversation-turn-3" data-turn="user" data-turn-id="new-user">테스트</article><article data-testid="conversation-turn-4" data-turn="assistant" data-turn-id="new-answer"><p>완료</p><button aria-label="복사">copy icon</button></article>\');');
    const appended = await probe();
    assert.equal(appended.messages.at(-1)?.complete,true);
    assert.equal(missedInput.accept(appended)[0].type,"submitted");
    assert.equal(missedInput.accept(await probe())[0].type,"completed");
    // Exercise location.pathname in real Chromium with a project-qualified route.
    await win.webContents.session.protocol.handle("https", () => new Response('<div id="prompt-textarea" contenteditable="true"></div>', {headers:{"content-type":"text/html"}}));
    await win.loadURL("https://chatgpt.com/g/g-p-example-project/c/" + fixtureConversationId);
    assert.equal((await probe()).conversationId, fixtureConversationId);
    // Hidden-window integration: test real bounds/renderer state without
    // displaying another fullscreen experiment or changing the user's app.
    await win.webContents.executeJavaScript('document.body.innerHTML = \'<input id="draft"><div style="height:3000px">scroll fixture</div>\'; document.getElementById("draft").value="입력 중인 내용";');
    const originalBounds = win.getBounds();
    const presentation = new WindowPresentation({
      getBounds:()=>win.getBounds(),getNormalBounds:()=>win.getNormalBounds(),
      setBounds:b=>win.setBounds(b),isFullScreen:()=>win.isFullScreen(),
      setFullScreen:v=>win.setFullScreen(v),setClosable:v=>win.setClosable(v),
      setMinimizable:v=>win.setMinimizable(v),setResizable:v=>win.setResizable(v),
      setAlwaysOnTop:(v,level)=>win.setAlwaysOnTop(v,level),
      isVisible:()=>true,show:()=>{throw new Error("Hidden test must not show a window");}
    });
    const covered = {...originalBounds,width:1440,height:1000};
    presentation.applyLock(true,covered);
    await win.webContents.executeJavaScript('window.scrollTo(0,300)');
    const beforeUnlock = await win.webContents.executeJavaScript('({draft:document.getElementById("draft").value,scroll:window.scrollY})');
    assert.equal(presentation.escape(),false);
    presentation.applyLock(false,covered);
    assert.deepEqual(win.getBounds(),covered);
    assert.deepEqual(await win.webContents.executeJavaScript('({draft:document.getElementById("draft").value,scroll:window.scrollY})'),beforeUnlock);
    assert.equal(presentation.escape(),true);
    assert.deepEqual(win.getBounds(),originalBounds);
    assert.equal(await win.webContents.executeJavaScript('document.getElementById("draft").value'),"입력 중인 내용");
    fs.mkdirSync("artifacts", {recursive:true});
    fs.writeFileSync("artifacts/dom-smoke.txt", "PASS real Chromium isolated-world probe: submission, completion, deduplication, no text export\n");
    console.log("PASS Chromium DOM probe");
    app.exit(0);
  } catch(error) { console.error(error); app.exit(1); }
});
