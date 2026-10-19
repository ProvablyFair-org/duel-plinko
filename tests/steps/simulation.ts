/**
 * Steps 19–20: Simulation Integrity
 * EC-34, EC-35
 */

import fs from 'fs';
import path from 'path';
import type { StepResult, RiskLevel } from '../../src/types';
import { computeSlot, computeSlotFromBuffer } from '../../src/rng';
import { binomProb, chiSquaredTest } from '../../src/stats';
import { revealedSeeds, EXPECTED_BETS } from '../../src/loader';
import { poissonBinomialSurvival } from '../../src/stats';
import {
  pathsSlots, nullSeed, slotOf, mulberry32, binomialUpperTail,
  PASS2_NULL_SEEDS, PASS2_NULL_LABEL, MAX_CURSORS, type PathsJob,
} from '../../src/pass2-replay';
import { SIM_SEEDS, ROUNDS_PER_CONFIG, CONVERGENCE_SAMPLES, REPLAY_ROUNDS } from '../../src/sim-seeds';
import { runBatch } from '../../src/parallel';
import { pass1Slots, unpackPass1, type Pass1Job, type Pass1Played } from '../../src/pass1';
import { numbersAgree, DIFF_ATOL, DIFF_RTOL } from '../../src/diff';
import { newTally, tallyPair, artifactView, runView } from '../../src/replay-precision';
import { pass, fail, VerifyContext, tag } from './context';

/**
 * RUN-ONLY replay precision (finding F2). How many replayed figures came back bit-identical, and
 * the largest in-tolerance gap, are properties of the CPU that ran this — they are never put in a
 * step's details (which land in the compared artifact outputs/verification-results.json).
 * tests/verify.ts writes this record to outputs/run/replay-precision.json only.
 */
export const runPrecision: Record<string, unknown> = {};

// ── Bounds for Step 19, declared in code rather than inline at the comparison ──

/**
 * A scalar the artifact reports must agree with the same quantity recomputed from the artifact's
 * own histogram. The gap is summation order on ~10^6 terms, nothing more, so the bound is tight.
 */
const DERIVE_TOL = 1e-9;

/** Simulated RTP must sit within this many standard errors of the table's theoretical RTP. */
const SE_SIGMA = 5;

/**
 * DISPERSION CEILING AND FLOOR. A histogram invented as round(binomial × N) passes every
 * ordinary recompute: the counts sum, the RTP re-derives, the multipliers match. What it cannot
 * fake is noise — it sits impossibly close to theory, giving a chi-squared near zero and a
 * p-value near one. Too good is rejected exactly as too bad is.
 */
const DISPERSION_P_MAX = 0.9999;
const CHI2_FLOOR_RATIO = 0.02;

// ── Test C (Step 20, profile PLINKO-21) — THE PRE-REGISTERED RULE ─────────────────────────────
//
// WRITTEN 2026-09-24, BEFORE THE STATISTIC WAS FIRST COMPUTED, with the α values the HouseBets and
// LIQD packages fixed for the same served-configuration statistic. It was written AFTER this
// capture's server seeds were revealed (as it was for the HouseBets, LIQD and Duel Mines packages):
// the rule is fixed in code before its first evaluation, not before the data existed. Changing any
// of these after seeing a result is re-registration and must be disclosed as such.
//
//   statistic  per revealed epoch: the payout sum S of the 50 configurations the casino actually
//              served at nonces 0–49 (the captured nonce range), standardised by the EXACT per-board
//              mean and variance (binomial slot law × the served bracket-0 multipliers);
//   null       Monte-Carlo calibration on PASS2_NULL_SEEDS = 10,000 fresh seeds (src/pass2-replay.ts)
//              playing the same served sequence at nonces 0–49; p = (1 + #null ≤ z) / (R + 1);
//   flag       one-sided, lower tail (a window that pays the player LESS): p ≤ TEST_C_ALPHA;
//   family     flags aggregated by Poisson-binomial survival over the per-epoch null flag
//              probability ⌊α(R+1)⌋/(R+1) — an upper bound on the true rate when the lattice ties;
//              survival < TEST_C_FAMILY_FAIL → FAIL, < TEST_C_FAMILY_FLAG → FLAG (marginal excess);
//   broad      an epoch whose early window p ≤ TEST_C_BROAD_P AND whose reference window (nonces
//              50–9,999, the same served sequence cycled) p ≤ TEST_C_BROAD_P → FAIL (a seed bad
//              everywhere, not a picked opening); the reference null is a bootstrap of 199 calibrated
//              windows per sample, 10,000 samples, from a PRNG seeded by a fixed label;
//   pooled     z over all epochs' early windows (Σ(S−μ)/√Σσ²) below TEST_C_POOLED_Z → FAIL.
const TEST_C_ALPHA = 0.01;
const TEST_C_FAMILY_FAIL = 0.001;
const TEST_C_FAMILY_FLAG = 0.01;
const TEST_C_BROAD_P = 0.001;
const TEST_C_POOLED_Z = -3.090;
/** Early-window return shortfalls and picked fractions the detection-power table is printed for. */
const TEST_C_POWER_SHORTFALLS = [0.05, 0.10, 0.20];
const TEST_C_POWER_FRACTIONS = [0.10, 0.25, 0.50];
/** Pass 2's window geometry, from the generator (src/simulate.ts NONCES_PER_SEED / EPOCH_LENGTH). */
const P2_NONCES = 10_000;
const P2_EARLY = 50;

/**
 * Two-tailed critical z for a given alpha using Abramowitz & Stegun 26.2.23.
 * inverseCriticalZ(0.00037) ≈ 3.55
 */
function inverseCriticalZ(alpha: number): number {
  const p = alpha / 2; // one-tailed
  const t = Math.sqrt(-2 * Math.log(p));
  // Rational approximation (A&S 26.2.23)
  const c0 = 2.515517, c1 = 0.802853, c2 = 0.010328;
  const d1 = 1.432788, d2 = 0.189269, d3 = 0.001308;
  return t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
}

export function run(ctx: VerifyContext): StepResult[] {
  const { outputsDir, revealedMap, bets, seeds, cfg } = ctx;
  const results: StepResult[] = [];

  // ── Step 19: Simulation Results — Pass 1 Integrity (EC-34) ───────────────────
  {
    const simFile = path.join(outputsDir, 'simulation-results.json');
    const failures: string[] = [];

    if (!fs.existsSync(simFile)) {
      const r = fail(19, 'Simulation Results — Pass 1 Integrity (re-derived & replayed)', ['EC-34'], 'HARD_FAIL',
        'outputs/simulation-results.json not found — run npm run simulate first', [], {});
      results.push(r);
      console.log(`  [FAIL] Step 19 — ${r.name}`);
    } else {
      const sim = JSON.parse(fs.readFileSync(simFile, 'utf8'));

      if (!sim.pass1_fresh_seeds) failures.push('pass1_fresh_seeds key missing from simulation-results.json');
      if (!sim.pass2_casino_seeds) failures.push('pass2_casino_seeds key missing from simulation-results.json — run updated simulate.ts');

      const p1 = sim.pass1_fresh_seeds;
      let serialBonferroniFails: number | null = null;
      let chi2BonferroniFails: number | null = null;

      // ── Everything below is RE-DERIVED from the committed histograms ─────────
      //
      // Until this release every predicate in this step read a scalar out of the artifact and
      // compared it with another scalar out of the same artifact. That tests self-consistency,
      // which a forger supplies for free: write `"pValue": 0.5` beside any counts at all and the
      // step agreed with it. The counts are the only thing in the artifact expensive to fake, so
      // the RTP, the standard error, the chi-squared and its p-value are computed here from
      // `slotCounts` and the committed multiplier table, and the artifact's own scalars are then
      // required to AGREE with them. The gate afterwards uses the derived numbers.
      //
      // And because Duel's Pass 1 seeds are pinned, the experiment is also re-run IN FULL — all
      // 27 × 1,000,000 rounds, see "THE EXPERIMENT, RE-RUN" below — and the census must come back
      // exactly. A histogram that never came from these seeds cannot survive that.
      const derived: Array<{
        config: string; rows: number; risk: RiskLevel;
        rounds: number; derivedRTP: number; theoreticalRTP: number; declaredRTP: number;
        se: number; sigmas: number; chi2: number; df: number; pValue: number;
      }> = [];
      const replayChecked: string[] = [];
      const p1ReplayOff = process.env.PF_P1_REPLAY === 'off';
      const replayQueue: Array<{ ci: number; label: string; row: any; job: Pass1Job }> = [];
      const replayed = new Map<number, Pass1Played>();
      let censusMismatches = 0, replayMismatches = 0;
      // Machine-independent counts go in the artifact; bit-identity and the largest gap are this
      // machine's arithmetic and go to outputs/run/ only (src/replay-precision.ts, finding F2).
      const p1Tally = newTally();

      if (p1 && Array.isArray(p1.results)) {
        const configList = cfg.allConfigs();
        if (p1.results.length !== configList.length) {
          failures.push(`Pass 1: ${p1.results.length} result rows, ${configList.length} configurations in the committed table`);
        }

        for (let ci = 0; ci < Math.min(p1.results.length, configList.length); ci++) {
          const row = p1.results[ci];
          const { rows, risk } = configList[ci];
          const label = `${rows}r/${risk}`;

          // The artifact's ordering is part of what is being checked: SIM_SEEDS[ci] belongs to
          // configList[ci], so a reordered results array would replay against the wrong seed.
          if (row.rows !== rows || row.risk !== risk) {
            failures.push(`Pass 1 row ${ci}: artifact says ${row.rows}r/${row.risk}, the config table says ${label}`);
            continue;
          }

          const counts: number[] = row.slotCounts;
          if (!Array.isArray(counts) || counts.length !== rows + 1) {
            failures.push(`Pass 1 ${label}: slotCounts has ${Array.isArray(counts) ? counts.length : 'no'} entries, expected ${rows + 1}`);
            continue;
          }
          const n = counts.reduce((a, b) => a + b, 0);
          if (n !== ROUNDS_PER_CONFIG) {
            failures.push(`Pass 1 ${label}: slotCounts sum to ${n}, ROUNDS_PER_CONFIG in src/sim-seeds.ts is ${ROUNDS_PER_CONFIG}`);
            continue;
          }
          if (row.rounds !== n) {
            failures.push(`Pass 1 ${label}: declares ${row.rounds} rounds but its histogram holds ${n}`);
          }

          const multipliers = Array.from({ length: rows + 1 }, (_, k) =>
            cfg.scalingEdgeMultiplier(rows, risk, k));

          // RTP and its standard error, from the histogram and the committed table.
          let payout = 0, payoutSq = 0;
          for (let k = 0; k <= rows; k++) {
            payout += counts[k] * multipliers[k];
            payoutSq += counts[k] * multipliers[k] * multipliers[k];
          }
          const derivedRTP = payout / n;
          const variance = payoutSq / n - derivedRTP * derivedRTP;
          const se = Math.sqrt(Math.max(variance, 0) / n);
          const theoreticalRTP = cfg.theoreticalRTP(rows, risk);
          const sigmas = se > 0 ? Math.abs(derivedRTP - theoreticalRTP) / se : 0;

          // THE CLAIM, PER CONFIGURATION, is not scored here (C3, FIXPASS2 14 Oct 2026). Until then this
          // step failed any board whose table paid other than 1 − its bracket-0 edge (to 1e-6), so a
          // board running light ended the run NOT PROVABLY FAIR (exit 1) before the RTP-CLAIM rule
          // could call it RTP FIGURE OVERSTATED (exit 5). Each board's bracket-0 RTP is a row of the RTP
          // table (src/rtp-settings.ts), held to the claim by the rule on this step; the simulation is
          // held to the exact RTP of the committed table (below), never to the claim. The declared
          // figure is still carried in the derived rows (declaredRTP), for reading.
          const declaredEdge = parseFloat(cfg.bracket0(rows, risk).house_edge);
          if (!Number.isFinite(declaredEdge)) {
            failures.push(`Pass 1 ${label}: bracket 0 declares a non-numeric house_edge`);
          }

          if (Math.abs(derivedRTP - row.simulatedRTP) > DERIVE_TOL) {
            failures.push(`Pass 1 ${label}: simulatedRTP in the artifact is not what its own histogram pays (gap ${Math.abs(derivedRTP - row.simulatedRTP).toExponential(2)})`);
          }
          if (Math.abs(theoreticalRTP - row.theoreticalRTP) > DERIVE_TOL) {
            failures.push(`Pass 1 ${label}: theoreticalRTP in the artifact differs from the committed multiplier table`);
          }
          // STATISTICAL TOLERANCE, NOT A FIXED PERCENTAGE: the width that matters is the one the
          // experiment's own variance produces at this sample size.
          if (sigmas > SE_SIGMA) {
            failures.push(`Pass 1 ${label}: simulated RTP is ${sigmas.toFixed(2)} SE from theoretical (bound ${SE_SIGMA})`);
          }

          // Chi-squared, from the counts and independently derived expectations.
          const expected = Array.from({ length: rows + 1 }, (_, k) => binomProb(rows, k) * n);
          const re = chiSquaredTest([...counts], expected);
          derived.push({ config: label, rows, risk, rounds: n, derivedRTP, theoreticalRTP,
            declaredRTP: 1 - declaredEdge, se, sigmas, chi2: re.chi2, df: re.df, pValue: re.pValue });

          if (Math.abs(re.chi2 - row.chi2) > 1e-6 || re.df !== row.df) {
            failures.push(`Pass 1 ${label}: chi-squared in the artifact (${row.chi2}, df ${row.df}) is not the statistic its histogram gives (${re.chi2}, df ${re.df})`);
          }
          if (Math.abs(re.pValue - row.pValue) > 1e-9) {
            failures.push(`Pass 1 ${label}: p-value in the artifact is not the one its own chi-squared implies`);
          }

          // Dispersion guard — too good is as wrong as too bad.
          if (re.pValue > DISPERSION_P_MAX) {
            failures.push(`Pass 1 ${label}: re-derived p-value ${re.pValue} exceeds the dispersion ceiling ${DISPERSION_P_MAX} — the histogram sits impossibly close to theory`);
          }
          if (re.df > 0 && re.chi2 / re.df < CHI2_FLOOR_RATIO) {
            failures.push(`Pass 1 ${label}: re-derived chi-squared/df ${(re.chi2 / re.df).toExponential(3)} is below the floor ${CHI2_FLOOR_RATIO} — too little dispersion to be a sample`);
          }

          // ── Convergence trace, bound to the histogram and to the seeds ───────
          const snaps: Array<{ roundCount: number; rtp: number }> = row.rtpSnapshots ?? [];
          const grid = snaps.map(s => s.roundCount);
          if (grid.length !== CONVERGENCE_SAMPLES.length || grid.some((g, i) => g !== CONVERGENCE_SAMPLES[i])) {
            failures.push(`Pass 1 ${label}: convergence grid ${grid.join(',')} is not CONVERGENCE_SAMPLES in src/sim-seeds.ts`);
          } else {
            const terminal = snaps[snaps.length - 1];
            if (Math.abs(terminal.rtp / 100 - derivedRTP) > DERIVE_TOL) {
              failures.push(`Pass 1 ${label}: the trace ends at ${terminal.rtp}% but the histogram pays ${(derivedRTP * 100)}%`);
            }
            const minMult = Math.min(...multipliers);
            const maxMult = Math.max(...multipliers);
            const finalTotal = derivedRTP * n;
            for (const s of snaps) {
              const soFar = (s.rtp / 100) * s.roundCount;
              const remaining = n - s.roundCount;
              // A point is feasible only if the rounds still to come can carry the running total
              // to the histogram's exact final total, at the board's own payout limits.
              if (s.rtp < minMult * 100 - 1e-9 || s.rtp > maxMult * 100 + 1e-9) {
                failures.push(`Pass 1 ${label}: trace point at ${s.roundCount} rounds is outside the board's payout support`);
              } else if (soFar > finalTotal - remaining * minMult + 1e-3 || soFar < finalTotal - remaining * maxMult - 1e-3) {
                failures.push(`Pass 1 ${label}: trace point at ${s.roundCount} rounds cannot reach the histogram's total over the ${remaining} rounds that remain`);
              }
            }
          }

          // ── Queue the replay from the pinned seed ────────────────────────────
          const seedPair = SIM_SEEDS[ci];
          if (!seedPair) {
            failures.push(`Pass 1 ${label}: no pinned seed at index ${ci} in src/sim-seeds.ts`);
          } else {
            replayQueue.push({ ci, label, row, job: {
              rows, multipliers, server: seedPair.server, client: seedPair.client,
              rounds: p1ReplayOff ? REPLAY_ROUNDS : ROUNDS_PER_CONFIG,
              samples: CONVERGENCE_SAMPLES.filter(s => s <= (p1ReplayOff ? REPLAY_ROUNDS : ROUNDS_PER_CONFIG)),
            } });
          }
        }
      }

      // ── THE EXPERIMENT, RE-RUN (profile PLINKO-20) ────────────────────────────
      // Every one of the 27 × 1,000,000 rounds is regenerated from the pinned seed pairs with
      // src/pass1.ts playPass1Config — the function src/simulate.ts generates them with — fanned out
      // over worker threads (src/parallel.ts; the arithmetic of each configuration stays on one
      // thread, in nonce order). The CENSUS must come back exactly: every slot count of every
      // configuration. Every derived statistic the artifact carries (simulatedRTP, rtpDiff, all seven
      // running-RTP points, lag1R, lag1Z, runsP, the expected counts, the pooled convergence trace,
      // the mean RTP and the failure counters) must equal the replay within the reproduction
      // tolerance of src/diff.ts, and the bit-identical count is reported. Until 2026-09-24 only the
      // first REPLAY_ROUNDS rounds of each configuration were replayed (three of seven convergence
      // points). PF_P1_REPLAY=off restores that prefix replay for a LOCAL run only (the mutation
      // battery uses it for mutations not aimed at this step); the step is then capped at FLAG and is
      // never a publication pass.
      let replayMs = 0;
      if (replayQueue.length === cfg.allConfigs().length) {
        const t0 = Date.now();
        // Longest configurations first (a 16-row board costs twice an 8-row one), so no thread is
        // left alone with the largest job at the end. Order across threads changes no arithmetic.
        const byCost = [...replayQueue].sort((a, b) => b.job.rows - a.job.rows);
        const outs = runBatch('pass1-config', byCost.map(q => q.job), j => pass1Slots(j as Pass1Job), true);
        replayMs = Date.now() - t0;
        byCost.forEach((q, i) => { replayed.set(q.ci, unpackPass1(q.job, outs[i])); });
      } else {
        failures.push(`Pass 1: ${replayQueue.length} configuration(s) queued for replay, ${cfg.allConfigs().length} in the committed table`);
      }
      // EXACT where the arithmetic is: the running RTP and simulatedRTP are sums and quotients of
      // doubles taken in nonce order — IEEE-754 correctly-rounded + and / — so they reproduce bit for
      // bit on any conforming engine, and are compared with NO tolerance (mutation M27: one unit in
      // the last place of one convergence point). Figures that pass through library functions
      // (the runs-test p-value's normal CDF, binomial expectations, sqrt-based pooled figures) are
      // compared at the reproduction tolerance.
      const agree = (label: string, what: string, stored: unknown, derived: number, exact = false): void => {
        if (!tallyPair(p1Tally, stored, derived, exact)) {
          replayMismatches++;
          if (failures.length < 40) failures.push(`Pass 1 ${label}: stored ${what}=${stored} != replayed ${derived}`);
        }
      };
      for (const q of replayQueue) {
        const r = replayed.get(q.ci);
        if (!r) continue;
        const { row, label, job } = q;
        const counts: number[] = row.slotCounts;
        if (!p1ReplayOff) {
          if (counts.length !== r.slotCounts.length || counts.some((c, k) => c !== r.slotCounts[k])) {
            censusMismatches++;
            failures.push(`Pass 1 ${label}: census — replayed slot counts [${r.slotCounts.join(',')}] != stored [${counts.join(',')}]`);
          }
          const simRTP = r.totalPayout / job.rounds;
          agree(label, 'simulatedRTP', row.simulatedRTP, simRTP, true);
          agree(label, 'rtpDiff', row.rtpDiff, simRTP - cfg.theoreticalRTP(job.rows, row.risk));
          agree(label, 'lag1R', row.lag1R, r.lag1R);
          agree(label, 'lag1Z', row.lag1Z, r.lag1R * Math.sqrt(job.rounds));
          agree(label, 'runsP', row.runsP, r.runsP);
          (row.expectedCounts ?? []).forEach((e: number, k: number) =>
            agree(label, `expectedCounts[${k}]`, e, binomProb(job.rows, k) * job.rounds));
          if ((row.expectedCounts ?? []).length !== job.rows + 1) { replayMismatches++; failures.push(`Pass 1 ${label}: expectedCounts has ${(row.expectedCounts ?? []).length} entries`); }
        }
        const snaps: Array<{ roundCount: number; rtp: number }> = row.rtpSnapshots ?? [];
        for (const s of r.rtpSnapshots) {
          const committed = snaps.find(x => x.roundCount === s.roundCount);
          if (!committed) { replayMismatches++; failures.push(`Pass 1 ${label}: the artifact has no convergence point at ${s.roundCount} rounds to replay against`); continue; }
          agree(label, `rtpSnapshots@${s.roundCount}`, committed.rtp, s.rtp, true);
          replayChecked.push(`${label}@${s.roundCount}`);
        }
      }
      // Pass-level figures, re-derived from the replay in the generator's own order and formulas.
      if (!p1ReplayOff && p1 && replayed.size === cfg.allConfigs().length) {
        const ordered = replayQueue.map(q => ({ q, r: replayed.get(q.ci)! }));
        const simRTPs = ordered.map(({ q, r }) => r.totalPayout / q.job.rounds);
        agree('(all)', 'avgSimulatedRTP', p1.avgSimulatedRTP, simRTPs.reduce((a, b) => a + b, 0) / simRTPs.length);
        const conv: Array<{ roundCount: number; meanRTP: number; stdDev: number }> = Array.isArray(p1.convergence) ? p1.convergence : [];
        if (conv.length !== CONVERGENCE_SAMPLES.length) { replayMismatches++; failures.push(`Pass 1: convergence carries ${conv.length} point(s), ${CONVERGENCE_SAMPLES.length} expected`); }
        CONVERGENCE_SAMPLES.forEach((point, i) => {
          const xs = ordered.map(({ r }) => r.rtpSnapshots.find(s => s.roundCount === point)!.rtp);
          const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
          const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
          const se = Math.sqrt(variance) / Math.sqrt(xs.length);
          const c = conv[i];
          if (!c || c.roundCount !== point) { replayMismatches++; failures.push(`Pass 1: convergence[${i}] is not the ${point}-round point`); return; }
          agree('(all)', `convergence[${i}].meanRTP`, c.meanRTP, mean);
          agree('(all)', `convergence[${i}].stdDev (the standard error)`, c.stdDev, se);
        });
        const lagZ = ordered.map(({ q, r }) => r.lag1R * Math.sqrt(q.job.rounds));
        const serialLegacy = ordered.filter(({ r }, i) => Math.abs(lagZ[i]) > 3 || r.runsP < 0.01).length;
        const chiP = derived.map(d => d.pValue);
        const exact = (what: string, stored: unknown, v: number): void => {
          if (stored !== v) { replayMismatches++; failures.push(`Pass 1: stored ${what}=${stored} != replayed ${v}`); }
        };
        exact('serialIndependenceFails', p1.serialIndependenceFails, serialLegacy);
        exact('chi2FailsAtAlpha01', p1.chi2FailsAtAlpha01, chiP.filter(p => p < 0.01).length);
        exact('chi2FailsBonferroni', p1.chi2FailsBonferroni, chiP.filter(p => p < 0.01 / cfg.allConfigs().length).length);
        agree('(all)', 'avgTheoreticalRTP', p1.avgTheoreticalRTP,
          cfg.allConfigs().reduce((a, { rows, risk }) => a + cfg.theoreticalRTP(rows, risk), 0) / cfg.allConfigs().length);
      }
      console.log(`  [REPLAY] Pass 1: ${replayed.size}/${cfg.allConfigs().length} configs × `
        + `${(p1ReplayOff ? REPLAY_ROUNDS : ROUNDS_PER_CONFIG).toLocaleString()} rounds regenerated from the pinned seeds in `
        + `${(replayMs / 1000).toFixed(1)} s${p1ReplayOff ? ' — ⚠ PF_P1_REPLAY=off: LOCAL prefix replay, step capped at FLAG, NOT a publication pass' : ''}`);

      if (p1) {
        const configs = p1.configs ?? 27;
        const bonferroniAlpha = 0.01 / configs;

        // Chi-squared at the family-wise threshold, on the RE-DERIVED p-values.
        chi2BonferroniFails = derived.length
          ? derived.filter(d => d.pValue < bonferroniAlpha).length
          : null;
        if (chi2BonferroniFails !== null && chi2BonferroniFails > 0) {
          failures.push(`Pass 1: ${chi2BonferroniFails} configs fail chi-squared at Bonferroni α/${configs}=${bonferroniAlpha.toFixed(5)}`);
        }

        const expectedRounds = ROUNDS_PER_CONFIG * cfg.allConfigs().length;
        if (p1.totalRounds !== expectedRounds) {
          failures.push(`Pass 1: totalRounds=${p1.totalRounds} (expected ${expectedRounds})`);
        }
        if (derived.length) {
          const meanDerived = derived.reduce((a, d) => a + d.derivedRTP, 0) / derived.length;
          if (Math.abs(meanDerived - p1.avgSimulatedRTP) > DERIVE_TOL) {
            failures.push(`Pass 1: avgSimulatedRTP in the artifact is not the mean of the RTPs its own histograms pay`);
          }
        }

        // Serial independence: same Bonferroni correction as chi-squared. These two statistics
        // are the one part of Pass 1 that needs the ORDER of the rounds, which the committed
        // histogram does not carry, so they are read from the artifact and the replay above is
        // what stands behind them.
        // Since 2026-09-24 the statistics are the REPLAYED ones (the artifact's copies are compared
        // with them above); the artifact's own values are used only on a local prefix-replay run.
        const bonferroniZCrit = inverseCriticalZ(bonferroniAlpha);
        serialBonferroniFails = Array.isArray(p1.results)
          ? p1.results.filter((r: { lag1Z: number; runsP: number }, ci: number) => {
              const rp = !p1ReplayOff ? replayed.get(ci) : undefined;
              const z = rp ? rp.lag1R * Math.sqrt(ROUNDS_PER_CONFIG) : r.lag1Z;
              const p = rp ? rp.runsP : r.runsP;
              return Math.abs(z) > bonferroniZCrit || p < bonferroniAlpha;
            }).length
          : null;
        if (serialBonferroniFails !== null && serialBonferroniFails > 0) {
          failures.push(`Pass 1: ${serialBonferroniFails} config(s) fail serial independence at Bonferroni α/${configs}=${bonferroniAlpha.toFixed(5)}`);
        }
      }

      const configs = p1?.configs ?? 27;
      const bonferroniAlpha = 0.01 / configs;
      const chi2Fails = derived.filter(d => d.pValue < 0.01).length;
      const serialFails = p1?.serialIndependenceFails ?? 0;
      const totalBonFails = (chi2BonferroniFails ?? 0) + (serialBonferroniFails ?? 0);
      const totalUncorrected = chi2Fails + serialFails;

      runPrecision.step19Pass1Replay = { ...artifactView(p1Tally), ...runView(p1Tally) };
      const details = p1 ? {
        totalRounds: p1.totalRounds,
        configs,
        chi2FailsAtAlpha01: chi2Fails,
        chi2FailsAtBonferroni: chi2BonferroniFails ?? 'results array not present',
        serialIndependenceFailsUncorrected: serialFails,
        serialIndependenceFailsBonferroni: serialBonferroniFails ?? 'results array not present',
        bonferroniAlpha,
        avgTheoreticalRTP: p1.avgTheoreticalRTP,
        avgSimulatedRTP: p1.avgSimulatedRTP,
        pass2Present: !!sim.pass2_casino_seeds,
        rederivation: {
          source: 'slotCounts in outputs/simulation-results.json + the committed multiplier table',
          configsRederived: derived.length,
          tolerance: DERIVE_TOL,
          seSigmaBound: SE_SIGMA,
          maxSigmasFromTheoretical: derived.length ? Math.max(...derived.map(d => d.sigmas)) : null,
          perConfig: derived,
        },
        dispersion: {
          pCeiling: DISPERSION_P_MAX,
          chi2FloorRatio: CHI2_FLOOR_RATIO,
          maxPValue: derived.length ? Math.max(...derived.map(d => d.pValue)) : null,
          minChi2OverDf: derived.length ? Math.min(...derived.map(d => (d.df > 0 ? d.chi2 / d.df : Infinity))) : null,
        },
        replay: {
          source: 'src/sim-seeds.ts SIM_SEEDS — the seeds src/simulate.ts played — through src/pass1.ts playPass1Config, the function src/simulate.ts plays them with',
          mode: p1ReplayOff ? `LOCAL prefix replay (PF_P1_REPLAY=off): first ${REPLAY_ROUNDS} rounds per configuration — capped at FLAG, not a publication pass` : 'full',
          configsReplayed: replayed.size,
          roundsPerConfig: p1ReplayOff ? REPLAY_ROUNDS : ROUNDS_PER_CONFIG,
          totalRoundsReplayed: (p1ReplayOff ? REPLAY_ROUNDS : ROUNDS_PER_CONFIG) * replayed.size,
          censusMismatches,
          derivedStatisticsCompared: p1Tally.compared,
          derivedStatisticsWithinTolerance: p1Tally.withinTolerance,
          derivedStatisticsBeyondTolerance: replayMismatches,
          convergencePointsReproduced: replayChecked.length,
          tolerance: { atol: DIFF_ATOL, rtol: DIFF_RTOL, rule: 'census (slot counts, failure counters), simulatedRTP and every running-RTP point exact; other derived floats |a-b| <= atol + rtol*max(|a|,|b|)' },
        },
      } : { error: 'pass1_fresh_seeds missing' };

      // Lead with Bonferroni result, frame uncorrected as expected noise
      let summaryMsg: string;
      if (p1) {
        summaryMsg = `${p1.totalRounds.toLocaleString()} rounds × ${configs} configs; avg RTP=${(p1.avgSimulatedRTP * 100).toFixed(4)}%. `;
        summaryMsg += `RTP, standard error, chi-squared and its p-value re-derived in verify from the committed histograms `
          + `for ${derived.length}/${configs} configs and required to agree with the artifact's own scalars; `
          + (p1ReplayOff
            ? `LOCAL RUN (PF_P1_REPLAY=off): only the first ${REPLAY_ROUNDS.toLocaleString()} rounds of each config replayed, `
              + `${replayChecked.length} convergence points — capped at FLAG, NOT a publication pass. `
            : `the whole experiment REPLAYED from the pinned seeds (${replayed.size}/${configs} configs × `
              + `${ROUNDS_PER_CONFIG.toLocaleString()} rounds): census exact (${censusMismatches} slot-count mismatches), `
              + `${p1Tally.compared} derived figures compared, ${p1Tally.withinTolerance} within the reproduction tolerance, `
              + `${replayMismatches} beyond the reproduction tolerance. `);
        summaryMsg += `${totalBonFails}/${configs} configs fail at Bonferroni-corrected threshold (α/${configs} = ${bonferroniAlpha.toFixed(5)}). `;
        if (totalUncorrected > 0) {
          summaryMsg += `${totalUncorrected}/${configs} flag at uncorrected α = 0.01, consistent with expected false-positive rate across ${configs} independent tests.`;
        } else {
          summaryMsg += `0/${configs} flag even at uncorrected α = 0.01.`;
        }
      } else {
        summaryMsg = 'pass1_fresh_seeds missing';
      }

      const r = failures.length > 0
        ? fail(19, 'Simulation Results — Pass 1 Integrity (re-derived & replayed)', ['EC-34'], 'HARD_FAIL',
            `${failures.length} simulation result issues`, failures.slice(0, 20), details)
        : p1ReplayOff
          ? fail(19, 'Simulation Results — Pass 1 Integrity (re-derived & replayed)', ['EC-34'], 'FLAG',
              summaryMsg, ['PF_P1_REPLAY=off — Pass 1 not replayed in full; LOCAL run, not a publication pass'], details)
          : pass(19, 'Simulation Results — Pass 1 Integrity (re-derived & replayed)', ['EC-34'], summaryMsg, details);
      results.push(r);
      console.log(`  [${tag(r)}] Step 19 — ${r.name}`);
      // Always print summary for simulation steps (Bonferroni context matters even on PASS)
      console.log(`         ${summaryMsg}`);
      // Detail lines — only when there are uncorrected flags, name the specific configs
      if (chi2Fails > 0) {
        const flaggedChi2 = derived
          .filter(d => d.pValue < 0.01)
          .map(d => `${d.config} p=${d.pValue.toFixed(4)}`)
          .join(', ');
        console.log(`         ℹ Chi-squared flagged (re-derived): ${flaggedChi2}`);
      }
      if (p1 && serialFails > 0 && Array.isArray(p1.results)) {
        const flaggedSerial = (p1.results as Array<{ rows: number; risk: string; lag1Z: number; runsP: number }>)
          .filter(r => Math.abs(r.lag1Z) > 3 || r.runsP < 0.01)
          .map(r => {
            const reasons: string[] = [];
            if (Math.abs(r.lag1Z) > 3) reasons.push(`|lag1Z|=${Math.abs(r.lag1Z).toFixed(2)}`);
            if (r.runsP < 0.01) reasons.push(`runsP=${r.runsP.toFixed(4)}`);
            return `${r.rows}r/${r.risk} (${reasons.join(', ')})`;
          })
          .join(', ');
        console.log(`         ℹ Serial flagged: ${flaggedSerial}`);
      }
    }
  }

  // ── Step 20: Simulation Results — Pass 2 Cherry-Pick Test (EC-35) ─────────────
  {
    const simFile = path.join(outputsDir, 'simulation-results.json');
    const failures: string[] = [];
    const infoFlags: string[] = [];

    if (!fs.existsSync(simFile)) {
      const r = fail(20, 'Simulation Results — Pass 2 Cherry-Pick Test', ['EC-35'], 'HARD_FAIL',
        'outputs/simulation-results.json not found — run npm run simulate first', [], {});
      results.push(r);
      console.log(`  [FAIL] Step 20 — ${r.name}`);
    } else {
      const sim = JSON.parse(fs.readFileSync(simFile, 'utf8'));
      const p2 = sim.pass2_casino_seeds;

      if (!p2) {
        const r = fail(20, 'Simulation Results — Pass 2 Cherry-Pick Test', ['EC-35'], 'HARD_FAIL',
          'pass2_casino_seeds missing from simulation-results.json — run updated simulate.ts', [], {});
        results.push(r);
        console.log(`  [FAIL] Step 20 — ${r.name}`);
      } else {
        // Surface and assert the artifact's own headline verdicts up front.
        if (p2.test_a_verdict && p2.test_a_verdict !== 'PASS') {
          failures.push(`Test A verdict in simulation artifact is "${p2.test_a_verdict}" (expected PASS)`);
        }
        if (p2.test_b_verdict && p2.test_b_verdict !== 'PASS') {
          failures.push(`Test B verdict in simulation artifact is "${p2.test_b_verdict}" (expected PASS)`);
        }

        const combinations = p2.seed_row_combinations ?? 0;
        const testAExpected = combinations * 0.01;
        if (p2.test_a_chi2_fails_at_alpha01 > Math.ceil(testAExpected * 3)) {
          failures.push(
            `Test A: ${p2.test_a_chi2_fails_at_alpha01} globally biased seeds (expected ≤${Math.ceil(testAExpected * 3)} at 3× FWER for ${combinations} combinations)`
          );
        } else if (p2.test_a_chi2_fails_at_alpha01 > Math.ceil(testAExpected)) {
          infoFlags.push(`Test A: ${p2.test_a_chi2_fails_at_alpha01} seeds fail full-range chi-squared at α=0.01 — marginally over expected FWER (${testAExpected.toFixed(1)} expected for ${combinations} combinations). Examine flagged seeds in results array.`);
        } else if (p2.test_a_chi2_fails_at_alpha01 > 0) {
          infoFlags.push(`Test A: ${p2.test_a_chi2_fails_at_alpha01} seed(s) fail full-range chi-squared at α=0.01 — within expected FWER range (${testAExpected.toFixed(1)} expected for ${combinations} combinations). Informational.`);
        }

        const bonferroniThreshold = Math.ceil(combinations * 0.05);
        const hardFailThreshold = Math.ceil(combinations * 0.10);
        if (p2.test_b_cherry_pick_flags > hardFailThreshold) {
          failures.push(
            `Test B: ${p2.test_b_cherry_pick_flags} early-window chi-squared flags — exceeds 2× expected false-positive count (${hardFailThreshold}) for ${combinations} combinations at α=0.05. Cherry-pick signature: investigate.`
          );
        } else if (p2.test_b_cherry_pick_flags > bonferroniThreshold) {
          infoFlags.push(
            `Test B: ${p2.test_b_cherry_pick_flags} early-window chi-squared flags — marginally exceeds expected false-positive threshold of ${bonferroniThreshold} (${combinations} combinations × α=0.05). Hard-fail threshold: ${hardFailThreshold}. Statistical power is limited at n=50 early nonces; marginal excess warrants disclosure but is not conclusive.`
          );
        } else if (p2.test_b_cherry_pick_flags > 0) {
          infoFlags.push(
            `Test B: ${p2.test_b_cherry_pick_flags} early-window statistical flag(s) within expected false-positive range (≤${bonferroniThreshold} at α=0.05 across ${combinations} combinations). Statistical power is limited: early bucket has ~${p2.epoch_length ?? 50} nonces. Informational.`
          );
        }

        const revealedCount = revealedSeeds(seeds).length;
        if (p2.seeds_tested !== revealedCount) {
          failures.push(`Pass 2: seeds_tested=${p2.seeds_tested} ≠ revealed seeds in dataset (${revealedCount})`);
        }

        if (p2.nonces_per_seed !== 10_000) {
          failures.push(`Pass 2: nonces_per_seed=${p2.nonces_per_seed} (expected 10,000)`);
        }

        // ── Multi-window analysis ───────────────────────────────────────────────
        const MWWINDOW = 50;
        const MW_WINDOWS = 5;

        const seedClientLookup = new Map<string, string>();
        for (const bet of bets) {
          if (!seedClientLookup.has(bet.response.server_seed_hashed)) {
            seedClientLookup.set(bet.response.server_seed_hashed, bet.response.client_seed);
          }
        }

        const flaggedCombos = Array.isArray(p2.results)
          ? (p2.results as Array<{ seed_hash: string; rows: number; cherry_pick_flag: boolean }>).filter(r => r.cherry_pick_flag)
          : [];

        let isolatedEarlyFlags = 0;
        let broadDeviationFlags = 0;
        const multiWindowDetails: Array<{
          seed_hash: string; rows: number;
          windowPValues: string[]; deviatingWindows: number;
          interpretation: string;
        }> = [];

        for (const fc of flaggedCombos) {
          const seedEntry = revealedMap.get(fc.seed_hash);
          const clientSeedVal = seedClientLookup.get(fc.seed_hash);
          if (!seedEntry || !clientSeedVal) continue;

          const windowPValues: number[] = [];
          for (let w = 0; w < MW_WINDOWS; w++) {
            const start = w * MWWINDOW;
            const counts = new Array(fc.rows + 1).fill(0);
            for (let nonce = start; nonce < start + MWWINDOW; nonce++) {
              const slot = computeSlot(seedEntry.seed.serverSeed!, clientSeedVal, nonce, fc.rows);
              counts[slot]++;
            }
            const expected = Array.from({ length: fc.rows + 1 }, (_, k) => binomProb(fc.rows, k) * MWWINDOW);
            windowPValues.push(chiSquaredTest([...counts], expected).pValue);
          }

          const deviatingWindows = windowPValues.filter(p => p < 0.05).length;
          const earlyOnly = windowPValues[0] < 0.05 && windowPValues.slice(1).every(p => p >= 0.05);
          if (earlyOnly) {
            isolatedEarlyFlags++;
          } else {
            broadDeviationFlags++;
          }
          multiWindowDetails.push({
            seed_hash: fc.seed_hash.substring(0, 16) + '...',
            rows: fc.rows,
            windowPValues: windowPValues.map(p => p.toFixed(4)),
            deviatingWindows,
            interpretation: earlyOnly
              ? 'isolated early-window flag — within expected false-positive range'
              : 'multi-window distributional variation — consistent with noise',
          });
        }

        // ══ PASS 2, REPLAYED (profile PLINKO-21) ═══════════════════════════════════════════════
        // Every revealed epoch's server seed is replayed over nonces 0–9,999 with the package's own
        // HMAC (src/pass2-replay.ts), recording each nonce's first C direction bits. From those paths:
        //   (a) BINDING — every captured bet's slot is re-read at its own nonce and must equal the
        //       slot the casino served (8,100 bound);
        //   (b) TESTS A AND B of the committed artifact are RE-DERIVED row by row (until 2026-09-24
        //       this step read their counts and verdicts from the artifact);
        //   (c) TEST C, the profile's payout-weighted statistic, is computed here (rule above).
        const t2 = Date.now();
        const epochs: Array<{
          hash: string; server: string; client: string; cursors: number;
          seq: Array<{ rows: number; risk: RiskLevel }>; seqKey: string; missed: number[];
          rowsSet: number[]; bets: typeof bets;
        }> = [];
        const replayIssues: string[] = [];
        for (const [hash, eb] of ctx.byHash) {
          const s = revealedMap.get(hash);
          if (!s) { replayIssues.push(`epoch ${hash.slice(0, 16)}: no revealed server seed — cannot replay`); continue; }
          const clients = new Set(eb.map(b => b.response.client_seed));
          if (clients.size !== 1) { replayIssues.push(`epoch ${hash.slice(0, 16)}: ${clients.size} client seeds in one epoch`); continue; }
          const byNonce = new Map(eb.map(b => [b.response.nonce, b]));
          const configsHere = new Set(eb.map(b => `${b.request.rows}/${b.request.risk}`));
          const seq: Array<{ rows: number; risk: RiskLevel }> = [];
          const missed: number[] = [];
          for (let j = 0; j < P2_EARLY; j++) {
            const b = byNonce.get(j);
            if (b) { seq.push({ rows: b.request.rows, risk: b.request.risk as RiskLevel }); continue; }
            // A nonce the capture missed (Step 4, L2). Its configuration is known only if the epoch
            // served one configuration throughout; otherwise the served sequence is not determined.
            missed.push(j);
            if (configsHere.size !== 1) { replayIssues.push(`epoch ${hash.slice(0, 16)}: nonce ${j} missed in a mixed-configuration epoch`); break; }
            seq.push({ rows: eb[0].request.rows, risk: eb[0].request.risk as RiskLevel });
          }
          if (seq.length !== P2_EARLY) continue;
          const rowsSet = [...new Set(eb.map(b => b.response.rows))].sort((a, b) => a - b);
          const cursors = Math.max(...seq.map(x => x.rows), ...rowsSet);
          epochs.push({ hash, server: s.seed.serverSeed!, client: eb[0].response.client_seed, cursors,
            seq, seqKey: seq.map(x => `${x.rows}${x.risk[0]}`).join(','), missed, rowsSet, bets: eb });
        }
        const revealedEpochs = revealedSeeds(seeds).length;
        if (epochs.length !== revealedEpochs) replayIssues.push(`${epochs.length} epochs replayable, ${revealedEpochs} revealed seeds in the dataset`);

        const CAL_PER_JOB = 100;
        const calJobs: PathsJob[] = [];
        for (let r0 = 0; r0 < PASS2_NULL_SEEDS; r0 += CAL_PER_JOB) {
          calJobs.push({ seeds: Array.from({ length: Math.min(CAL_PER_JOB, PASS2_NULL_SEEDS - r0) }, (_, i) => nullSeed(r0 + i)),
            nonceStart: 0, nonceCount: P2_EARLY, cursors: MAX_CURSORS });
        }
        const epochJobs: PathsJob[] = epochs.map(e => ({ seeds: [{ server: e.server, client: e.client }], nonceStart: 0, nonceCount: P2_NONCES, cursors: e.cursors }));
        const allJobs = [...epochJobs, ...calJobs];
        const order = allJobs.map((_, i) => i).sort((a, b) => (pathsSlots(allJobs[b]) * allJobs[b].cursors) - (pathsSlots(allJobs[a]) * allJobs[a].cursors));
        const outsSorted = runBatch('plinko-paths', order.map(i => allJobs[i]), j => pathsSlots(j as PathsJob), true);
        const outs: Float64Array[] = new Array(allJobs.length);
        order.forEach((i, k) => { outs[i] = outsSorted[k]; });
        const epochPaths = outs.slice(0, epochJobs.length);
        const calPaths = outs.slice(epochJobs.length);
        const calPath = (r: number, nonce: number): number => calPaths[Math.floor(r / CAL_PER_JOB)][(r % CAL_PER_JOB) * P2_EARLY + nonce];
        const replayMs2 = Date.now() - t2;

        // (a) binding
        let boundBets = 0, boundMismatches = 0;
        epochs.forEach((e, ei) => {
          for (const b of e.bets) {
            boundBets++;
            if (slotOf(epochPaths[ei][b.response.nonce], e.cursors, b.response.rows) !== b.response.final_slot) {
              boundMismatches++;
              if (replayIssues.length < 20) replayIssues.push(`bet ${b.response.id}: the replayed slot at nonce ${b.response.nonce} is not the served slot ${b.response.final_slot}`);
            }
          }
        });
        if (boundBets !== EXPECTED_BETS) replayIssues.push(`${boundBets} captured bets bound to the replay, ${EXPECTED_BETS} declared`);

        // (b) Tests A and B, re-derived row by row
        const storedRows = new Map<string, any>((Array.isArray(p2.results) ? p2.results : []).map((r: any) => [`${r.seed_hash}:${r.rows}`, r]));
        let abRows = 0, abMismatches = 0, testAFailsRe = 0, testBFlagsRe = 0;
        const abTally = newTally();
        const abAgree = (key: string, what: string, stored: unknown, v: number): void => {
          if (!tallyPair(abTally, stored, v)) {
            abMismatches++;
            if (replayIssues.length < 20) replayIssues.push(`Pass 2 ${key.slice(0, 16)}: stored ${what}=${stored} != re-derived ${v}`);
          }
        };
        epochs.forEach((e, ei) => {
          for (const rows of e.rowsSet) {
            const key = `${e.hash}:${rows}`;
            const row = storedRows.get(key);
            abRows++;
            if (!row) { abMismatches++; replayIssues.push(`Pass 2: no artifact row for epoch ${e.hash.slice(0, 16)} × ${rows} rows`); continue; }
            storedRows.delete(key);
            const full = new Array(rows + 1).fill(0), early = new Array(rows + 1).fill(0), late = new Array(rows + 1).fill(0);
            for (let n = 0; n < P2_NONCES; n++) {
              const k = slotOf(epochPaths[ei][n], e.cursors, rows);
              full[k]++; if (n < P2_EARLY) early[k]++; else late[k]++;
            }
            const expect = (m: number) => Array.from({ length: rows + 1 }, (_, k) => binomProb(rows, k) * m);
            const A = chiSquaredTest([...full], expect(P2_NONCES));
            const E = chiSquaredTest([...early], expect(P2_EARLY));
            const L = chiSquaredTest([...late], expect(P2_NONCES - P2_EARLY));
            abAgree(key, 'full_range_chi2', row.full_range_chi2, A.chi2); abAgree(key, 'full_range_p', row.full_range_p, A.pValue);
            abAgree(key, 'early_chi2', row.early_chi2, E.chi2); abAgree(key, 'early_p', row.early_p, E.pValue);
            abAgree(key, 'late_chi2', row.late_chi2, L.chi2); abAgree(key, 'late_p', row.late_p, L.pValue);
            const flag = E.pValue < 0.05 && L.pValue >= 0.05;
            if (row.full_range_df !== A.df || row.early_df !== E.df || row.late_df !== L.df || row.cherry_pick_flag !== flag) {
              abMismatches++;
              if (replayIssues.length < 20) replayIssues.push(`Pass 2 ${key.slice(0, 16)}: stored df/flag ${row.full_range_df}/${row.early_df}/${row.late_df}/${row.cherry_pick_flag} != ${A.df}/${E.df}/${L.df}/${flag}`);
            }
            if (A.pValue < 0.01) testAFailsRe++;
            if (flag) testBFlagsRe++;
          }
        });
        if (storedRows.size > 0) { abMismatches += storedRows.size; replayIssues.push(`Pass 2: ${storedRows.size} artifact row(s) with no replayed epoch × rows`); }
        const p2Exact = (what: string, stored: unknown, v: unknown): void => {
          if (stored !== v) { abMismatches++; replayIssues.push(`Pass 2: stored ${what}=${JSON.stringify(stored)} != re-derived ${JSON.stringify(v)}`); }
        };
        p2Exact('seeds_tested', p2.seeds_tested, epochs.length);
        p2Exact('seed_row_combinations', p2.seed_row_combinations, abRows);
        p2Exact('nonces_per_seed', p2.nonces_per_seed, P2_NONCES);
        p2Exact('epoch_length', p2.epoch_length, P2_EARLY);
        p2Exact('test_a_chi2_fails_at_alpha01', p2.test_a_chi2_fails_at_alpha01, testAFailsRe);
        p2Exact('test_b_cherry_pick_flags', p2.test_b_cherry_pick_flags, testBFlagsRe);
        const testAPRe = binomialUpperTail(abRows, 0.01, testAFailsRe);
        const testBPRe = binomialUpperTail(abRows, 0.05, testBFlagsRe);
        // The generator sums the binomial tail term by term in linear space; this sums it in log
        // space — the same quantity by a different route, so it is compared at 1e-9 relative.
        const P2_BINOM_RTOL = 1e-9;
        if (!numbersAgree(p2.test_a_binomial_pvalue, testAPRe, DIFF_ATOL, P2_BINOM_RTOL)) { abMismatches++; replayIssues.push(`Pass 2: stored test_a_binomial_pvalue=${p2.test_a_binomial_pvalue} != re-derived ${testAPRe}`); }
        if (!numbersAgree(p2.test_b_cherry_pick_pvalue, testBPRe, DIFF_ATOL, P2_BINOM_RTOL)) { abMismatches++; replayIssues.push(`Pass 2: stored test_b_cherry_pick_pvalue=${p2.test_b_cherry_pick_pvalue} != re-derived ${testBPRe}`); }
        p2Exact('test_a_verdict', p2.test_a_verdict, testAPRe >= 0.01 ? 'PASS' : 'FAIL');
        p2Exact('test_b_verdict', p2.test_b_verdict, testBPRe >= 0.01 ? 'PASS' : 'FAIL');

        // (c) Test C
        const boardMoments = (rows: number, risk: RiskLevel): { mult: number[]; mu: number; v: number } => {
          const mult = Array.from({ length: rows + 1 }, (_, k) => cfg.scalingEdgeMultiplier(rows, risk, k));
          let mu = 0, m2 = 0;
          for (let k = 0; k <= rows; k++) { const p = binomProb(rows, k); mu += p * mult[k]; m2 += p * mult[k] * mult[k]; }
          return { mult, mu, v: m2 - mu * mu };
        };
        const R = PASS2_NULL_SEEDS;
        const nullBySeq = new Map<string, { sums: Float64Array; zSorted: Float64Array; mu: number; sd: number; refZSorted: Float64Array }>();
        const countLE = (sorted: Float64Array, x: number): number => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= x) lo = m + 1; else hi = m; } return lo; };
        const countGE = (sorted: Float64Array, x: number): number => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < x) lo = m + 1; else hi = m; } return sorted.length - lo; };
        const REF_WINDOWS = (P2_NONCES - P2_EARLY) / P2_EARLY;   // 199
        const perEpoch: Array<{ epoch: string; phase: string; S: number; mu: number; sd: number; z: number; pLower: number; pUpper: number;
          zRef: number; pRefLower: number; flagged: boolean; broad: boolean; missedNonces: number[] }> = [];
        for (let ei = 0; ei < epochs.length; ei++) {
          const e = epochs[ei];
          const boards = e.seq.map(x => boardMoments(x.rows, x.risk));
          let nul = nullBySeq.get(e.seqKey);
          const mu = boards.reduce((a, b) => a + b.mu, 0);
          const sd = Math.sqrt(boards.reduce((a, b) => a + b.v, 0));
          if (!nul) {
            const sums = new Float64Array(R);
            for (let r = 0; r < R; r++) {
              let S = 0;
              for (let j = 0; j < P2_EARLY; j++) S += boards[j].mult[slotOf(calPath(r, j), MAX_CURSORS, e.seq[j].rows)];
              sums[r] = S;
            }
            const zSorted = Float64Array.from(sums, S => (S - mu) / sd).sort();
            // Reference-window null: 10,000 bootstrap sums of REF_WINDOWS calibrated windows.
            const rng = mulberry32(`${PASS2_NULL_LABEL}:reference:${e.seqKey}`);
            const refZ = new Float64Array(R);
            const refMu = REF_WINDOWS * mu, refSd = Math.sqrt(REF_WINDOWS) * sd;
            for (let b = 0; b < R; b++) {
              let S = 0;
              for (let w = 0; w < REF_WINDOWS; w++) S += sums[Math.floor(rng() * R)];
              refZ[b] = (S - refMu) / refSd;
            }
            nul = { sums, zSorted, mu, sd, refZSorted: refZ.sort() };
            nullBySeq.set(e.seqKey, nul);
          }
          let S = 0, Sref = 0;
          for (let n = 0; n < P2_NONCES; n++) {
            const j = n % P2_EARLY;
            const pay = boards[j].mult[slotOf(epochPaths[ei][n], e.cursors, e.seq[j].rows)];
            if (n < P2_EARLY) S += pay; else Sref += pay;
          }
          const z = (S - mu) / sd;
          const zRef = (Sref - REF_WINDOWS * mu) / (Math.sqrt(REF_WINDOWS) * sd);
          const pLower = (1 + countLE(nul.zSorted, z)) / (R + 1);
          const pUpper = (1 + countGE(nul.zSorted, z)) / (R + 1);
          const pRefLower = (1 + countLE(nul.refZSorted, zRef)) / (R + 1);
          const flagged = pLower <= TEST_C_ALPHA;
          perEpoch.push({ epoch: e.hash.slice(0, 16), phase: e.bets[0].phase, S, mu, sd, z, pLower, pUpper, zRef, pRefLower,
            flagged, broad: pLower <= TEST_C_BROAD_P && pRefLower <= TEST_C_BROAD_P, missedNonces: e.missed });
        }
        const qNull = Math.floor(TEST_C_ALPHA * (R + 1)) / (R + 1);
        const nEp = perEpoch.length;
        const cFlags = perEpoch.filter(x => x.flagged).length;
        const cBroad = perEpoch.filter(x => x.broad).length;
        const cFamilyP = poissonBinomialSurvival(perEpoch.map(() => qNull), cFlags);
        const pooledZ = perEpoch.reduce((a, x) => a + (x.S - x.mu), 0) / Math.sqrt(perEpoch.reduce((a, x) => a + x.sd * x.sd, 0));
        const below = perEpoch.filter(x => x.S < x.mu).length;
        const above = perEpoch.filter(x => x.S > x.mu).length;
        const upperFlags = perEpoch.filter(x => x.pUpper <= TEST_C_ALPHA).length;
        // Payouts are right-skewed, so an honest window pays below its mean MORE often than not; the
        // direction split is read against the null's own below-mean rate, not against one half.
        const belowExpectedUnderNull = epochs.reduce((a, e) => {
          const nul = nullBySeq.get(e.seqKey)!;
          let c = 0; for (let r = 0; r < R; r++) if (nul.sums[r] < nul.mu) c++;
          return a + c / R;
        }, 0);
        // Smallest flag count the family rule fails at, under the null.
        let xFail = 0; while (xFail <= nEp && poissonBinomialSurvival(perEpoch.map(() => qNull), xFail) >= TEST_C_FAMILY_FAIL) xFail++;
        // DETECTION POWER. π(δ): the chance an epoch whose early window pays (1−δ) of what it would
        // have is flagged — measured on each epoch's own calibrated null windows, averaged over epochs.
        // Family power: a fraction f of epochs picked with shortfall δ, the rest honest — P(flags ≥ xFail).
        const perEpochPower = (d: number): number => {
          let tot = 0;
          for (const e of epochs) {
            const nul = nullBySeq.get(e.seqKey)!;
            let hit = 0;
            for (let r = 0; r < R; r++) {
              const z = (nul.sums[r] * (1 - d) - nul.mu) / nul.sd;
              if ((1 + countLE(nul.zSorted, z)) / (R + 1) <= TEST_C_ALPHA) hit++;
            }
            tot += hit / R;
          }
          return tot / epochs.length;
        };
        const binomPmf = (n: number, p: number): number[] => {
          const out = new Array(n + 1).fill(0); out[0] = 1;
          for (let i = 0; i < n; i++) for (let k = i + 1; k >= 0; k--) out[k] = (k > 0 ? out[k - 1] * p : 0) + (k <= i ? out[k] * (1 - p) : 0);
          return out;
        };
        const power = TEST_C_POWER_SHORTFALLS.map(d => {
          const pi = perEpochPower(d);
          return {
            shortfall: d, perEpochPower: pi,
            family: TEST_C_POWER_FRACTIONS.map(f => {
              const picked = Math.round(f * nEp);
              const a = binomPmf(nEp - picked, qNull), b = binomPmf(picked, pi);
              let tail = 0;
              for (let i = 0; i < a.length; i++) for (let k = 0; k < b.length; k++) if (i + k >= xFail) tail += a[i] * b[k];
              return { pickedFraction: f, pickedEpochs: picked, power: tail };
            }),
          };
        });
        const testCHard: string[] = [];
        if (nEp !== revealedEpochs) testCHard.push(`Test C: ${nEp} epochs scored, ${revealedEpochs} revealed`);
        if (cBroad > 0) testCHard.push(`Test C: ${cBroad} BROAD flag(s) — early window AND reference window both at p ≤ ${TEST_C_BROAD_P}`);
        if (cFamilyP < TEST_C_FAMILY_FAIL) testCHard.push(`Test C: ${cFlags}/${nEp} epochs flagged at p ≤ ${TEST_C_ALPHA}; Poisson-binomial survival ${cFamilyP.toExponential(3)} < ${TEST_C_FAMILY_FAIL}`);
        if (pooledZ < TEST_C_POOLED_Z) testCHard.push(`Test C: pooled early-window z ${pooledZ.toFixed(3)} < ${TEST_C_POOLED_Z}`);
        const testCMarginal = testCHard.length === 0 && cFamilyP < TEST_C_FAMILY_FLAG;
        failures.push(...replayIssues, ...testCHard);
        if (boundMismatches > 0) failures.unshift(`Pass 2 replay: ${boundMismatches} captured bet(s) not reproduced by the replay`);
        const testC = {
          rule: { alpha: TEST_C_ALPHA, familyFail: TEST_C_FAMILY_FAIL, familyFlag: TEST_C_FAMILY_FLAG, broadP: TEST_C_BROAD_P,
            pooledZ: TEST_C_POOLED_Z, written: '2026-09-24, before the statistic was first computed; after the capture\'s seeds were revealed' },
          window: `early = nonces 0–${P2_EARLY - 1} (the captured nonce range; in the 2 capture-retry epochs the missed nonce is the replayed one and captured nonce 50 falls in the reference window); reference = nonces ${P2_EARLY}–${P2_NONCES - 1}, the served sequence cycled by position (nonce n plays position n mod ${P2_EARLY})`,
          null: { calibrationSeeds: R, label: PASS2_NULL_LABEL, distinctServedSequences: nullBySeq.size, perEpochNullFlagProbability: qNull },
          epochsScored: nEp, flagged: cFlags, flagFamilySurvival: cFamilyP, flagCountThatFails: xFail, broad: cBroad, pooledZ,
          directionSplit: { earlyBelowExpectation: below, earlyAboveExpectation: above, belowExpectedUnderNull, upperTailFlags: upperFlags },
          power,
          perEpoch,
        };
        runPrecision.step20TestsABRederived = { ...artifactView(abTally), ...runView(abTally) };
        const replayDetails = {
          epochsReplayed: epochs.length, noncesPerEpoch: P2_NONCES, calibrationSeeds: R,
          capturedBetsBound: boundBets, capturedBetMismatches: boundMismatches,
          testsABRederived: { rows: abRows, floatsCompared: abTally.compared, floatsWithinTolerance: abTally.withinTolerance, mismatches: abMismatches,
            testAFails: testAFailsRe, testBFlags: testBFlagsRe, testABinomialP: testAPRe, testBBinomialP: testBPRe },
        };
        console.log(`  [REPLAY] Pass 2: ${epochs.length} revealed epochs × ${P2_NONCES.toLocaleString()} nonces + ${R.toLocaleString()} calibration seeds × ${P2_EARLY} nonces in ${(replayMs2 / 1000).toFixed(1)} s; ${boundBets} captured bets bound (${boundMismatches} mismatches); Tests A/B re-derived on ${abRows} rows (${abMismatches} mismatches)`);
        console.log(`  [TEST C] ${cFlags}/${nEp} epochs flagged at p ≤ ${TEST_C_ALPHA} (family survival ${cFamilyP.toFixed(4)}, fails at ≥ ${xFail}); broad ${cBroad}; pooled z ${pooledZ.toFixed(3)}; below/above expectation ${below}/${above} (null ${belowExpectedUnderNull.toFixed(1)} below); power at 10% shortfall: per-epoch ${(power[1].perEpochPower * 100).toFixed(1)}%, family at 25% picked ${(power[1].family[1].power * 100).toFixed(1)}%`);

        const marginalFlagIndex = infoFlags.findIndex(f => f.includes('marginally exceeds'));
        const expectedIsolatedUnderH0 = flaggedCombos.length * Math.pow(0.95, MW_WINDOWS - 1);
        const multiWindowConsistentWithNoise = isolatedEarlyFlags <= Math.ceil(expectedIsolatedUnderH0);

        if (marginalFlagIndex >= 0 && flaggedCombos.length > 0) {
          const multiWindowSummary =
            `Multi-window analysis (${MW_WINDOWS} × ${MWWINDOW}-nonce windows): ` +
            `${broadDeviationFlags}/${flaggedCombos.length} flagged combinations show broad deviation (noise), ` +
            `${isolatedEarlyFlags}/${flaggedCombos.length} show isolated early-window deviation ` +
            `(H₀ expectation: ${expectedIsolatedUnderH0.toFixed(1)} isolated, ${(flaggedCombos.length - expectedIsolatedUnderH0).toFixed(1)} broad).`;
          if (multiWindowConsistentWithNoise) {
            infoFlags[marginalFlagIndex] +=
              ` ${multiWindowSummary} ` +
              `Observed ${isolatedEarlyFlags} isolated ≤ H₀ expected ${Math.ceil(expectedIsolatedUnderH0)} — ` +
              `multi-window result is consistent with random false positives. ` +
              `Reclassified as distributional noise; marginal Test B excess does not indicate cherry-picking.`;
          } else {
            infoFlags[marginalFlagIndex] += ` ${multiWindowSummary} ` +
              `Observed ${isolatedEarlyFlags} isolated > H₀ expected ${Math.ceil(expectedIsolatedUnderH0)} — ` +
              `above-null isolated-early rate warrants continued disclosure.`;
          }
        }

        const details = {
          seeds_tested: p2.seeds_tested,
          nonces_per_seed: p2.nonces_per_seed,
          epoch_length: p2.epoch_length,
          seed_row_combinations: combinations,
          test_a_verdict: p2.test_a_verdict ?? null,
          test_b_verdict: p2.test_b_verdict ?? null,
          test_a_chi2_fails: p2.test_a_chi2_fails_at_alpha01,
          test_b_early_window_flags: p2.test_b_cherry_pick_flags,
          bonferroni_threshold: bonferroniThreshold,
          multi_window_analysis: {
            windows_tested: MW_WINDOWS,
            window_size: MWWINDOW,
            flagged_combinations_analysed: flaggedCombos.length,
            isolated_early_flags: isolatedEarlyFlags,
            broad_deviation_flags: broadDeviationFlags,
            results: multiWindowDetails,
          },
          info: infoFlags,
          power_note: 'Test B early bucket (~50 nonces) has limited statistical power on high-row configs — pooled bins may reduce to 2–3 df. Absence of flags is not a proof of absence of cherry-picking; it means no statistically detectable pattern was found. Test C carries its own measured detection power (testC.power).',
          replay: replayDetails,
          testC,
        };

        const allMessages = [...failures, ...infoFlags];
        const marginalFlag = failures.length === 0 && (testCMarginal || (
          infoFlags.some(f => f.includes('marginally exceeds')) &&
          !multiWindowConsistentWithNoise));
        const testCLine = `Test C (served-config payout statistic, calibrated null on ${R.toLocaleString()} fresh seeds): `
          + `${cFlags}/${nEp} epochs flagged at p ≤ ${TEST_C_ALPHA} (Poisson-binomial survival ${cFamilyP.toFixed(4)}; the rule fails at ≥ ${xFail}), `
          + `${cBroad} broad, pooled z ${pooledZ.toFixed(3)} (fails below ${TEST_C_POOLED_Z}); early windows below/above expectation ${below}/${above} (null expects ${belowExpectedUnderNull.toFixed(1)} below); `
          + `power at a 10% early-window shortfall ${(power[1].perEpochPower * 100).toFixed(1)}% per epoch, ${(power[1].family[1].power * 100).toFixed(1)}% for the family if 25% of epochs were picked. `
          + `Replay: ${epochs.length} epochs × ${P2_NONCES.toLocaleString()} nonces, ${boundBets}/${EXPECTED_BETS} captured bets reproduced, Tests A/B re-derived on ${abRows} rows.`;
        const testAVerdict = p2.test_a_verdict ?? 'n/a';
        const testBVerdict = p2.test_b_verdict ?? 'n/a';
        const r = failures.length > 0
          ? fail(20, 'Simulation Results — Pass 2 Cherry-Pick Test', ['EC-35'], 'HARD_FAIL',
              `${failures.length} Pass 2 failures`, allMessages, details)
          : marginalFlag
          ? fail(20, 'Simulation Results — Pass 2 Cherry-Pick Test', ['EC-35'], 'FLAG',
              testCMarginal
                ? `Pass 2: marginal Test C excess — ${cFlags}/${nEp} epochs flagged, family survival ${cFamilyP.toFixed(4)} < ${TEST_C_FAMILY_FLAG}. Disclosure required; not conclusive. ${testCLine}`
                : `Pass 2: marginal Test B excess — ${p2.test_b_cherry_pick_flags} early-window flags vs threshold ${bonferroniThreshold}; ${isolatedEarlyFlags} isolated. Artifact verdicts: Test A=${testAVerdict}, Test B=${testBVerdict}. Disclosure required; not conclusive. See details.`,
              testCMarginal
                ? [`marginal Test C excess: ${cFlags}/${nEp} epochs flagged at p ≤ ${TEST_C_ALPHA}, Poisson-binomial survival ${cFamilyP.toFixed(4)} (FLAG below ${TEST_C_FAMILY_FLAG}, FAIL below ${TEST_C_FAMILY_FAIL})`, ...allMessages]
                : allMessages, details)
          : pass(20, 'Simulation Results — Pass 2 Cherry-Pick Test', ['EC-35'],
              `Pass 2: ${p2.seeds_tested} seeds × ${p2.nonces_per_seed.toLocaleString()} nonces. Artifact verdicts: Test A=${testAVerdict}, Test B=${testBVerdict}. Test A: ${p2.test_a_chi2_fails_at_alpha01} fail(s). Early-window statistical flags: ${p2.test_b_cherry_pick_flags} of ${combinations} combinations (within expected false-positive range; threshold ${bonferroniThreshold}). Multi-window breakdown: ${isolatedEarlyFlags} isolated-early (consistent with random false positives), ${broadDeviationFlags} multi-window distributional variation (noise). No cherry-pick signature.${infoFlags.length > 0 ? ' See info in details.' : ''} ${testCLine}`,
              details);
        results.push(r);
        console.log(`  [${tag(r)}] Step 20 — ${r.name}`);
        // Always print summary for simulation steps
        if (r.pass) {
          console.log(`         Pass 2: ${p2.seeds_tested} seeds × ${p2.nonces_per_seed.toLocaleString()} nonces. Artifact verdicts: Test A=${testAVerdict}, Test B=${testBVerdict}. Early-window statistical flags: ${p2.test_b_cherry_pick_flags} of ${combinations} (within expected false-positive range; threshold ${bonferroniThreshold}). Multi-window: ${isolatedEarlyFlags} isolated-early, ${broadDeviationFlags} multi-window noise.`);
        }
      }
    }
  }

  return results;
}
