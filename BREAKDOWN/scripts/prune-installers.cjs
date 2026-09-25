const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

async function main() {
  const root = fs.realpathSync(path.resolve(__dirname, '..'));
  const expected = path.join(root, 'release');
  const output = fs.realpathSync(expected);
  if (output !== expected) throw new Error('Refusing to clean a redirected release directory.');
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Unsupported release version.');
  const currentName = 'BREAKDOWN Setup ' + version + '.exe';
  const current = path.join(output, currentName);
  const info = fs.lstatSync(current);
  if (!info.isFile() || info.size === 0) throw new Error('Current installer is missing; keeping older installers.');

  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(current)) hash.update(chunk);
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), hash.digest('hex') + '  ' + currentName + '\n');

  const latest = version.split('.').map(Number);
  const older = candidate => {
    const parts = candidate.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (parts[i] !== latest[i]) return parts[i] < latest[i];
    }
    return false;
  };
  for (const entry of fs.readdirSync(output, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === 'builder-debug.yml') {
      fs.unlinkSync(path.join(output,entry.name));
      continue;
    }
    const match = /^BREAKDOWN Setup (\d+\.\d+\.\d+)\.exe(?:\.blockmap)?$/.exec(entry.name);
    if (!entry.isFile() || !match || !older(match[1])) continue;
    fs.unlinkSync(path.join(output, entry.name));
    console.log('Removed old installer artifact:', entry.name);
  }
  console.log('Current installer:', currentName);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
