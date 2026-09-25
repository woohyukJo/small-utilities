// Real Android TLS client against an isolated PC fixture. Does not touch the user's gate/profile.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const { GuardClient } = require('../dist/pipe');
const [adb, serial, host, portText] = process.argv.slice(2);
if (!adb || !/^[A-Za-z0-9]+$/.test(serial || '') || !/^192\.168\.[0-9]+\.[0-9]+$|^10\.[0-9]+\.[0-9]+\.[0-9]+$|^172\.(1[6-9]|2[0-9]|3[01])\.[0-9]+\.[0-9]+$/.test(host || '')) throw new Error('Provide adb path, serial, private host and port');
const port = Number(portText);
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
const root = fs.realpathSync(path.resolve(__dirname,'..'));
const data = path.join(root,'.dev','device-peer-'+process.pid);
const pipe = 'BREAKDOWN-DevicePeer-'+process.pid;
const packageName = 'local.breakdown.syncprobe';
const adbPrefix = ['-P','5038','-s',serial];
function adbRun(args) {
  const result = spawnSync(adb,[...adbPrefix,...args],{windowsHide:true,encoding:'utf8',timeout:60000});
  if(result.error || result.status !== 0) throw new Error('ADB test step failed: '+args[0]);
  return result.stdout;
}
const existing = spawnSync(adb,[...adbPrefix,'shell','pm','path',packageName],{windowsHide:true,encoding:'utf8',timeout:10000});
if(existing.error || existing.stdout.trim()) throw new Error('Probe package already exists or device is unavailable; preserve it and inspect first');
fs.mkdirSync(data,{recursive:true});
const child = spawn(path.join(root,'artifacts/guard/Breakdown.Guard.exe'),['--console','--pipe',pipe,'--data',data,'--peer-port',String(port)],{windowsHide:true,stdio:'pipe'});
child.stderr.on('data',chunk=>process.stderr.write(chunk));
let installed = false;
const client = new GuardClient(pipe);
const quote = value => "'"+value.replaceAll("'","'\\''")+"'";
(async()=>{
  try {
    let ready=false;
    for(let i=0;i<40;i++) { try { await client.request('GetGateStatus');ready=true;break; } catch { await new Promise(r=>setTimeout(r,150)); } }
    assert.ok(ready);
    const target=await client.request('SetConversationTarget',{conversationId:'synthetic-device-test'});
    await client.request('SetPassword',{password:'fixture-password'});
    await client.request('MarkReady',{conversationId:target.conversationId,targetRevision:target.targetRevision});
    const status=await client.request('Arm');
    const info=await client.request('EnablePeerSync');
    assert.equal(info.port,port);
    const pairing=JSON.stringify({version:1,host,port,fingerprint:info.fingerprint,token:info.token});
    adbRun(['install','-r',path.join(root,'artifacts/android/BREAKDOWN-sync-probe.apk')]); installed=true;
    const output=adbRun(['shell','am','instrument','-w','-r','-e','pairing',quote(pairing),'-e','completedDay',quote(status.day),packageName+'/local.breakdown.syncprobe.PeerProbe']);
    const report=output.split(/\r?\n/).filter(line=>/^INSTRUMENTATION_RESULT: (stream|success)|^INSTRUMENTATION_CODE:/.test(line));
    console.log(report.join('\n'));
    assert.ok(output.includes('success=true') && output.includes('PASS sync-probe'),'Android TLS probe did not pass');
    const completed=await client.request('GetGateStatus');
    assert.equal(completed.reason,'sync'); assert.equal(completed.unlocked,true);
    console.log('PASS real-device Wi-Fi TLS exchange; user app, login and gate were not changed');
  } finally {
    let uninstallError;
    try { if(installed) adbRun(['uninstall',packageName]); } catch(error) { uninstallError=error; }
    if(child.exitCode===null && child.signalCode===null) { child.kill(); await once(child,'exit'); }
    if(fs.realpathSync(data)!==data || !data.startsWith(path.join(root,'.dev')+path.sep)) throw new Error('Unexpected test data path');
    for(const entry of fs.readdirSync(data,{withFileTypes:true})) {
      if(!entry.isFile() || !/^(gate\.db(?:-wal|-shm)?|peer-sync\.pfx)$/.test(entry.name)) throw new Error('Unexpected test file');
      fs.unlinkSync(path.join(data,entry.name));
    }
    fs.rmdirSync(data);
    if(uninstallError) throw uninstallError;
  }
})().catch(error=>{ console.error(error.message);process.exitCode=1; });
