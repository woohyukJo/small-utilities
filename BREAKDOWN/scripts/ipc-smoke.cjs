const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { GuardClient } = require('../dist/pipe');
const targetA = '11111111-2222-4333-8444-555555555555';
const targetB = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const pipe = 'BREAKDOWN-Test-' + process.pid;
const root = fs.realpathSync(path.resolve(__dirname, '..'));
const data = path.join(root, '.dev', 'ipc-' + process.pid);
fs.mkdirSync(data, { recursive: true });
const child = spawn(path.resolve('artifacts/guard/Breakdown.Guard.exe'), ['--console','--pipe',pipe,'--data',data], { windowsHide: true, stdio: 'pipe' });
child.stderr.on('data', chunk => process.stderr.write(chunk));
const client = new GuardClient(pipe);
(async () => {
  try {
    let ready = false;
    for (let i=0; i<30; i++) {
      try { await client.request('GetGateStatus'); ready = true; break; } catch { await new Promise(r=>setTimeout(r,200)); }
    }
    assert.ok(ready, 'console service started');
    assert.equal((await client.request('GetGateStatus')).conversationId, null);
    await assert.rejects(client.request('MarkReady'));
    const selectedA = await client.request('SetConversationTarget',{conversationId:targetA});
    assert.equal(selectedA.conversationId,targetA);
    const contextA = {conversationId:targetA, targetRevision:selectedA.targetRevision};
    await client.request('SetPassword', {password:'local-test'});
    await assert.rejects(client.request('MarkReady',{conversationId:targetA}));
    await client.request('MarkReady',contextA);
    await client.request('Arm');
    await assert.rejects(client.request('RequestUiExit'));
    await assert.rejects(client.request('ObserveUserTurn',{conversationId:'another-conversation',userId:'wrong-user'}));
    let turn = {...contextA,userId:'u1',assistantId:'a1'};
    await client.request('ObserveUserTurn',turn);
    await Promise.all([client.request('RecordCompletedTurn',turn),client.request('RecordCompletedTurn',turn)]);
    await client.request('ObserveUserTurn',{...contextA,userId:'old-pending'});
    const changed = await client.request('SetConversationTarget',{conversationId:targetB});
    assert.equal(changed.conversationId,targetB); assert.equal(changed.count,1); assert.equal(changed.unlocked,false);
    await assert.rejects(client.request('RecordCompletedTurn',{...contextA,userId:'old-pending',assistantId:'late-answer'}));
    const returnedA = await client.request('SetConversationTarget',{conversationId:targetA});
    assert.notEqual(returnedA.targetRevision,contextA.targetRevision);
    await assert.rejects(client.request('ObserveUserTurn',{...contextA,userId:'old-pending'}));
    await assert.rejects(client.request('RecordCompletedTurn',{...contextA,userId:'old-pending',assistantId:'late-answer'}));
    await assert.rejects(client.request('MarkReady',contextA));
    assert.equal((await client.request('GetGateStatus')).count,1);
    const selectedB = await client.request('SetConversationTarget',{conversationId:targetB});
    const contextB = {conversationId:targetB,targetRevision:selectedB.targetRevision};
    assert.equal((await client.request('SetConversationTarget',{conversationId:targetB})).targetRevision,contextB.targetRevision);
    for (let i=2;i<=3;i++) {
      turn = {...contextB,userId:'u'+i,assistantId:'a'+i};
      await client.request('ObserveUserTurn',turn);
      await Promise.all([client.request('RecordCompletedTurn',turn),client.request('RecordCompletedTurn',turn)]);
    }
    const status = await client.request('GetGateStatus');
    assert.equal(status.count,3); assert.equal(status.unlocked,true);
    await client.request('RequestUiExit');
    assert.equal((await client.request('GetGateStatus')).uiDismissed,true);
    await client.request('ShowUi');
    assert.equal((await client.request('GetGateStatus')).uiDismissed,false);
    await client.request('ReportUiHealth',{handle:123,responsive:false});
    assert.equal((await client.request('GetUiHealth')).responsive,false);
    await client.request('ReportDetectionStatus',{phase:'observing',users:4,assistants:4,completedResponses:4,
      submitSignals:0,generating:false,composer:true});
    const detection = await client.request('GetDetectionStatus');
    assert.equal(detection.users,4); assert.equal(detection.submitSignals,0);
    await assert.rejects(client.request('not-a-command'));
    console.log('PASS Named Pipe round trip, concurrent duplicate completion, persisted unlock, health report and unknown-method rejection');
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child,'exit'); }
    if (fs.realpathSync(data) !== data) throw new Error('Refusing redirected test data cleanup.');
    // This test creates only flat SQLite files; never follow links or remove arbitrary subtrees.
    for (const entry of fs.readdirSync(data,{withFileTypes:true})) {
      if (!entry.isFile() || !/^gate\.db(?:-wal|-shm)?$/.test(entry.name)) throw new Error('Unexpected test data entry.');
      fs.unlinkSync(path.join(data,entry.name));
    }
    fs.rmdirSync(data);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
