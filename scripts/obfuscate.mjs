import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import JavaScriptObfuscator from 'javascript-obfuscator';

const DIST = 'dist';
const SKIP = new Set(['donation.js']);
const OPTIONS = {
  compact: true,
  simplify: true,
  stringArray: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 1,
  splitStrings: true,
  splitStringsChunkLength: 6,
  unicodeEscapeSequence: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.7,
  numbersToExpressions: true,
  transformObjectKeys: false,
  renameGlobals: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  sourceMap: false,
};

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : p;
  });
}

const files = walk(DIST).filter((p) => p.endsWith('.js') && !SKIP.has(p.split(/[\\/]/).pop()));
for (const p of files) {
  const rel = relative(DIST, p);
  if (SKIP.has(rel)) {
    console.log('skipped  (keep readable):', rel);
    continue;
  }
  const out = JavaScriptObfuscator.obfuscate(readFileSync(p, 'utf8'), OPTIONS).getObfuscatedCode();
  writeFileSync(p, out);
  console.log('obfuscated:', rel, `(${(out.length / 1024).toFixed(1)} KB)`);
}
console.log('done.');
