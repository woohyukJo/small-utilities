// Resume an existing unlisted submission. This command never uploads or creates a version.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts', 'firefox');

function readCredentials() {
  let credentials;
  try {
    credentials = JSON.parse(fs.readFileSync(path.join(root, '.dev', 'amo-signing.json'), 'utf8').replace(/^\uFEFF/, ''));
  } catch (_) { throw new Error('Local Mozilla signing input is missing or invalid JSON.'); }
  if (typeof credentials.apiKey !== 'string' || typeof credentials.apiSecret !== 'string' ||
      !credentials.apiKey.trim() || !credentials.apiSecret.trim()) throw new Error('Fill the local Mozilla signing input first.');
  return {key: credentials.apiKey.trim(), secret: credentials.apiSecret.trim()};
}

function authorization(credentials) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now()/1000);
  const body = encode({alg:'HS256',typ:'JWT'}) + '.' + encode({iss:credentials.key,jti:crypto.randomUUID(),iat:now-15,exp:now+120});
  return 'JWT ' + body + '.' + crypto.createHmac('sha256',credentials.secret).update(body).digest('base64url');
}

async function run() {
  const credentials = readCredentials();
  const manifest = JSON.parse(fs.readFileSync(path.join(root,'firefox-extension','manifest.json'),'utf8'));
  const id = manifest.browser_specific_settings.gecko.id;
  const url = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(id)}/versions/${encodeURIComponent(manifest.version)}/`;
  const response = await fetch(url, {headers:{Authorization:authorization(credentials)},signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error('Mozilla version status returned HTTP '+response.status);
  const version = await response.json();
  if (version.version !== manifest.version || version.channel !== 'unlisted') throw new Error('Unexpected Mozilla version or distribution channel.');
  fs.mkdirSync(output,{recursive:true});
  const record = {addonId:id,version:version.version,versionId:version.id,channel:version.channel,
    status:version.file?.status,checkedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(output,'submission-status.json'),JSON.stringify(record,null,2)+'\n');
  if (version.is_disabled || version.file?.status === 'disabled') throw new Error('Mozilla disabled this submission; inspect the developer page.');
  if (version.file?.status !== 'public') {
    console.log(JSON.stringify({...record,downloaded:false}));
    process.exitCode=2;
    return;
  }
  const fileUrl = new URL(version.file.url);
  if (fileUrl.protocol !== 'https:' || !['addons.mozilla.org','addons.cdn.mozilla.net'].includes(fileUrl.hostname))
    throw new Error('Unexpected signed-download destination.');
  const download = await fetch(fileUrl, {headers:{Authorization:authorization(credentials)},signal:AbortSignal.timeout(30000)});
  if (!download.ok) throw new Error('Signed extension download returned HTTP '+download.status);
  const bytes = Buffer.from(await download.arrayBuffer());
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (version.file.hash !== 'sha256:'+hash) throw new Error('Signed download does not match Mozilla file hash.');
  const toolPackage = [path.join(root,'tooling/firefox/node_modules/web-ext/package.json'),
    path.join(root,'.tools/browser-dev/node_modules/web-ext/package.json')].find(fs.existsSync);
  if (!toolPackage) throw new Error('Install the local Firefox tools to inspect the signed package.');
  const JSZip = createRequire(fs.realpathSync(toolPackage))('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const signedManifest = JSON.parse(await zip.file('manifest.json').async('string'));
  if (signedManifest.version !== manifest.version || signedManifest.browser_specific_settings.gecko.id !== id)
    throw new Error('Signed manifest differs from the requested extension.');
  if (!zip.file('META-INF/mozilla.rsa') && !zip.file('META-INF/cose.sig')) throw new Error('Signed package has no signature metadata.');
  const filename = `breakdown-firefox-${manifest.version}.xpi`;
  fs.writeFileSync(path.join(output,filename),bytes);
  fs.writeFileSync(path.join(output,'SIGNED_SHA256SUMS.txt'),hash+'  '+filename+'\n');
  console.log(JSON.stringify({...record,downloaded:true,file:filename,sha256:hash}));
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
