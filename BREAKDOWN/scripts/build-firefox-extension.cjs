const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const modules = ['page-probe', 'turn-tracker'].map(name => {
  const source = path.join(root, 'src', name + '.ts');
  const compiled = path.join(root, 'dist', name + '.js');
  if (!fs.existsSync(compiled) || fs.statSync(compiled).mtimeMs < fs.statSync(source).mtimeMs) throw new Error('Build TypeScript first');
  const code = fs.readFileSync(compiled, 'utf8');
  if (/\brequire\s*\(/.test(code)) throw new Error('Browser module must be standalone');
  return `(() => { const exports = {}; ${code}\nreturn exports; })()`;
});
fs.writeFileSync(path.join(root, 'firefox-extension', 'detector.js'),
  '// Generated from desktop sources by scripts/build-firefox-extension.cjs.\n' +
  `globalThis.BreakdownDetector = Object.assign({}, ${modules.join(', ')});\n`);
console.log('Generated Firefox detector; no user settings included.');
