#!/usr/bin/env node
// Prints the per-configuration scaling-edge thresholds published in MANIFEST.md
// ("Progressive house edge"), computed from the pinned plinkoConfig.json.
//   node scripts/scaling-edge-table.mjs
// Max profit = stake × (highest multiplier in the bracket − 1); the $1.5m column is the first
// bracket whose max profit reaches $1.5m and the stake at which it does. Exits 1 if the config
// does not match the pin in src/loader.ts.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const bytes = fs.readFileSync(path.join(root, 'plinkoConfig.json'));
const pin = /PLINKO_CONFIG_HASH = '([0-9a-f]{64})'/.exec(fs.readFileSync(path.join(root, 'src/loader.ts'), 'utf8'))[1];
if (createHash('sha256').update(bytes).digest('hex') !== pin) { console.error('plinkoConfig.json does not match its pin'); process.exit(1); }

const cfg = JSON.parse(bytes).data;
const CLIP = 1_500_000;
const money = x => x >= 100 ? `$${Math.round(x).toLocaleString('en-US')}` : `$${x.toFixed(2)}`;
const pct = e => `${(Number(e) * 100).toFixed(2)}%`;

console.log('| Config | 0.1% up to | Max profit reaches $1.5m at | 2% tier |');
console.log('|---|---|---|---|');
for (let rows = 16; rows >= 8; rows--) {
  for (const risk of ['low', 'medium', 'high']) {
    const ladder = cfg.scaling_edge[String(rows)][risk];
    let clip = 'not reached';
    for (const b of ladder) {
      const top = Math.max(...b.multipliers.map(Number));
      if (Number(b.max_bet) * (top - 1) >= CLIP - 1) {   // first bracket whose max profit is $1.5m
        clip = `${money(Math.min(CLIP / (top - 1), Number(b.max_bet)))} (${pct(b.house_edge)})`;
        break;
      }
    }
    const last = ladder[ladder.length - 1];
    console.log(`| ${rows} ${risk} | ${money(Number(ladder[0].max_bet))} | ${clip} | ${money(Number(last.min_bet))} to ${money(Number(last.max_bet))} |`);
  }
}
