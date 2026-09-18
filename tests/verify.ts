/**
 * Plinko v3 Audit — Verification Suite
 * Orchestrator: delegates to domain modules in tests/steps/.
 * Usage: npm run verify
 */

import fs from 'fs';
import path from 'path';
import type { StepResult } from '../src/types';
import { sha256Buffer } from '../src/rng';
import { PlinkoConfig } from '../src/config';
import {
  loadDataset,
  loadMasterBuffer,
  groupByHash,
  revealedSeedMap,
  phaseBets as filterPhase,
  checkConfigHash,
  PLINKO_CONFIG_HASH,
} from '../src/loader';
import type { VerifyContext, DeterminismEntry, ChiEntry } from './steps/context';
import * as commitment     from './steps/commitment';
import * as determinism    from './steps/determinism';
import * as payouts        from './steps/payouts';
import * as dataset        from './steps/dataset';
import * as antiCircularity from './steps/anti-circularity';
import * as phaseDStep     from './steps/phase-d';
import * as simulation     from './steps/simulation';
import * as statistical    from './steps/statistical';
import * as artifacts      from './steps/artifacts';
import { fieldDiff, beyondTolerance, maxima, DIFF_ATOL, DIFF_RTOL } from '../src/diff';

// ── Setup ─────────────────────────────────────────────────────────────────────

const OUTPUTS_DIR = path.join(__dirname, '..', 'outputs');
const RUN_DIR = path.join(OUTPUTS_DIR, 'run');
fs.mkdirSync(RUN_DIR, { recursive: true });
fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

const CONFIG_FILE = path.join(__dirname, '..', 'plinkoConfig.json');
const rawCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const cfg = new PlinkoConfig(rawCfg.data);

// ── Dataset Hash Guard (EC-25) — runs before any analysis ─────────────────────

const EXPECTED_HASH = '3cf9359d88220bc800bb32edfe04399f55b909302262928ee3a0582715635267';
{
  const buf = loadMasterBuffer();
  const actualHash = sha256Buffer(buf);
  console.log('\n  Dataset hash check (EC-25):');
  console.log(`    Expected: ${EXPECTED_HASH}`);
  console.log(`    Actual:   ${actualHash}`);
  if (actualHash !== EXPECTED_HASH) {
    console.error('\n  ABORT: dataset hash mismatch — data may be corrupted or tampered. Verification cannot proceed.\n');
    process.exit(1);
  }
  console.log('    Status:   MATCH ✓');
}

// ── Config Hash Guard — pins the operator-supplied multiplier table ───────────
const configHashCheck = checkConfigHash();
{
  console.log('\n  Config hash check (plinkoConfig.json):');
  console.log(`    Expected: ${configHashCheck.expected}`);
  console.log(`    Actual:   ${configHashCheck.actual}`);
  if (!configHashCheck.match) {
    console.error('\n  ABORT: plinkoConfig.json hash mismatch — multiplier table differs from the audited artifact. Verification cannot proceed.\n');
    process.exit(1);
  }
  console.log('    Status:   MATCH ✓');
}

const rawDataset = loadDataset();
const { bets, seeds } = rawDataset;
const revealedMap = revealedSeedMap(seeds);
const byHash = groupByHash(bets);

const phaseA = filterPhase(bets, 'A');
const phaseB = filterPhase(bets, 'B');
const phaseC = filterPhase(bets, 'C');
const phaseD = filterPhase(bets, 'D');

console.log('\n══════════════════════════════════════════════════════════');
console.log('  PLINKO v3 AUDIT — VERIFICATION SUITE');
console.log('══════════════════════════════════════════════════════════');
console.log(`  Dataset: ${bets.length} bets  |  Seeds: ${seeds.length}`);
console.log(`  Phase A: ${phaseA.length}  Phase B: ${phaseB.length}  Phase C: ${phaseC.length}  Phase D: ${phaseD.length}\n`);

// ── Build shared context ───────────────────────────────────────────────────────

const determinismLog: DeterminismEntry[] = [];
const chiSquaredLog: ChiEntry[] = [];

const ctx: VerifyContext = {
  bets,
  seeds,
  cfg,
  byHash,
  revealedMap,
  phaseA,
  phaseB,
  phaseC,
  phaseD,
  expectedHash: EXPECTED_HASH,
  outputsDir: OUTPUTS_DIR,
  dataset: rawDataset,
  determinismLog,
  chiSquaredLog,
};

// ── Run scored steps ──────────────────────────────────────────────────────────

const commitmentResults = commitment.run(ctx);    // Steps  1– 4
const determinismResults = determinism.run(ctx);   // Steps  5– 6
const payoutsResults = payouts.run(ctx);           // Steps  7– 9
const datasetResults = dataset.run(ctx);           // Steps 10–16
const antiCircResults = antiCircularity.run(ctx);  // Step  17
const phaseDResults = phaseDStep.run(ctx);          // Step  18
const simulationResults = simulation.run(ctx);     // Steps 19–20
const artifactResults = artifacts.run(ctx);        // Step  21

const results: StepResult[] = [
  ...commitmentResults,
  ...determinismResults,
  ...payoutsResults,
  ...datasetResults,
  ...antiCircResults,
  ...phaseDResults,
  ...simulationResults,
  ...artifactResults,
];

// ── Informational context (not scored) ────────────────────────────────────────

const infoItems = statistical.run(ctx);

console.log('\n══════════════════════════════════════════════════════════');
console.log('  Informational Context (live dataset — not scored)');
console.log('══════════════════════════════════════════════════════════');
for (const item of infoItems) {
  console.log(`  [INFO] ${item.label} — ${item.detail}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

const passed   = results.filter(r => r.pass).length;
const failed   = results.filter(r => !r.pass);
const hardFails = failed.filter(r => r.severity === 'HARD_FAIL');
const flags    = failed.filter(r => r.severity === 'FLAG');

console.log('\n══════════════════════════════════════════════════════════');
console.log('  RESULTS SUMMARY');
console.log('══════════════════════════════════════════════════════════');
console.log(`  Passed:     ${passed}/${results.length}`);
console.log(`  Hard fails: ${hardFails.length}`);

if (hardFails.length > 0) {
  console.log('\n  HARD FAILS:');
  for (const r of hardFails) {
    console.log(`  ✗ Step ${r.step}: ${r.name}`);
    for (const f of r.failures.slice(0, 3)) console.log(`    → ${f}`);
  }
}

if (flags.length > 0) {
  console.log('\n  FLAGS:');
  for (const r of flags) {
    console.log(`  ⚠ Step ${r.step}: ${r.name}`);
    for (const f of r.failures.slice(0, 2)) console.log(`    → ${f}`);
  }
}

const verdict = hardFails.length === 0 && flags.length === 0
  ? 'PROVABLY FAIR — Full Pass'
  : hardFails.length > 0
    ? 'NOT PROVABLY FAIR'
    : 'PROVABLY FAIR — Conditional Pass';

console.log(`\n  VERDICT: ${verdict}`);
console.log('══════════════════════════════════════════════════════════\n');

// ── Write outputs ──────────────────────────────────────────────────────────────

const output = {
  runAt: new Date().toISOString(),
  dataset: { bets: bets.length, seeds: seeds.length, phaseA: phaseA.length, phaseB: phaseB.length, phaseC: phaseC.length, phaseD: phaseD.length },
  artifactHashes: {
    dataset: { file: 'data/plinko-master-8100bets.json', expected: EXPECTED_HASH, actual: EXPECTED_HASH, match: true },
    config:  { file: 'plinkoConfig.json', expected: configHashCheck.expected, actual: configHashCheck.actual, match: configHashCheck.match },
  },
  verdict,
  summary: { passed, hardFails: hardFails.length, flags: flags.length },
  steps: results,
  informational: infoItems,
};

// A VERIFICATION RUN MUST NOT REWRITE THE ARTIFACT IT SCORES. Until this release this
// statement wrote straight over the committed copy on every run, failing runs included — so a
// run that disagreed with the committed evidence destroyed the evidence of the disagreement,
// and the next run compared the repo against what the failing run had just written. This run
// writes under outputs/run/; the committed copy is refreshed only by PF_EMIT=1.
const PF_EMIT = process.env.PF_EMIT === '1';
const RESULTS_DIR = PF_EMIT ? OUTPUTS_DIR : RUN_DIR;
fs.mkdirSync(RESULTS_DIR, { recursive: true });
fs.writeFileSync(
  path.join(RESULTS_DIR, 'verification-results.json'),
  JSON.stringify(output, null, 2)
);
console.log(`  Outputs written to: ${PF_EMIT ? 'outputs' : 'outputs/run'}/verification-results.json`);

const determinismOutput = {
  // NO `generatedAt`. This is a pinned artifact of record: a timestamp inside it means a
  // regeneration can never reproduce the pinned bytes even when every figure is identical,
  // which defeats the pin. Run metadata belongs to the run, and the run is outputs/run/.
  totalBets: determinismLog.length,
  verified: determinismLog.filter(e => e.match).length,
  skipped: 0,
  mismatches: determinismLog.filter(e => !e.match).length,
  parityRate: `${determinismLog.filter(e => e.match).length}/${determinismLog.length}`,
  log: determinismLog,
};
fs.writeFileSync(
  // RUN PRODUCTS, not artifacts of record: derived wholly from THIS run, yet written on top of
  // the committed copies — so the verifier replaced the evidence it scores, a forged copy was
  // overwritten rather than detected, and the committed bytes drifted every run.
  path.join(RUN_DIR, 'determinism-log.json'),
  JSON.stringify(determinismOutput, null, 2)
);
console.log(`  Run products written to: outputs/run/determinism-log.json`);

const chiSquaredOutput = {
  // NO `generatedAt` — see determinismOutput above.
  source: 'live bets (plinko-master.json)',
  alpha: 0.01,
  configsTested: chiSquaredLog.length,
  configsPassed: chiSquaredLog.filter(e => e.pass).length,
  note: 'Slots with expected count < 5 pooled. Configs with n < 100 excluded.',
  results: chiSquaredLog.sort((a, b) => a.config.localeCompare(b.config)),
};
fs.writeFileSync(
  path.join(RUN_DIR, 'chi-squared-results.json'),
  JSON.stringify(chiSquaredOutput, null, 2)
);
console.log(`  Run products written to: outputs/run/chi-squared-results.json`);
console.log(`  Committed artifacts NOT modified.`);

// ── Reproduction gate ─────────────────────────────────────────────────────────
// README §Reproduce says the gate is this comparison. It is one now.
//
// THE GATE IS "BEYOND TOLERANCE", NOT "ANY FIELD". Byte identity is required of exact content
// — the dataset and the config, both hash-guarded above. It is the wrong bar for a DERIVED
// statistic: regenerate the p-values on other hardware and a few move by a unit in the last
// place. Scoring that as a disagreement trains a reader to ignore the diff, which is the one
// outcome that makes it useless. The bound is declared in src/diff.ts, far below the precision
// of any figure this audit publishes; outside it is a DIFFERENT result, and the run exits 1.
let reproductionFailures = 0;
if (!PF_EMIT) {
  const readJsonOrNull = (p: string): unknown => {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  };
  const targets: { file: string; fresh: unknown }[] = [
    { file: 'verification-results.json', fresh: output },
    { file: 'determinism-log.json',      fresh: determinismOutput },
    { file: 'chi-squared-results.json',  fresh: chiSquaredOutput },
  ];
  const perFile = targets.map(t => {
    const committed = readJsonOrNull(path.join(OUTPUTS_DIR, t.file));
    // `runAt` is a property of the run, not of the evidence, and differs by construction.
    const diffs = fieldDiff(committed, t.fresh, ['runAt']);
    return { file: t.file, readable: committed !== null, diffs, real: beyondTolerance(diffs) };
  });
  const allDiffs  = perFile.flatMap(p => p.diffs);
  const realTotal = perFile.reduce((n, p) => n + p.real.length, 0);
  const gap       = maxima(allDiffs);

  fs.writeFileSync(path.join(RUN_DIR, 'diff.json'), JSON.stringify({
    runtime: process.versions.node,
    verdict,
    tolerance: { atol: DIFF_ATOL, rtol: DIFF_RTOL, rule: '|a-b| <= atol + rtol*max(|a|,|b|); two distinct integers never agree' },
    reproduced: realTotal === 0,
    beyondToleranceCount: realTotal,
    withinToleranceCount: allDiffs.length - realTotal,
    largestGap: gap,
    note: 'Field-level diff between the COMMITTED artifacts and THIS RUN. `runAt` is excluded '
      + 'because it differs by construction. Entries marked `withinTolerance` are the same '
      + 'result computed on different hardware and are recorded, not scored. Any entry NOT so '
      + 'marked means this run disagrees with the committed evidence — investigate it; do not '
      + 're-run until it goes away, and do not regenerate the committed artifact to make it go away.',
    files: perFile.map(p => ({ file: `outputs/${p.file}`, committedReadable: p.readable, differences: p.diffs })),
  }, null, 2));

  console.log(`  Reproduction vs the committed artifacts on Node ${process.versions.node}: `
    + `${realTotal === 0 ? 'REPRODUCED' : `${realTotal} field(s) BEYOND TOLERANCE`}`
    + `${allDiffs.length - realTotal > 0 ? ` (${allDiffs.length - realTotal} within tolerance` + (gap ? `, largest ${gap.absDiff.toExponential(2)} at ${gap.path}` : '') + ')' : ''}`);
  console.log(`  Diff written to: outputs/run/diff.json`);
  if (realTotal > 0) {
    console.log('  ⚠ THIS RUN DISAGREES WITH THE COMMITTED EVIDENCE:');
    for (const p of perFile) {
      if (!p.readable) { console.log(`      outputs/${p.file}: committed copy absent or unreadable`); continue; }
      for (const d of p.real.slice(0, 4)) {
        console.log(`      ${p.file} ${d.path}: committed ${JSON.stringify(d.committed)} vs this run ${JSON.stringify(d.thisRun)}`);
      }
    }
  }
  reproductionFailures = realTotal;
} else {
  console.log('  REPORT GENERATION (PF_EMIT=1): the committed verification-results.json was rewritten.');
}

// ── Exit contract ─────────────────────────────────────────────────────────────
// Framework 1.0: FAIL -> 1, FLAG -> 2, otherwise 0. Until this release the file ended at the
// verdict, so `NOT PROVABLY FAIR` returned success and anything automated read it as clean.
// A reproduction beyond tolerance is a FAIL, not a warning: a gate that only prints is not one.
if (hardFails.length > 0 || reproductionFailures > 0) process.exit(1);
if (flags.length > 0) process.exit(2);
