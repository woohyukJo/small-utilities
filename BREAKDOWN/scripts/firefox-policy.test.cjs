const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const context = vm.createContext({URL});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../firefox-extension/policy.js'),'utf8'),context);
const Policy = context.BreakdownNavigation;
test('Firefox pins full and project conversations only while the gate is locked',()=>{
  const p = new Policy();
  assert.equal(p.shouldRestore('https://chatgpt.com/c/target','target',true,1),false);
  assert.equal(p.shouldRestore('https://chatgpt.com/g/project/c/target','target',true,1),false);
  for(const url of ['https://chatgpt.com/c/other','https://chatgpt.com/','https://example.com/','about:home'])
    assert.equal(p.shouldRestore(url,'target',true,1),true);
  assert.equal(p.shouldRestore('https://example.com/','target',false,1),false);
});
test('Firefox lets passkey/SSO redirects finish and then restores normal conversation pinning',()=>{
  const p = new Policy();
  assert.equal(p.shouldRestore('https://accounts.google.com/signin','target',true,1),false);
  assert.equal(p.shouldRestore('https://any-company.example/sso-return','target',true,1),false);
  assert.equal(p.shouldRestore('about:blank','target',true,1),false);
  assert.equal(p.shouldRestore('https://other.example/','target',true,2),true);
  p.signInComplete(1);
  assert.equal(p.shouldRestore('https://chatgpt.com/c/target','target',true,1),false);
  assert.equal(p.shouldRestore('https://other.example/','target',true,1),true);
});
test('unlock clears the authentication exception and leaves the conversation untouched',()=>{
  const p = new Policy();
  p.shouldRestore('https://chatgpt.com/auth/login','target',true,1);
  assert.equal(p.shouldRestore('https://chatgpt.com/c/target','target',false,1),false);
  assert.equal(p.shouldRestore('https://other.example/','target',true,1),true);
});
