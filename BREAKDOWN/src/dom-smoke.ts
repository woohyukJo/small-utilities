import { app, BrowserWindow, WebContentsView } from "electron";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { readChatPage } from "./page-probe";
import { PageSnapshot } from "./protocol";
import { TurnTracker } from "./turn-tracker";
import { WindowPresentation } from "./window-presentation";
import { selectConversationTarget } from "./target-selection";
const fixtureConversationId = "11111111-2222-4333-8444-555555555555";
app.disableHardwareAcceleration();
app.setPath("userData", process.env.BREAKDOWN_DOM_FIXTURE || path.resolve(".dev", "dom-fixture"));
app.whenReady().then(async () => {
  const win = new BrowserWindow({show: false, webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false}});
  const chat = new WebContentsView({webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false}});
  win.contentView.addChildView(chat); chat.setBounds({x:0,y:0,width:800,height:600});
  try {
    await chat.webContents.loadURL("data:text/html," + encodeURIComponent('<div id="prompt-textarea" contenteditable="true">.</div><button data-testid="send-button">Send</button><main id="messages"></main>'));
    const probe = () => chat.webContents.executeJavaScriptInIsolatedWorld(987, [{code:"(" + readChatPage.toString() + ")()"}]) as Promise<PageSnapshot>;
    const tracker = new TurnTracker();
    const first = await probe(); assert.ok(first.composer); tracker.accept(first);
    await chat.webContents.executeJavaScript('document.body.insertAdjacentHTML("afterbegin",\'<textarea name="prompt-textarea" style="display:none"></textarea>\');');
    assert.equal((await probe()).composer, true, "hidden mobile textarea must not mask the visible editor");
    await chat.webContents.executeJavaScript('document.querySelector("button").click(); document.getElementById("messages").innerHTML = \'<article data-turn-id="turn1"><div data-message-author-role="user" data-message-id="user1">.</div></article>\';');
    assert.equal(tracker.accept(await probe())[0].type, "submitted");
    await chat.webContents.executeJavaScript('document.getElementById("messages").insertAdjacentHTML("beforeend",\'<article data-turn-id="turn2"><div data-message-author-role="assistant" data-message-id="assistant1">A response</div><button data-testid="copy-turn-action-button">Copy</button></article>\');');
    tracker.accept(await probe());
    const events = tracker.accept(await probe());
    assert.equal(events[0].type, "completed");
    assert.equal(JSON.stringify(await probe()).includes("A response"), false);
    assert.deepEqual(tracker.accept(await probe()), []);
    const browserTracker = new TurnTracker([], [], false);
    browserTracker.accept(await probe());
    await chat.webContents.executeJavaScript('document.getElementById("messages").insertAdjacentHTML("beforeend",\'<article data-turn="user" data-turn-id="hydrated-user">history</article><article data-turn="assistant" data-turn-id="hydrated-answer"><button data-testid="copy-turn-action-button">Copy</button></article>\');');
    assert.deepEqual(browserTracker.accept(await probe()), [], "late history hydration is not a browser submission");
    await chat.webContents.executeJavaScript('document.querySelector("#prompt-textarea").textContent=".";document.querySelector("button").click();document.getElementById("messages").insertAdjacentHTML("beforeend",\'<article data-turn="user" data-turn-id="browser-user">.</article><article data-turn="assistant" data-turn-id="browser-answer"><button data-testid="copy-turn-action-button">Copy</button></article>\');');
    assert.equal(browserTracker.accept(await probe())[0].type, "submitted");
    assert.equal(browserTracker.accept(await probe())[0].type, "completed");
    // Current outer-turn markup variant must work without a message-author-role descendant.
    await chat.webContents.executeJavaScript('document.getElementById("messages").innerHTML = \'<article data-testid="conversation-turn-1" data-turn="user" data-turn-id="stable-user">.</article><article data-testid="conversation-turn-2" data-turn="assistant" data-turn-id="stable-answer"><p>Answer</p><button data-testid="copy-turn-action-button">Copy</button></article>\';');
    const modern = await probe();
    assert.equal(modern.messages[0].id,"stable-user");
    assert.equal(modern.messages[1].id,"stable-answer");
    assert.equal(modern.messages[1].complete,true);
    await chat.webContents.executeJavaScript('document.getElementById("messages").innerHTML = \'<section data-turn="user" data-turn-id="section-user">.</section><section data-turn="assistant" data-turn-id="section-answer"><p>Answer</p><button data-testid="copy-turn-action-button">Copy</button></section>\';');
    const sectionTurns = await probe();
    assert.deepEqual(sectionTurns.messages.map(message => message.id), ["section-user", "section-answer"]);
    assert.equal(sectionTurns.messages[1].complete, true);
    await chat.webContents.executeJavaScript('document.getElementById("messages").innerHTML = \'<article data-testid="conversation-turn-1" data-turn="user" data-turn-id="stable-user">.</article><article data-testid="conversation-turn-2" data-turn="assistant" data-turn-id="stable-answer"><p>Answer</p><button data-testid="copy-turn-action-button">Copy</button></article>\';');
    const missedInput = new TurnTracker();
    missedInput.accept(modern);
    // No key/click event: represent IME/voice/a new send control.
    await chat.webContents.executeJavaScript('document.getElementById("messages").insertAdjacentHTML("beforeend", \'<article data-testid="conversation-turn-3" data-turn="user" data-turn-id="new-user">테스트</article><article data-testid="conversation-turn-4" data-turn="assistant" data-turn-id="new-answer"><p>완료</p><button aria-label="복사">copy icon</button></article>\');');
    const appended = await probe();
    assert.equal(appended.messages.at(-1)?.complete,true);
    assert.equal(missedInput.accept(appended)[0].type,"submitted");
    assert.equal(missedInput.accept(await probe())[0].type,"completed");
    // Current ChatGPT can group a user turn and its assistant response under one
    // stable turn key, without the legacy conversation-turn/message-author nodes.
    await chat.webContents.executeJavaScript(`document.body.innerHTML = ${JSON.stringify(
      '<form data-chatgpt-composer><div data-testid="prompt-textarea" data-lexical-editor="true" contenteditable="true" role="textbox">.</div>' +
      '<button id="composer-submit-button" type="button">Send</button></form>' +
      '<main><section data-turn-key="grouped-turn-1">' +
      '<div data-user-message-bubble="true">.</div>' +
      '<div data-conversation-role="assistant"><p>Answer</p></div>' +
      '<div class="turn-action-controls"><button aria-label="Copy">Copy</button></div>' +
      '</section></main>'
    )}`);
    const grouped = await probe();
    assert.equal(grouped.composer, true, "data-testid/Lexical composer is detected");
    assert.deepEqual(grouped.messages, [
      {id:"u_grouped-turn-1",role:"user",complete:false,error:false},
      {id:"a_grouped-turn-1",role:"assistant",complete:true,error:false}
    ], "grouped current-renderer turns retain stable role-specific identities");
    const groupedTracker = new TurnTracker();
    assert.deepEqual(groupedTracker.accept(grouped), [], "grouped history is excluded");
    await chat.webContents.executeJavaScript('document.getElementById("composer-submit-button").click(); document.querySelector("main").insertAdjacentHTML("beforeend", \'<section data-turn-key="grouped-turn-2"><div data-user-message-bubble="true">.</div><div data-conversation-role="assistant"><p>Done</p></div><div class="turn-action-controls"><button>Copy</button></div></section>\');');
    const groupedAppended = await probe();
    assert.equal(groupedAppended.submitSerial, grouped.submitSerial + 1);
    assert.deepEqual(groupedTracker.accept(groupedAppended), [{type:"submitted",userId:"u_grouped-turn-2"}]);
    assert.deepEqual(groupedTracker.accept(await probe()), [{type:"completed",userId:"u_grouped-turn-2",assistantId:"a_grouped-turn-2"}]);
    // Exercise location.pathname in real Chromium with a project-qualified route.
    await chat.webContents.session.protocol.handle("https", () => new Response('<div id="prompt-textarea" contenteditable="true"></div>', {headers:{"content-type":"text/html"}}));
    await chat.webContents.loadURL("https://chatgpt.com/g/g-p-example-project/c/" + fixtureConversationId);
    assert.equal((await probe()).conversationId, fixtureConversationId);
    await chat.webContents.loadURL("https://chatgpt.com/c/wrong-target");
    const repairedSelection = await selectConversationTarget({
      currentConversationId: fixtureConversationId,
      persist: async () => { throw new Error("same target must not be rewritten"); },
      applyStatus: async () => { throw new Error("same target has no new status"); },
      currentUrl: () => chat.webContents.getURL(),
      loadUrl: url => chat.webContents.loadURL(url).then(() => undefined)
    }, fixtureConversationId, true);
    assert.deepEqual(repairedSelection, {persisted:false,navigated:true});
    assert.equal(chat.webContents.getURL(), "https://chatgpt.com/c/" + fixtureConversationId);
    // Hidden-window integration: test real bounds/renderer state without
    // displaying another fullscreen experiment or changing the user's app.
    await chat.webContents.executeJavaScript('document.body.innerHTML = \'<input id="draft"><div style="height:3000px">scroll fixture</div>\'; document.getElementById("draft").value="입력 중인 내용";');
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
    await chat.webContents.executeJavaScript('window.scrollTo(0,300)');
    const beforeUnlock = await chat.webContents.executeJavaScript('({draft:document.getElementById("draft").value,scroll:window.scrollY})');
    assert.equal(presentation.escape(),false);
    presentation.applyLock(false,covered);
    assert.deepEqual(win.getBounds(),covered);
    assert.deepEqual(await chat.webContents.executeJavaScript('({draft:document.getElementById("draft").value,scroll:window.scrollY})'),beforeUnlock);
    assert.equal(presentation.escape(),true);
    assert.deepEqual(win.getBounds(),originalBounds);
    assert.equal(await chat.webContents.executeJavaScript('document.getElementById("draft").value'),"입력 중인 내용");
    fs.mkdirSync("artifacts", {recursive:true});
    fs.writeFileSync("artifacts/dom-smoke.txt", "PASS real Chromium WebContentsView isolated-world probe: grouped/legacy submission, completion, deduplication, no text export\n");
    console.log("PASS Chromium WebContentsView DOM probe");
    app.exit(0);
  } catch(error) { console.error(error); app.exit(1); }
});
