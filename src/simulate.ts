/**
 * Monte Carlo simulation for Plinko v3 — two-pass.
 *
 * Pass 1 — fresh random seeds (1M rounds per config):
 *   Exercises src/rng.ts (ported from Duel's published Verify-tab code) and the
 *   multiplier table without casino data. The seeds were generated once with
 *   crypto.randomBytes() and are pinned in src/sim-seeds.ts (SIM_SEEDS).
 *
 * Pass 2 — casino seeds (10,000 nonces per seed):
 *   Validates the casino's seed selection. Two tests per seed × row config:
 *     Test A: chi-squared on full nonce range 0–9,999 vs binomial.
 *             Catches globally biased seeds.
 *     Test B: chi-squared on early nonces (0–49) and late nonces (50–9,999)
 *             separately vs binomial. Flags seeds whose early-epoch distribution
 *             deviates from binomial while the late range does not — the
 *             statistical signature of cherry-picked seeds.
 *
 * Both passes write to a single outputs/simulation-results.json.
 * Usage: npm run simulate
 */

import fs from 'fs';
import path from 'path';
import { PlinkoConfig } from './config';
import { computeSlotFromBuffer } from './rng';
import { chiSquaredTest, binomProb } from './stats';
import { loadDataset, revealedSeeds } from './loader';
// The pinned experiment is declared in one place so the verifier can replay it without
// running it: src/sim-seeds.ts. This file generates, tests/steps/simulation.ts re-derives.
import { SIM_SEEDS, ROUNDS_PER_CONFIG, CONVERGENCE_SAMPLES } from './sim-seeds';
import { playPass1Config } from './pass1';

// ── Progress bar ─────────────────────────────────────────────────────────────

function progressBar(current: number, total: number, label: string, startMs: number, width = 30): void {
  const ratio = Math.min(current / total, 1);
  const filled = Math.round(ratio * width);
  const bar = '━'.repeat(filled) + '╌'.repeat(width - filled);
  const pct = (ratio * 100).toFixed(0).padStart(3);
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  const eta = current > 0 ? (((Date.now() - startMs) / current) * (total - current) / 1000).toFixed(0) : '?';
  process.stdout.write(`\r  ${bar} ${pct}% │ ${current}/${total} │ ${label} │ ${elapsed}s elapsed · ~${eta}s left`);
}

function clearLine(): void {
  process.stdout.write('\r\x1b[K');
}

const CONFIG_FILE = path.join(__dirname, '..', 'plinkoConfig.json');
// `npm run test:full` regenerates into outputs/run/ (PF_SIM_OUT=outputs/run) and diffs the result
// against the committed artifacts (src/diff-simulation.ts); without it this writes the artifacts of
// record, as it always has.
const OUTPUTS_DIR = process.env.PF_SIM_OUT
  ? path.resolve(__dirname, '..', process.env.PF_SIM_OUT)
  : path.join(__dirname, '..', 'outputs');
fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

const rawCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const cfg = new PlinkoConfig(rawCfg.data);

type RiskLevel = 'low' | 'medium' | 'high';

// ── Pass 1: fresh random seeds ────────────────────────────────────────────────

const configs = cfg.allConfigs();


const pass1Results: Array<{
  rows: number;
  risk: RiskLevel;
  rounds: number;
  theoreticalRTP: number;
  simulatedRTP: number;
  rtpDiff: number;
  slotCounts: number[];
  expectedCounts: number[];
  chi2: number;
  df: number;
  pValue: number;
  lag1R: number;
  lag1Z: number;
  runsP: number;
  rtpSnapshots: Array<{ roundCount: number; rtp: number }>;
}> = [];

console.log('\n══════════════════════════════════════════════════════════');
console.log('  PASS 1 — Fresh random seeds');
console.log(`  ${ROUNDS_PER_CONFIG.toLocaleString()} rounds × ${configs.length} configs`);
console.log('══════════════════════════════════════════════════════════\n');

const pass1Start = Date.now();

for (let ci = 0; ci < configs.length; ci++) {
  const { rows, risk } = configs[ci];
  progressBar(ci, configs.length, `${rows}r/${risk}`, pass1Start);

  // The per-configuration loop is src/pass1.ts playPass1Config — moved there unchanged on
  // 2026-09-24 so Step 19 replays the whole experiment with the very function that generates it.
  const { server: simServer, client: simClient } = SIM_SEEDS[ci];
  const multipliers = Array.from({ length: rows + 1 }, (_, k) => cfg.scalingEdgeMultiplier(rows, risk, k));
  const played = playPass1Config(rows, multipliers, simServer, simClient, ROUNDS_PER_CONFIG, CONVERGENCE_SAMPLES);
  const { slotCounts, totalPayout, rtpSnapshots, lag1R } = played;

  const simulatedRTP = totalPayout / ROUNDS_PER_CONFIG;
  const theoreticalRTP = cfg.theoreticalRTP(rows, risk);

  const expectedCounts: number[] = [];
  for (let k = 0; k <= rows; k++) {
    expectedCounts.push(binomProb(rows, k) * ROUNDS_PER_CONFIG);
  }

  const { chi2, df, pValue } = chiSquaredTest([...slotCounts], expectedCounts);

  // Serial independence: lag-1 autocorrelation + runs test (computed in playPass1Config)
  const lag1Z = lag1R * Math.sqrt(ROUNDS_PER_CONFIG);
  const runs = { pValue: played.runsP };

  pass1Results.push({
    rows, risk, rounds: ROUNDS_PER_CONFIG,
    theoreticalRTP, simulatedRTP,
    rtpDiff: simulatedRTP - theoreticalRTP,
    slotCounts, expectedCounts, chi2, df, pValue,
    lag1R, lag1Z, runsP: runs.pValue,
    rtpSnapshots,
  });
}
clearLine();
progressBar(configs.length, configs.length, 'done', pass1Start);
process.stdout.write('\n');

// ── Convergence data (mean RTP across configs at each sample point) ──────────

interface ConvergencePoint {
  roundCount: number;
  meanRTP: number;
  stdDev: number;
}

const convergenceData: ConvergencePoint[] = [];

for (const samplePoint of CONVERGENCE_SAMPLES) {
  const rtpsAtPoint = pass1Results
    .map(r => r.rtpSnapshots.find(s => s.roundCount === samplePoint)?.rtp)
    .filter((v): v is number => v !== undefined);
  const mean = rtpsAtPoint.reduce((a, b) => a + b, 0) / rtpsAtPoint.length;
  const variance = rtpsAtPoint.length > 1
    ? rtpsAtPoint.reduce((a, b) => a + (b - mean) ** 2, 0) / (rtpsAtPoint.length - 1)
    : 0;
  const stdErr = rtpsAtPoint.length > 1 ? Math.sqrt(variance) / Math.sqrt(rtpsAtPoint.length) : 0;
  convergenceData.push({ roundCount: samplePoint, meanRTP: mean, stdDev: stdErr });
}

const pass1ElapsedMs = Date.now() - pass1Start;
const pass1Chi2Fails = pass1Results.filter(r => r.pValue < 0.01).length;
const bonferroniAlpha = 0.01 / configs.length;
const pass1Chi2BonferroniFails = pass1Results.filter(r => r.pValue < bonferroniAlpha).length;
const pass1SerialFails = pass1Results.filter(r => Math.abs(r.lag1Z) > 3 || r.runsP < 0.01).length;
const pass1AvgRTP = pass1Results.reduce((a, r) => a + r.simulatedRTP, 0) / pass1Results.length;

console.log(`\n  Avg simulated RTP: ${(pass1AvgRTP * 100).toFixed(4)}%`);
console.log(`  Chi-squared fails: ${pass1Chi2Fails}/${configs.length} at α=0.01 · ${pass1Chi2BonferroniFails}/${configs.length} at Bonferroni α/${configs.length}`);
console.log(`  Serial independence fails: ${pass1SerialFails}/${configs.length} (|z|>3 or runs p<0.01)`);
console.log(`  Time: ${(pass1ElapsedMs / 1000).toFixed(1)}s\n`);

// ── Binomial survival function for cherry-pick p-value ──────────────────────

function localBinomCoeff(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < Math.min(k, n - k); i++) {
    result = result * (n - i) / (i + 1);
  }
  return result;
}

/** P(X >= k) for X ~ Binomial(n, p). */
function binomialSurvival(n: number, p: number, k: number): number {
  let sum = 0;
  for (let i = k; i <= n; i++) {
    sum += localBinomCoeff(n, i) * Math.pow(p, i) * Math.pow(1 - p, n - i);
  }
  return sum;
}

// ── Pass 2: casino seeds ───────────────────────────────────────────────────────

const NONCES_PER_SEED = 10_000;
const EPOCH_LENGTH = 50; // nonces 0–49: the live capture window

const dataset = loadDataset();
const revealed = revealedSeeds(dataset.seeds);

// Build map: seedHash → { serverSeed, clientSeed, rows[] }
interface SeedInfo { serverSeed: string; clientSeed: string; rows: Set<number>; }
const seedInfoMap = new Map<string, SeedInfo>();

for (const s of revealed) {
  seedInfoMap.set(s.seed.serverSeedHashed, {
    serverSeed: s.seed.serverSeed!,
    clientSeed: '',
    rows: new Set(),
  });
}

for (const bet of dataset.bets) {
  const info = seedInfoMap.get(bet.response.server_seed_hashed);
  if (info) {
    info.rows.add(bet.response.rows);
    if (!info.clientSeed) info.clientSeed = bet.response.client_seed;
  }
}

const pass2Results: Array<{
  seed_hash: string;
  rows: number;
  full_range_chi2: number;
  full_range_p: number;
  full_range_df: number;
  early_chi2: number;
  early_p: number;
  early_df: number;
  late_chi2: number;
  late_p: number;
  late_df: number;
  cherry_pick_flag: boolean;
}> = [];

let testAFails = 0;
let cherryPickFlags = 0;

const seedEntries = [...seedInfoMap.entries()].filter(([, info]) => info.clientSeed !== '');

console.log('══════════════════════════════════════════════════════════');
console.log('  PASS 2 — Casino seeds');
console.log(`  ${seedEntries.length} seeds × ${NONCES_PER_SEED.toLocaleString()} nonces`);
console.log(`  Epoch window: nonces 0–${EPOCH_LENGTH - 1} (early) vs ${EPOCH_LENGTH}–${NONCES_PER_SEED - 1} (late)`);
console.log('══════════════════════════════════════════════════════════\n');

const pass2Start = Date.now();
let seedIdx = 0;

for (const [seedHash, info] of seedEntries) {
  seedIdx++;
  progressBar(seedIdx, seedEntries.length, `seed ${seedIdx}`, pass2Start);
  const keyBuffer = Buffer.from(info.serverSeed, 'hex');
  const rowList = [...info.rows].sort((a, b) => a - b);

  for (const rows of rowList) {
    const slotCount = rows + 1;
    const fullCounts = new Array(slotCount).fill(0);
    const earlyCounts = new Array(slotCount).fill(0);
    const lateCounts = new Array(slotCount).fill(0);

    for (let nonce = 0; nonce < NONCES_PER_SEED; nonce++) {
      const slot = computeSlotFromBuffer(keyBuffer, info.clientSeed, nonce, rows);
      fullCounts[slot]++;
      if (nonce < EPOCH_LENGTH) {
        earlyCounts[slot]++;
      } else {
        lateCounts[slot]++;
      }
    }

    const fullExpected = Array.from({ length: slotCount }, (_, k) => binomProb(rows, k) * NONCES_PER_SEED);
    const earlyExpected = Array.from({ length: slotCount }, (_, k) => binomProb(rows, k) * EPOCH_LENGTH);
    const lateExpected = Array.from({ length: slotCount }, (_, k) => binomProb(rows, k) * (NONCES_PER_SEED - EPOCH_LENGTH));

    const testA = chiSquaredTest([...fullCounts], fullExpected);
    const earlyTest = chiSquaredTest([...earlyCounts], earlyExpected);
    const lateTest = chiSquaredTest([...lateCounts], lateExpected);

    // Cherry-picking signature: early deviates from binomial, late does not
    const cherryPickFlag = earlyTest.pValue < 0.05 && lateTest.pValue >= 0.05;

    if (testA.pValue < 0.01) testAFails++;
    if (cherryPickFlag) cherryPickFlags++;

    pass2Results.push({
      seed_hash: seedHash,
      rows,
      full_range_chi2: testA.chi2,
      full_range_p: testA.pValue,
      full_range_df: testA.df,
      early_chi2: earlyTest.chi2,
      early_p: earlyTest.pValue,
      early_df: earlyTest.df,
      late_chi2: lateTest.chi2,
      late_p: lateTest.pValue,
      late_df: lateTest.df,
      cherry_pick_flag: cherryPickFlag,
    });
  }
}
clearLine();
progressBar(seedEntries.length, seedEntries.length, 'done', pass2Start);
process.stdout.write('\n');

const pass2ElapsedMs = Date.now() - pass2Start;

const N = pass2Results.length;

// Binomial p-value approach: PASS if P(X >= observed | n=N, p=alpha) >= 0.01
const testAPValue = binomialSurvival(N, 0.01, testAFails);
const testAVerdict = testAPValue >= 0.01 ? 'PASS' : 'FAIL';
const cherryPickPValue = binomialSurvival(N, 0.05, cherryPickFlags);
const cherryPickVerdict = cherryPickPValue >= 0.01 ? 'PASS' : 'FAIL';

console.log(`  Seeds tested: ${seedEntries.length}`);
console.log(`  Seed × row combinations: ${N}`);
console.log(`  Test A fails (p<0.01): ${testAFails} / ${N} — binomial pValue: ${testAPValue.toFixed(6)} → ${testAVerdict}`);
console.log(`  Cherry-pick flags: ${cherryPickFlags} / ${N} — binomial pValue: ${cherryPickPValue.toFixed(6)} → ${cherryPickVerdict}`);
console.log(`  Time: ${(pass2ElapsedMs / 1000).toFixed(1)}s\n`);

// ── Write unified output ───────────────────────────────────────────────────────

const output = {
  pass1_fresh_seeds: {
    description: 'Auditor-generated random seeds. Validates implementation and multiplier table independent of casino data.',
    roundsPerConfig: ROUNDS_PER_CONFIG,
    totalRounds: ROUNDS_PER_CONFIG * configs.length,
    configs: configs.length,
    avgTheoreticalRTP: configs.reduce((a, { rows, risk }) => a + cfg.theoreticalRTP(rows, risk as RiskLevel), 0) / configs.length,
    avgSimulatedRTP: pass1AvgRTP,
    chi2FailsAtAlpha01: pass1Chi2Fails,
    chi2FailsBonferroni: pass1Chi2BonferroniFails,
    serialIndependenceFails: pass1SerialFails,
    results: pass1Results,
    convergence: convergenceData,
  },
  pass2_casino_seeds: {
    description: "Revealed casino server seeds from the capture dataset. Tests whether the casino's seed selection produces biased distributions over the epoch window (cherry-picking detection).",
    seeds_tested: seedEntries.length,
    nonces_per_seed: NONCES_PER_SEED,
    epoch_length: EPOCH_LENGTH,
    seed_row_combinations: pass2Results.length,
    test_a_chi2_fails_at_alpha01: testAFails,
    test_a_binomial_pvalue: testAPValue,
    test_a_verdict: testAVerdict,
    test_b_cherry_pick_flags: cherryPickFlags,
    test_b_cherry_pick_pvalue: cherryPickPValue,
    test_b_verdict: cherryPickVerdict,
    results: pass2Results,
  },
};

fs.writeFileSync(path.join(OUTPUTS_DIR, 'simulation-results.json'), JSON.stringify(output, null, 2));

// ── Generate RTP Convergence Chart (self-contained HTML) ─────────────────────

const avgTheoreticalRTP = configs.reduce((a, { rows, risk }) => a + cfg.theoreticalRTP(rows, risk as RiskLevel), 0) / configs.length;
const finalPoint = convergenceData[convergenceData.length - 1];
const finalRTP = finalPoint.meanRTP;

// ── Self-contained SVG, no CDN ─────────────────────────────────────────────────
// This artifact is pinned evidence and the README says the package performs no network
// access. Until this release the chart pulled Chart.js from jsDelivr inside that pinned file,
// so the evidence rendered only for a reader online at the moment they opened it, and what
// they saw depended on a third party's CDN. The same traces are drawn as inline SVG — the
// approach the sibling LIQD Plinko package uses — and the file now opens offline, forever.
//
// Two defects in the replaced markup are fixed rather than carried over: the ±1 SE traces
// were labelled "+2 SE"/"-2 SE", and the "±" and "✓" glyphs were escaped twice and rendered
// to readers as the literal text ± and ✓.

const W = 1000, H = 470, PAD_L = 70, PAD_R = 28, PAD_T = 40, PAD_B = 58;
const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;

const theoPct = avgTheoreticalRTP * 100;
const lo2 = convergenceData.map(d => d.meanRTP - 2 * d.stdDev);
const hi2 = convergenceData.map(d => d.meanRTP + 2 * d.stdDev);
const yMinData = Math.min(theoPct, ...lo2);
const yMaxData = Math.max(theoPct, ...hi2);
const yPad = (yMaxData - yMinData) * 0.12 || 0.001;
const yMin = yMinData - yPad, yMax = yMaxData + yPad;
const nPts = convergenceData.length;
const xAt = (i: number) => PAD_L + (nPts <= 1 ? plotW : (i / (nPts - 1)) * plotW);
const yAt = (v: number) => PAD_T + (1 - (v - yMin) / (yMax - yMin)) * plotH;
const pts = (vals: number[]) => vals.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');

// The ±2 SE band as one closed polygon: up the upper edge, back down the lower.
const bandPath = `${pts(hi2)} ${lo2.map((v, i) => `${xAt(nPts - 1 - i).toFixed(1)},${yAt(lo2[nPts - 1 - i]!).toFixed(1)}`).join(' ')}`;

const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (i / 4) * (yMax - yMin));
const yGrid = yTicks.map(v => {
  const y = yAt(v).toFixed(1);
  return `<line x1="${PAD_L}" y1="${y}" x2="${PAD_L + plotW}" y2="${y}" stroke="#eee" stroke-width="1"/>`
    + `<text x="${PAD_L - 8}" y="${(Number(y) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#666">${v.toFixed(2)}%</text>`;
}).join('\n    ');

const roundsLabel = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(0)}M` : `${(n / 1e3).toFixed(0)}K`;
const xTickIdx = [...new Set([0, Math.floor((nPts - 1) / 4), Math.floor((nPts - 1) / 2), Math.floor(3 * (nPts - 1) / 4), nPts - 1])];
const xGrid = xTickIdx.map(i => {
  const x = xAt(i).toFixed(1);
  return `<line x1="${x}" y1="${PAD_T}" x2="${x}" y2="${PAD_T + plotH}" stroke="#f4f4f4" stroke-width="1"/>`
    + `<text x="${x}" y="${(PAD_T + plotH + 20).toFixed(1)}" text-anchor="middle" font-size="11" fill="#666">${roundsLabel(convergenceData[i]!.roundCount)}</text>`;
}).join('\n    ');

const meanPoints = convergenceData
  .map((d, i) => `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(d.meanRTP).toFixed(1)}" r="2.5" fill="#1565c0"/>`)
  .join('\n    ');
const theoY = yAt(theoPct).toFixed(1);

const chartHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>DUEL.COM PLINKO RTP CONVERGENCE — ${configs.length} CONFIGS x 1M ROUNDS EACH</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fafafa; padding: 24px; }
  .container { max-width: 1100px; margin: 0 auto; background: #fff; border-radius: 12px; border: 1px solid #e0e0e0; padding: 32px; }
  h1 { text-align: center; font-size: 16px; font-weight: 600; color: #333; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px; }
  .sub { text-align: center; font-size: 12px; color: #777; margin-bottom: 16px; }
  svg { display: block; width: 100%; height: auto; }
  .legend { text-align: center; margin-top: 12px; font-size: 13px; color: #666; }
  .legend span { margin: 0 12px; }
  .legend .dot { display: inline-block; width: 14px; height: 3px; vertical-align: middle; margin-right: 5px; }
  .final-box { display: inline-block; border: 2px solid #4caf50; border-radius: 8px; padding: 10px 20px; margin-top: 20px; }
  .final-box .label { font-size: 13px; color: #666; }
  .final-box .value { font-size: 22px; font-weight: 700; color: #2e7d32; }
  .final-box .check { color: #4caf50; font-size: 18px; }
</style>
</head>
<body>
<div class="container">
  <h1>Duel.com Plinko RTP Convergence — ${configs.length} configs &times; 1M rounds each</h1>
  <div class="sub">Running mean simulated RTP over the pooled run, with its standard error. SE = &sigma;/&radic;n, not standard deviation.</div>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Mean simulated RTP converging on the theoretical RTP as rounds accumulate">
    <rect x="${PAD_L}" y="${PAD_T}" width="${plotW}" height="${plotH}" fill="#fff" stroke="#ddd"/>
    ${yGrid}
    ${xGrid}
    <polygon points="${bandPath}" fill="rgba(229,115,115,0.10)" stroke="none"/>
    <polyline points="${pts(convergenceData.map(d => d.meanRTP + d.stdDev))}" fill="none" stroke="rgba(229,115,115,0.45)" stroke-width="1"/>
    <polyline points="${pts(convergenceData.map(d => d.meanRTP - d.stdDev))}" fill="none" stroke="rgba(229,115,115,0.45)" stroke-width="1"/>
    <line x1="${PAD_L}" y1="${theoY}" x2="${PAD_L + plotW}" y2="${theoY}" stroke="#e57373" stroke-width="2" stroke-dasharray="8 4"/>
    <polyline points="${pts(convergenceData.map(d => d.meanRTP))}" fill="none" stroke="#1565c0" stroke-width="2.5"/>
    ${meanPoints}
    <text x="${(PAD_L + plotW / 2).toFixed(1)}" y="${(H - 14).toFixed(1)}" text-anchor="middle" font-size="12" fill="#444">Rounds per config</text>
  </svg>
  <div class="legend">
    <span><span class="dot" style="background:#1565c0"></span>Mean RTP</span>
    <span><span class="dot" style="background:rgba(229,115,115,0.45)"></span>&plusmn;1 SE</span>
    <span><span class="dot" style="background:rgba(229,115,115,0.25)"></span>&plusmn;2 SE band</span>
    <span><span class="dot" style="background:#e57373"></span>Theoretical (${theoPct.toFixed(4)}%)</span>
  </div>
  <div style="text-align:right; margin-top:8px;">
    <div class="final-box">
      <span class="label">Final Mean RTP:</span>
      <span class="value">${finalRTP.toFixed(3)}%</span>
      <span class="check">&#10003;</span>
    </div>
  </div>
</div>
</body>
</html>`;

fs.writeFileSync(path.join(OUTPUTS_DIR, 'rtp-convergence.html'), chartHTML);

console.log('══════════════════════════════════════════════════════════');
console.log(`  Written: outputs/simulation-results.json`);
console.log(`  Written: outputs/rtp-convergence.html`);
console.log(`  Total time: ${((pass1ElapsedMs + pass2ElapsedMs) / 1000).toFixed(1)}s`);
console.log('══════════════════════════════════════════════════════════\n');
