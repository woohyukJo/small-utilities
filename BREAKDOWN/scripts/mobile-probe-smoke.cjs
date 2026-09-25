const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
app.disableHardwareAcceleration();
app.setPath('userData',process.env.BREAKDOWN_MOBILE_FIXTURE || path.join(root,'.dev','mobile-observer-fixture'));
app.whenReady().then(async()=>{
  const win = new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  try {
    await win.webContents.session.protocol.handle('https',()=>new Response('<div id="prompt-textarea" contenteditable="true">.</div><button data-testid="send-button">Send</button><main id="messages"></main>',{headers:{'content-type':'text/html'}}));
    await win.loadURL('https://chatgpt.com/c/mobile-test-chat');
    const script = fs.readFileSync(path.join(root,'android/app/src/main/assets/chat-probe.js'),'utf8');
    const config = {conversationId:'mobile-test-chat',scope:'day1:1',pendingUserIds:[],abortedUserIds:[],ackObserver:'',ackSequence:0};
    const inspect = async()=>JSON.parse(await win.webContents.executeJavaScript(script.replace('/*BREAKDOWN_CONTEXT*/',JSON.stringify(config))));
    assert.deepEqual((await inspect()).events,[]);
    await win.webContents.executeJavaScript('document.querySelector("button").click();document.getElementById("messages").innerHTML=\'<article data-turn-id="u1"><div data-message-author-role="user">.</div></article>\';');
    const first = await inspect();
    assert.equal(first.events[0].type,'submitted');
    // Native callback was dropped by onPause/navigation: unacknowledged events must be redelivered.
    assert.deepEqual((await inspect()).events,first.events);
    await win.webContents.executeJavaScript('document.getElementById("messages").insertAdjacentHTML("beforeend",\'<article data-turn-id="a1"><div data-message-author-role="assistant">fixture answer</div><button data-testid="copy-turn-action-button">Copy</button></article>\');');
    await inspect(); const completed = await inspect();
    assert.deepEqual(completed.events.map(e=>e.type),['submitted','completed']);
    assert.equal(JSON.stringify(completed).includes('fixture answer'),false);
    config.ackObserver=completed.observerId; config.ackSequence=completed.sequence;
    assert.deepEqual((await inspect()).events,[]);
    config.scope='day2:1';
    const reset=await inspect(); assert.notEqual(reset.observerId,completed.observerId); assert.deepEqual(reset.events,[]);
    await win.webContents.executeJavaScript('document.querySelector("button").click();document.getElementById("messages").insertAdjacentHTML("beforeend",\'<article data-turn-id="u2"><div data-message-author-role="user">.</div></article>\');');
    const fresh=await inspect();
    assert.equal(fresh.events[0].userId,'u2','old observer acknowledgement cannot discard new events');
    console.log('PASS mobile observation bridge: dropped callback redelivery, acknowledgement, scope reset and no text export');
    app.exit(0);
  } catch(error) { console.error(error);app.exit(1); }
});
