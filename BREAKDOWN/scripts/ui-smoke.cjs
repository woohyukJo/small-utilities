// Actual shell/preload in hidden Chromium, backed by a fake service (no account or lock).
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { emptyStatus } = require('../dist/protocol');
const { conversationIdFromUrl } = require('../dist/conversation');
const root = path.resolve(__dirname, '..');
app.disableHardwareAcceleration();
app.setPath('userData', process.env.BREAKDOWN_UI_FIXTURE || path.join(root, '.dev', 'ui-fixture'));
let state = { ...emptyStatus, connected: true, preview: false, error: '', authenticating: false };
let win;
let copiedPairing = '';
ipcMain.handle('action', (_event, name, args = {}) => {
  if (name === 'peer-info' || name === 'peer-disable') return {enabled:false};
  if (name === 'peer-enable') return {enabled:true,version:1,addresses:['192.168.1.2'],port:18431,fingerprint:'a'.repeat(64),token:'A'.repeat(43)};
  if (name === 'peer-copy') { copiedPairing = args.text; return {ok:true}; }
  if (name === 'peer-qr') return require('qrcode').toDataURL('breakdown://pair?data='+encodeURIComponent(args.text));
  if (name === 'set-target-url') {
    const id = conversationIdFromUrl(args.url);
    if (!id) return { ok: false, error: '올바른 대화 주소를 입력하세요.' };
    state = { ...state, conversationId: id, targetRevision: 'fixture-revision', ready: false };
  }
  win.webContents.send('state', state);
  return { ok: true };
});
app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 1360, height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(root, 'dist', 'preload.js') } });
  const run = code => win.webContents.executeJavaScript(code);
  const publish = () => run("new Promise(resolve => { const stop = window.breakdown.onState(() => { stop(); resolve(); }); window.breakdown.action('status'); })");
  try {
    await win.loadFile(path.join(root, 'ui', 'index.html'));
    await publish();
    assert.equal(await run("document.getElementById('arm').disabled"), true);
    const draft = 'https://chatgpt.com/c/draft-target';
    await run(`document.getElementById('target-url').value=${JSON.stringify(draft)}; document.getElementById('target-url').dispatchEvent(new Event('input')); document.getElementById('target-url').blur();`);
    await publish();
    assert.equal(await run("document.getElementById('target-url').value"), draft, 'poll does not erase an unfocused unsaved URL');
    await run("setTarget('set-target-url', {url:'https://example.com/c/wrong'})");
    assert.ok(await run("document.getElementById('target-error').textContent"));
    assert.equal(state.conversationId, null);
    await run(`setTarget('set-target-url', {url:${JSON.stringify(draft)}})`);
    await publish();
    assert.equal(state.conversationId, 'draft-target');
    assert.equal(await run("document.getElementById('target-error').textContent"), '');
    state = { ...state, ready: true, passwordSet: true };
    await publish();
    assert.equal(await run("document.getElementById('arm').disabled"), false);
    state = { ...state, armed: true, day: '2026-09-25', count: 2, ready: false };
    await publish();
    assert.equal(await run("document.getElementById('count').textContent"), '2');
    assert.equal(await run("document.getElementById('target-save').disabled"), false, 'locked user can recover an inaccessible conversation');
    state = { ...state, count: 3, unlocked: true, reason: 'conversation' };
    await publish();
    assert.equal(await run("document.getElementById('count').textContent"), '3');
    assert.equal(await run("document.getElementById('dialog').open"), false, 'unlock does not show a dialog');
    await run("loadPeer('peer-enable')");
    await run("new Promise((resolve,reject)=>{const img=document.getElementById('peer-qr');const timer=setTimeout(()=>reject(new Error('Pairing QR did not load')),3000);const done=()=>{clearTimeout(timer);resolve()};if(img.complete&&img.naturalWidth>0)done();else img.addEventListener('load',done,{once:true});})");
    assert.equal(await run("document.getElementById('peer-qr').naturalWidth > 0"), true);
    const pairing = JSON.parse(await run("document.getElementById('peer-code').value"));
    assert.equal(pairing.host,'192.168.1.2'); assert.equal(pairing.port,18431); assert.equal(pairing.version,1);
    await run("document.getElementById('peer-copy').onclick()");
    assert.equal(JSON.parse(copiedPairing).host,pairing.host);
    await run("loadPeer('peer-disable')");
    assert.equal(await run("document.getElementById('peer-code').value"), '');
    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'artifacts', 'ui-smoke.png'), (await win.webContents.capturePage()).toPNG());
    console.log('PASS hidden shell: drafts, selection, onboarding, quiet unlock and peer pairing controls');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
