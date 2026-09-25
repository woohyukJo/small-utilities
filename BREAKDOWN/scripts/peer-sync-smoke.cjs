const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const assert = require('node:assert/strict');
const { GuardClient } = require('../dist/pipe');
const root = fs.realpathSync(path.resolve(__dirname, '..'));
const data = path.join(root, '.dev', 'peer-test-' + process.pid);
const pipe = 'BREAKDOWN-PeerTest-' + process.pid;
fs.mkdirSync(data, { recursive: true });
const child = spawn(path.join(root, 'artifacts/guard/Breakdown.Guard.exe'), ['--console','--pipe',pipe,'--data',data,'--peer-port','0'], {windowsHide:true,stdio:'pipe'});
child.stderr.on('data', value => process.stderr.write(value));
const client = new GuardClient(pipe);
function exchange(info, days, token = info.token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({version:1,completedDays:days});
    const request = https.request({host:'127.0.0.1',port:info.port,path:'/v1/sync',method:'POST',agent:false,
      ca:info.certificate,
      checkServerIdentity: (_host, certificate) => certificate.fingerprint256.replaceAll(':','').toLowerCase() === info.fingerprint ? undefined : new Error('Peer fingerprint differs'),
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    }, response => {
      let text = ''; response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({status:response.statusCode,body:JSON.parse(text)}));
    });
    request.setTimeout(6000, () => request.destroy(new Error('Sync timeout')));
    request.on('error', reject); request.end(body);
  });
}
(async () => {
  try {
    let ready = false;
    for (let i=0;i<40;i++) { try { await client.request('GetGateStatus'); ready=true; break; } catch { await new Promise(r=>setTimeout(r,150)); } }
    assert.ok(ready);
    assert.equal((await client.request('GetPeerSync')).enabled,false);
    const target = await client.request('SetConversationTarget',{conversationId:'sync-test-chat'});
    await client.request('SetPassword',{password:'sync-test-password'});
    await client.request('MarkReady',{conversationId:target.conversationId,targetRevision:target.targetRevision});
    const armed = await client.request('Arm');
    const info = await client.request('EnablePeerSync');
    assert.equal(info.enabled,true); assert.match(info.fingerprint,/^[a-f0-9]{64}$/);
    assert.equal((await exchange(info,[armed.day],'invalid')).status,401);
    assert.equal((await client.request('GetGateStatus')).unlocked,false);
    const result = await exchange(info,[armed.day]);
    assert.equal(result.status,200); assert.ok(result.body.completedDays.includes(armed.day));
    const unlocked = await client.request('GetGateStatus');
    assert.equal(unlocked.unlocked,true); assert.equal(unlocked.reason,'sync'); assert.equal(unlocked.count,3);
    assert.deepEqual((await exchange(info,[armed.day])).body,result.body);
    assert.ok((await exchange(info,[])).body.completedDays.includes(armed.day));
    await assert.rejects(exchange({...info,fingerprint:'0'.repeat(64)},[]));
    await client.request('DisablePeerSync');
    assert.equal((await client.request('GetPeerSync')).enabled,false);
    console.log('PASS local TLS peer exchange: pin, token rejection, completed-day import/export, duplicate delivery and disable');
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child,'exit'); }
    if (fs.realpathSync(data) !== data || !data.startsWith(path.join(root,'.dev')+path.sep)) throw new Error('Unexpected fixture path');
    for(const entry of fs.readdirSync(data,{withFileTypes:true})) {
      if(!entry.isFile() || !/^(gate\.db(?:-wal|-shm)?|peer-sync\.pfx)$/.test(entry.name)) throw new Error('Unexpected fixture file');
      fs.unlinkSync(path.join(data,entry.name));
    }
    fs.rmdirSync(data);
  }
})().catch(error=>{ console.error(error.message); process.exitCode=1; });
