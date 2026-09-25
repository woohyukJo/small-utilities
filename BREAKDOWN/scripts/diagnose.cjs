// Read-only: no passwords, conversation bodies or authentication material.
const { execFileSync } = require('node:child_process');
const { GuardClient } = require('../dist/pipe');
const path = require('node:path');
const identity = execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows','System32','whoami.exe'),
  ['/user','/fo','csv','/nh'], {encoding:'utf8',windowsHide:true});
const sid = /S-1-5-[0-9-]+/.exec(identity)?.[0];
if (!sid) throw new Error('Cannot determine the current Windows user.');
const client = new GuardClient('BREAKDOWN-' + sid);
Promise.all([client.request('GetGateStatus'),client.request('GetDetectionStatus'),client.request('GetUiHealth')])
  .then(([gate,detection,health])=>console.log(JSON.stringify({gate,detection,health},null,2)))
  .catch(error=>{console.error(error.message);process.exitCode=1;});
