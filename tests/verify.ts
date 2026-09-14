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

fs.writeFileSync(
  path.join(OUTPUTS_DIR, 'verification-results.json'),
  JSON.stringify(output, null, 2)
);
console.log(`  Outputs written to: outputs/verification-results.json`);

const determinismOutput = {
  generatedAt: new Date().toISOString(),
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
  generatedAt: new Date().toISOString(),
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
