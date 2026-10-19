#!/usr/bin/env node
/** Detect stale compiled code without requiring the development dependencies. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = message => {
  console.error(`[standalone] FAIL: ${message}`);
  console.error('After an intentional source edit, run npm ci --include=dev and npm run build.');
  process.exit(1);
};
function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const rel = dir + '/' + entry.name;
    return entry.isDirectory() ? walk(rel) : [rel];
  }).sort();
}
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'standalone-manifest.json'), 'utf8'));
  if (manifest.format !== 1 || !manifest.inputs || !manifest.outputs) fail('Invalid build manifest.');
  const sourcePaths = ['src', 'tests'].flatMap(walk).filter(p => p.endsWith('.ts')).sort();
  const expectedInputs = [...sourcePaths, 'tsconfig.json', '.mocharc.yml', 'package-lock.json',
    'scripts/build-standalone.mjs', 'scripts/check-standalone.mjs', 'scripts/standalone-runtime.cjs'].sort();
  if (JSON.stringify(Object.keys(manifest.inputs).sort()) !== JSON.stringify(expectedInputs)) {
    fail('Source inventory differs from the bundled build.');
  }
  if (JSON.stringify(manifest.unitEntries) !== JSON.stringify(sourcePaths.filter(p => p.endsWith('Tests.ts')))) {
    fail('Unit-test inventory differs from the bundled build.');
  }
  if (JSON.stringify(Object.keys(manifest.outputs).sort()) !== JSON.stringify(['test.js', 'verify.js'])) {
    fail('Bundled entry-point inventory is incomplete.');
  }
  for (const files of [manifest.inputs, manifest.outputs]) {
    for (const [name, expected] of Object.entries(files)) {
      const actual = createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
      if (actual !== expected) fail(`${name} differs from the bundled build.`);
    }
  }
  console.log('[standalone] Source inventory, unit-test inventory and both compiled entry points match the build manifest.');
} catch (error) {
  fail(error.message);
}
