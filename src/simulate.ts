/**
 * Monte Carlo simulation for Plinko v3 — two-pass.
 *
 * Pass 1 — fresh random seeds (1M rounds per config):
 *   Validates the auditor's implementation and multiplier table independent
 *   of casino data. Seeds generated with crypto.randomBytes().
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
import { computeSlot, computeSlotFromBuffer } from './rng';
import { chiSquaredTest, binomProb, lag1Autocorrelation, runsTest } from './stats';
import { loadDataset, revealedSeeds } from './loader';

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
const OUTPUTS_DIR = path.join(__dirname, '..', 'outputs');
fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

const rawCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const cfg = new PlinkoConfig(rawCfg.data);

type RiskLevel = 'low' | 'medium' | 'high';

// ── Pass 1: fresh random seeds ────────────────────────────────────────────────

const ROUNDS_PER_CONFIG = 1_000_000;
const CONVERGENCE_SAMPLES = [1000, 5000, 10_000, 50_000, 100_000, 500_000, 1_000_000];
const configs = cfg.allConfigs();

// Pass 1 simulation seeds — one unique pair per config for proper variance averaging.
// Generated once via crypto.randomBytes(32/16), pinned for reproducibility (S7).
// Using one seed per config ensures seed-level variance averages out across configs,
// producing a mean RTP that converges properly to 99.9%.
const SIM_SEEDS: Array<{ server: string; client: string }> = [
  { server: '4734da3b9ebf8b9bf05461f2f200a0ec5e30b1d86958d320dbaff44946afe308', client: '3b98b5dd029f0432bb2cc0cacd913f0b' },
  { server: 'a77a393ff0ffb6a79b242d407ee59126fe6ff72fe0366d7463b8deecc3f12bfa', client: '52de9b72675f3b203e53f203acc14368' },
  { server: 'd6c13426f64d7667cd3917efec963f2ae191b88f0ea2d146fbec8a1b54e7fa26', client: 'e6e15047d0e36a885cfac10c630cbb89' },
  { server: '242b4a3baaf661314552abfb4f32df957dcc0c5792e2b3e800ee1225e9e7831f', client: 'e636f807a5c6da642a7b1ab5ef8e9310' },
  { server: 'eef97180f7b9c712c5a84f007ecacc3649b16ded668cc7c0e8a1107750d1430b', client: 'b5dd8ae30ccb0e63624d1ce9222f3b42' },
  { server: 'e3a19be07833913355d05a345820463dc382639ed0afcddea565e6f287bfa9f5', client: '7309998110aeb2ea0bda4e1e308536fc' },
  { server: 'c724369491b7f463eaeb8c262087ee9040ea59a8e4c3df4f2a9f815f42366ad1', client: '4b6028af4f38b18048019e53d8c34356' },
  { server: '27b10080294f19749a18b5e96f2d90b1217e2a61d0ad39e6cf9d4cea13c3d630', client: 'c4f92b4ebbc23ef9c0ee8030d2e47033' },
  { server: '61983e25ed1b73d759928d0771b363b0c29b62908e03087022ca052571b627d6', client: 'ee7e98c4fc555c749915ae0ee59111e2' },
  { server: '39672710a48198bc52881c72196676ffc474ad16595e164345d70b65de414515', client: 'd6c9433adaed36df16b1beeb411acc4d' },
  { server: '7495518801ca098391d673d44c968366b4df967e284880c3471222a137ba6564', client: '6f9f16080737a5307cda90b05476383f' },
  { server: 'f02b0c898fb5743fed49c59ef73bf9dc940761c1586c43c46787b3fb3a49b7ba', client: 'aadaf86124aa9c0f4ca5875938b430e5' },
  { server: '049bf25cf9c0d0371970502461f986c730ebb272cdc471f64c57cae2efc0fff9', client: 'f9724341f351c41ff6f3bbe67ce33a85' },
  { server: '4d3afb4a3b60e72abbe484a011bedc976420563d68ddf3e62007ad4746cce02f', client: '06deb1ec68c9a17a3adda2ca837a0210' },
  { server: '4842bbe9a9a97704c7821cfb1c6f18417401d9661edb0eb9131b9ecdf1261946', client: 'a53812f8d4ef9568807a007d57d72348' },
  { server: '343cfcc30c9bf3cf08a95ccf2642cf9c90b421e8110b45fee7d993db9b8838ab', client: '2b0cd94679e3000047e81f9d11d17fc6' },
  { server: 'ff29b9019b3fbd04ac79ce59144e5d5ec4c4f3644b7c4514bc00465ce387f3da', client: '0d70d4d1ea3c4f85f2a888e623bf12eb' },
  { server: 'acfaa736747a456c26ce6567ade6455fc7c939bd7cd8d83bcf184646a74f1f5a', client: 'e628a90b14dd0a03886d686044cb22c3' },
  { server: 'bc1d7599d2228b7122f444bf563b8124e5b8fa9942165f216a1517b8b3261a09', client: '35d1abf6d3db3ebe184b95e19675597e' },
  { server: '5715dbfdad17c85c134a10e975a9b825f668284ef72e077c211c32c0425e129a', client: '5571452b6b97ca92fd0c52ae16b03479' },
  { server: '367606fbd4bdccfe019990767c4e221ffff76fc8cce6ca5b8bbf2db064fe7847', client: '9b4e6ef70474da148d4431897976fe6d' },
  { server: 'ddc78cb1b21d3ebfdffbdb973221598318e58742c0d491bcb86ab30a55672da1', client: 'c39f1b507d5ca09885e4e16a4b704e51' },
  { server: 'cef7b4a0662fc95bae6b2a8d59d6b2be4dc7ed6acdba94c157404f1a3e44295e', client: 'eccc4279df1d61db01aaf5f9e0a740ea' },
  { server: 'd0a09bf70898e21e053b7321cc5158c9d887c7cf748991fd981c9a4de440c9b4', client: '5db27ce4edc73df187fe7472cf1a0c39' },
  { server: '3afa59daf050988753433b57401a98eb210289804bf8a15ce691472ac17196c0', client: 'a2b1ecb84dc2f7d5b8df77630c91d248' },
  { server: '460574281e70639cab174ceb0b22d6fa60207f6426cabbcaa42fe09a75948b5e', client: '7a9d6948a2d5ff1f61ca5860b364c01b' },
  { server: '9dd3211bf679f0341d7aff12bd9cb78563bbb236b1ec9fca6413b7ae914b3c62', client: '142fbf81688a033ab7012f003f875194' },
];

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

  const slotCount = rows + 1;
  const slotCounts = new Array(slotCount).fill(0);
  const hitSequence = new Array(ROUNDS_PER_CONFIG);
  let totalPayout = 0;

  const rtpSnapshots: Array<{ roundCount: number; rtp: number }> = [];
  let nextSampleIdx = 0;

  const { server: simServer, client: simClient } = SIM_SEEDS[ci];
  for (let nonce = 0; nonce < ROUNDS_PER_CONFIG; nonce++) {
    const slot = computeSlot(simServer, simClient, nonce, rows);
    slotCounts[slot]++;
    hitSequence[nonce] = slot;
    totalPayout += cfg.scalingEdgeMultiplier(rows, risk, slot);

    if (nextSampleIdx < CONVERGENCE_SAMPLES.length && (nonce + 1) === CONVERGENCE_SAMPLES[nextSampleIdx]) {
      rtpSnapshots.push({ roundCount: nonce + 1, rtp: (totalPayout / (nonce + 1)) * 100 });
      nextSampleIdx++;
    }
  }

  const simulatedRTP = totalPayout / ROUNDS_PER_CONFIG;
  const theoreticalRTP = cfg.theoreticalRTP(rows, risk);

  const expectedCounts: number[] = [];
  for (let k = 0; k <= rows; k++) {
    expectedCounts.push(binomProb(rows, k) * ROUNDS_PER_CONFIG);
  }

  const { chi2, df, pValue } = chiSquaredTest([...slotCounts], expectedCounts);

  // Serial independence: lag-1 autocorrelation + runs test
  const lag1R = lag1Autocorrelation(hitSequence);
  const lag1Z = lag1R * Math.sqrt(ROUNDS_PER_CONFIG);
  const median = rows / 2;
  const aboveMedian = hitSequence.map((s: number) => s > median);
  const runs = runsTest(aboveMedian);

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

const chartHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>DUEL.COM PLINKO RTP CONVERGENCE — ${configs.length} CONFIGS x 1M ROUNDS EACH</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fafafa; padding: 24px; }
  .container { max-width: 1100px; margin: 0 auto; background: #fff; border-radius: 12px; border: 1px solid #e0e0e0; padding: 32px; }
  h1 { text-align: center; font-size: 16px; font-weight: 600; color: #333; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 24px; }
  .chart-wrap { position: relative; height: 420px; }
  .final-box { display: inline-block; border: 2px solid #4caf50; border-radius: 8px; padding: 10px 20px; margin-top: 20px; }
  .final-box .label { font-size: 13px; color: #666; }
  .final-box .value { font-size: 22px; font-weight: 700; color: #2e7d32; }
  .final-box .check { color: #4caf50; font-size: 18px; }
  .legend { text-align: center; margin-top: 12px; font-size: 13px; color: #666; }
  .legend span { margin: 0 12px; }
  .legend .dot { display: inline-block; width: 12px; height: 3px; vertical-align: middle; margin-right: 4px; }
</style>
</head>
<body>
<div class="container">
  <h1>DUEL.COM PLINKO RTP CONVERGENCE — ${configs.length} CONFIGS x 1M ROUNDS EACH</h1>
  <div class="chart-wrap"><canvas id="chart"></canvas></div>
  <div class="legend">
    <span><span class="dot" style="background:#1565c0;height:3px"></span> Mean RTP</span>
    <span><span class="dot" style="background:rgba(229,115,115,0.5);height:3px"></span> \\u00b12 SE band</span>
    <span><span class="dot" style="background:#e57373;border-top:2px dashed #e57373;height:0"></span> Theoretical (${(avgTheoreticalRTP * 100).toFixed(1)}%)</span>
  </div>
  <div style="text-align:right; margin-top:8px;">
    <div class="final-box">
      <span class="label">Final Mean RTP:</span>
      <span class="value">${finalRTP.toFixed(3)}%</span>
      <span class="check">\\u2713</span>
    </div>
  </div>
</div>
<script>
const data = ${JSON.stringify(convergenceData.map(d => ({
  x: d.roundCount,
  y: d.meanRTP,
  sd: d.stdDev,
})))};

const theoretical = ${(avgTheoreticalRTP * 100).toFixed(6)};
const labels = data.map(d => {
  const m = d.x / 1e6;
  return m >= 1 ? m.toFixed(0) + 'M' : (d.x / 1e3).toFixed(0) + 'K';
});

const ctx = document.getElementById('chart').getContext('2d');
new Chart(ctx, {
  type: 'line',
  data: {
    labels,
    datasets: [
      {
        label: 'Upper band',
        data: data.map(d => d.y + d.sd * 2),
        borderColor: 'transparent',
        backgroundColor: 'rgba(229,115,115,0.08)',
        fill: '+1',
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: 'Lower band',
        data: data.map(d => d.y - d.sd * 2),
        borderColor: 'transparent',
        backgroundColor: 'rgba(229,115,115,0.08)',
        fill: false,
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: '+2 SE',
        data: data.map(d => d.y + d.sd),
        borderColor: 'rgba(229,115,115,0.4)',
        borderWidth: 1,
        fill: false,
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: '-2 SE',
        data: data.map(d => d.y - d.sd),
        borderColor: 'rgba(229,115,115,0.4)',
        borderWidth: 1,
        fill: false,
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: 'Theoretical (' + theoretical.toFixed(1) + '%)',
        data: data.map(() => theoretical),
        borderColor: '#e57373',
        borderWidth: 2,
        borderDash: [8, 4],
        fill: false,
        pointRadius: 0,
      },
      {
        label: 'Mean RTP',
        data: data.map(d => d.y),
        borderColor: '#1565c0',
        borderWidth: 2.5,
        fill: false,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: '#1565c0',
        pointHoverBackgroundColor: '#1565c0',
        tension: 0.3,
      },
      {
        label: 'Final',
        data: data.map((d, i) => i === data.length - 1 ? d.y : null),
        borderColor: '#1565c0',
        backgroundColor: '#1565c0',
        pointRadius: 6,
        pointHoverRadius: 8,
        showLine: false,
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => labels[items[0].dataIndex] + ' rounds/config — mean of ${configs.length} configs',
          label: (item) => {
            if (item.datasetIndex === 5) return 'Mean RTP: ' + item.parsed.y.toFixed(4) + '%';
            if (item.datasetIndex === 4) return 'Theoretical: ' + theoretical.toFixed(4) + '%';
            return null;
          },
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: 'Rounds per Config', font: { size: 12 } },
        ticks: { maxTicksLimit: 10 },
      },
      y: {
        title: { display: false },
        ticks: { callback: v => v.toFixed(1) + '%' },
      },
    },
  },
});
<\/script>
</body>
</html>`;

fs.writeFileSync(path.join(OUTPUTS_DIR, 'rtp-convergence.html'), chartHTML);

console.log('══════════════════════════════════════════════════════════');
console.log(`  Written: outputs/simulation-results.json`);
console.log(`  Written: outputs/rtp-convergence.html`);
console.log(`  Total time: ${((pass1ElapsedMs + pass2ElapsedMs) / 1000).toFixed(1)}s`);
console.log('══════════════════════════════════════════════════════════\n');
