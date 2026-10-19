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
  EXPECTED_DATASET_SHA256,
} from '../src/loader';
import type { VerifyContext, DeterminismEntry, ChiEntry } from './steps/context';
import * as commitment     from './steps/commitment';
import * as determinism    from './steps/determinism';
import * as payouts        from './steps/payouts';
import * as dataset        from './steps/dataset';
import * as antiCircularity from './steps/anti-circularity';
import * as phaseDStep     from './steps/phase-d';
import * as liveFit        from './steps/live-fit';
import * as simulation     from './steps/simulation';
import * as statistical    from './steps/statistical';
import * as artifacts      from './steps/artifacts';
import * as publication    from './steps/publication';
import { fieldDiff, beyondTolerance, maxima, DIFF_ATOL, DIFF_RTOL } from '../src/diff';
import { labelFor, profileCoverageBlock } from '../src/profile-map';
import { runRtpClaimGate, RTP_CLAIM_STEP } from '../src/rtp-settings';
import { rtpClaimVerdict, RTP_FIGURE_OVERSTATED, RTP_FIGURE_OVERSTATED_EXIT } from '../src/rtp-claim';

// ── Setup ─────────────────────────────────────────────────────────────────────

const OUTPUTS_DIR = path.join(__dirname, '..', 'outputs');
const RUN_DIR = path.join(OUTPUTS_DIR, 'run');
fs.mkdirSync(RUN_DIR, { recursive: true });
fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

const CONFIG_FILE = path.join(__dirname, '..', 'plinkoConfig.json');
const rawCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const cfg = new PlinkoConfig(rawCfg.data);

// ── Dataset Hash Guard (EC-25) — runs before any analysis ─────────────────────

const EXPECTED_HASH = EXPECTED_DATASET_SHA256;
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
const publicationResults = publication.run(ctx);   // Step  22
const liveFitResults = liveFit.run(ctx);           // Step  23

const results: StepResult[] = [
  ...commitmentResults,
  ...determinismResults,
  ...payoutsResults,
  ...datasetResults,
  ...antiCircResults,
  ...phaseDResults,
  ...simulationResults,
  ...artifactResults,
  ...publicationResults,
  ...liveFitResults,
];

// ── Informational context (not scored) ────────────────────────────────────────

const infoItems = statistical.run(ctx);

console.log('\n══════════════════════════════════════════════════════════');
console.log('  Informational Context (live dataset — not scored)');
console.log('══════════════════════════════════════════════════════════');
for (const item of infoItems) {
  console.log(`  [INFO] ${item.label} — ${item.detail}`);
}

// ── RTP-CLAIM rule (1.2.0, Methodology v1.1; 1.0.0 agreed on Slack 2026-09-29) ──
// The per-setting exact RTP table held to the published claim (src/rtp-settings.ts). The package
// switch RTP_CLAIM_RULE_ENFORCED is true (D3, 2026-10-14). Status OVERSTATED (a house-side miss) is
// scored on the step carrying PLINKO-19 as an operator-origin FLAG (the profile's policy) and the
// verdict becomes RTP FIGURE OVERSTATED, exit 5 (rtpClaimVerdict) — never NOT PROVABLY FAIR: the
// draws themselves pass. Status FAIL means the committed table no longer equals this run (or its
// pin): a reproduction failure, exit 1, whether or not the rule is enforced; no step moves for it.
const rtpClaim = runRtpClaimGate();
console.log('');
for (const line of rtpClaim.lines) console.log(`  ${line}`);
const rtpOverstated = rtpClaim.status === 'OVERSTATED';
if (rtpOverstated) {
  // This package's StepResult is scored on `pass` + `severity` (src/types.ts), not `status`: mark
  // the fields the summary counts.
  const s = results.find(r => r.step === RTP_CLAIM_STEP);
  if (s && !(s.pass === false && s.severity === 'HARD_FAIL')) {
    const why = `${RTP_FIGURE_OVERSTATED} (RTP-CLAIM enforced): ${rtpClaim.result.minimalFix}`;
    s.pass = false;
    s.severity = 'FLAG';
    s.origin = 'operator';
    s.failures = [...s.failures, why];
    s.summary += ` — ${why}`;
    // The step printed its own line when it ran, before this rule was scored. Print it again at the
    // status it is now counted at, so the console agrees with the summary and the emitted record.
    console.log(`  [FLAG] Step ${s.step} — ${s.name} (re-scored: RTP-CLAIM enforced, ${RTP_FIGURE_OVERSTATED})`);
    console.log(`    → ${why}`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

const passed   = results.filter(r => r.pass).length;
const failed   = results.filter(r => !r.pass);
const hardFails = failed.filter(r => r.severity === 'HARD_FAIL');
const flags    = failed.filter(r => r.severity === 'FLAG');
// INFO (profile policy INFORMATIONAL — the live-sample fit, Mike 2026-09-29): a deviation is reported,
// never counted as a flag, and never enters the verdict or the exit code.
const informational = failed.filter(r => r.severity === 'INFO');
// A capture-origin FLAG (an auditor-side capture retry reconstructed via commit-reveal) is
// disclosed but verdict-neutral; only an operator-origin FLAG downgrades to Conditional Pass.
// Rule adopted 2026-09-22 (Fable QA on PLINKO-04): not a PASS, but not against the verdict.
const captureFlags  = flags.filter(r => r.origin === 'capture');
const operatorFlags = flags.filter(r => r.origin !== 'capture');

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

if (operatorFlags.length > 0) {
  console.log('\n  FLAGS (verdict-affecting):');
  for (const r of operatorFlags) {
    console.log(`  ⚠ Step ${r.step}: ${r.name}`);
    for (const f of r.failures.slice(0, 2)) console.log(`    → ${f}`);
  }
}

if (captureFlags.length > 0) {
  console.log('\n  CAPTURE-ORIGIN LIMITATIONS (disclosed, verdict-neutral):');
  for (const r of captureFlags) {
    console.log(`  ⚑ Step ${r.step}: ${r.name}`);
    console.log(`    → ${r.summary}`);
  }
}

if (informational.length > 0) {
  console.log('\n  INFORMATIONAL DEVIATIONS (reported, not counted, verdict unchanged):');
  for (const r of informational) {
    console.log(`  ℹ Step ${r.step}: ${r.name}`);
    for (const f of r.failures.slice(0, 2)) console.log(`    → ${f}`);
  }
}

// Ranked by the rule's rtpClaimVerdict: a failed draw check (NOT PROVABLY FAIR) > RTP FIGURE
// OVERSTATED > Conditional Pass > Full Pass. This suite has no INCOMPLETE state.
const ruled = rtpClaimVerdict({ fails: hardFails.length, complete: true, overstated: rtpOverstated, opFlags: operatorFlags.length });
const verdict = ruled.verdict;

console.log(`\n  VERDICT: ${verdict}`);
console.log('══════════════════════════════════════════════════════════\n');

// ── Write outputs ──────────────────────────────────────────────────────────────

const output = {
  dataset: { bets: bets.length, seeds: seeds.length, phaseA: phaseA.length, phaseB: phaseB.length, phaseC: phaseC.length, phaseD: phaseD.length },
  artifactHashes: {
    dataset: { file: 'data/plinko-master-8100bets.json', expected: EXPECTED_HASH, actual: EXPECTED_HASH, match: true },
    config:  { file: 'plinkoConfig.json', expected: configHashCheck.expected, actual: configHashCheck.actual, match: configHashCheck.match },
  },
  verdict,
  // One summary shape across the Duel packages (Mike's review 2026-09-28, F20).
  summary: { passed, flags: flags.length, operatorFlags: operatorFlags.length, captureFlags: captureFlags.length, hardFail: hardFails.length, verdict },
  // Each scored step says which ProvablyFair.org Plinko profile check it implements, so the
  // conformance matrix is DERIVED from this artifact rather than written by hand and left to go
  // stale. The label is attached to the emitted record only: src/profile-map.ts cannot change
  // what any step asserts, and a step that answers no profile check says so explicitly.
  steps: results.map(r => ({ ...r, ...labelFor(r.step) })),
  profileCoverage: profileCoverageBlock(),
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

// RUN-ONLY replay precision (finding F2): the bit-identical counts and largest in-tolerance gaps
// are this machine's arithmetic. They were once inside verification-results.json, where a second
// CPU moving two p-values by one ulp turned 1,452 into 1,450 and failed the exact integer diff.
// They live here, under outputs/run/, and nowhere that is compared or pinned.
fs.writeFileSync(
  path.join(RUN_DIR, 'replay-precision.json'),
  JSON.stringify({ runtime: process.versions.node, ...simulation.runPrecision }, null, 2)
);
for (const [k, v] of Object.entries(simulation.runPrecision) as [string, any][]) {
  console.log(`  [RUN-ONLY] ${k}: ${v.withinTolerance}/${v.compared} within tolerance, ${v.bitIdentical} bit-identical on this machine, largest gap ${Number(v.largestGap).toExponential(2)}`);
}
console.log(`  Run products written to: outputs/run/replay-precision.json`);
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
  // `npm run test:full` (PF_REGEN=1) has just regenerated the simulation into outputs/run/ with the
  // generator itself; that regeneration is diffed here too, so outputs/run/diff.json records it with
  // the runtime (profile PLINKO-28). An absent regeneration under PF_REGEN=1 is a failure, not a skip.
  if (process.env.PF_REGEN === '1') {
    targets.push({ file: 'simulation-results.json', fresh: readJsonOrNull(path.join(RUN_DIR, 'simulation-results.json')) ?? '<regeneration absent>' });
  }
  const perFile = targets.map(t => {
    const committed = readJsonOrNull(path.join(OUTPUTS_DIR, t.file));
    // No run-timestamp is emitted into the evidence, so the committed record reproduces
    // byte-for-byte and there is nothing to exclude from the diff by name.
    const diffs = fieldDiff(committed, t.fresh, []);
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
    note: 'Field-level diff between the COMMITTED artifacts and THIS RUN. No run-timestamp is '
      + 'emitted, so nothing is excluded by name. Entries marked `withinTolerance` are the same '
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
// Framework 1.1: FAIL -> 1, RTP FIGURE OVERSTATED -> 5, FLAG -> 2, otherwise 0. Until v1.2.0 the
// file ended at the verdict, so `NOT PROVABLY FAIR` returned success and anything automated read it
// as clean. A reproduction beyond tolerance is a FAIL, not a warning: a gate that only prints is not one.
if (hardFails.length > 0 || reproductionFailures > 0 || !rtpClaim.tableMatches) process.exit(1);
if (ruled.exit === RTP_FIGURE_OVERSTATED_EXIT) process.exit(RTP_FIGURE_OVERSTATED_EXIT);
if (operatorFlags.length > 0) process.exit(2);
// A capture-origin FLAG is disclosed but verdict-neutral: exit 0, so npm test stays green.
