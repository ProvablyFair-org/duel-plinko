#!/usr/bin/env node
/**
 * Is the live ProvablyFair.org verifier still the code this package vendored and proved?
 *
 *   node scripts/check-live-site-verifier.mjs --live         GET https://www.provablyfair.org/verify-bets and
 *                                                       every pinned chunk from the live site
 *   node scripts/check-live-site-verifier.mjs <dir>          compare a local directory of downloaded chunks
 *
 * Step 5 proves the VENDORED bundle (verifier-parity/live-site/chunks/) prints the port's layout on
 * every captured round; this script proves the LIVE site still serves those exact bytes. For each
 * pinned chunk in src/live-site-verifier.ts LIVE_SITE_PINS (read from that file, so the pins have one
 * home) it requires (1) --live only: the page HTML still references /_next/static/chunks/<name>, and
 * (2) the bytes' SHA-256 equals the pin. Exit 0 only if every pinned chunk passes both; exit 1 on any
 * difference, an unreachable URL, or no argument. GET requests only; nothing is written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv[2];
if (!arg) {
  console.error('usage: node scripts/check-live-site-verifier.mjs --live | <dir-of-downloaded-chunks>');
  process.exit(1);
}

const pinSrc = fs.readFileSync(path.join(root, 'src/live-site-verifier.ts'), 'utf8');
const block = pinSrc.match(/LIVE_SITE_PINS[^{]*\{([\s\S]*?)\}\)/);
if (!block) { console.error('FAIL: LIVE_SITE_PINS not found in src/live-site-verifier.ts'); process.exit(1); }
const chunkPins = Object.fromEntries([...block[1].matchAll(/'chunks\/([^']+)':\s*'([0-9a-f]{64})'/g)].map(m => [m[1], m[2]]));
const page = (pinSrc.match(/page:\s*'([^']+)'/) || [])[1];
const chunkBase = (pinSrc.match(/chunkBase:\s*'([^']+)'/) || [])[1];
if (Object.keys(chunkPins).length === 0 || !page || !chunkBase) { console.error('FAIL: pins or provenance URLs not found'); process.exit(1); }

const sha = b => createHash('sha256').update(b).digest('hex');
let failures = 0;
const report = (name, actual, note = '') => {
  const pinned = chunkPins[name];
  const ok = actual === pinned;
  if (!ok) failures++;
  console.log(`  ${ok ? 'MATCH' : 'FAIL '} ${name}${note}\n        site   ${actual ?? '(unavailable)'}\n        pinned ${pinned}`);
};

if (arg === '--live') {
  console.log(`\n  Live-site verifier check — GET ${page}`);
  let html;
  try {
    const res = await fetch(page, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) { console.log(`  FAIL  page unreachable: ${e.message}`); process.exit(1); }
  console.log(`        page sha256 ${sha(Buffer.from(html, 'utf8'))} (informational: the HTML changes with every deploy)`);
  for (const name of Object.keys(chunkPins)) {
    if (!html.includes(`/_next/static/chunks/${name}`)) {
      console.log(`  FAIL  ${name}: the live page no longer loads this chunk — the verifier was redeployed; re-vendor`);
      failures++;
      continue;
    }
    let buf = null;
    try {
      const res = await fetch(chunkBase + name, { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) { console.log(`  FAIL  ${name}: ${e.message}`); failures++; continue; }
    report(name, sha(buf), ' (referenced by the page)');
  }
} else {
  const dir = path.resolve(arg);
  console.log(`\n  Live-site verifier check — local directory ${dir}`);
  for (const name of Object.keys(chunkPins)) {
    const p = path.join(dir, name);
    report(name, fs.existsSync(p) ? sha(fs.readFileSync(p)) : null);
  }
}
console.log(failures === 0
  ? '  RESULT: the live site verifier == the vendored bundle (every pinned hash matches)\n'
  : `  RESULT: ${failures} difference(s) — the live site is NOT the code Step 5 proved; re-vendor and re-run the suite\n`);
process.exit(failures === 0 ? 0 : 1);
