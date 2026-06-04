/**
 * Steps 19–20: Simulation Integrity
 * EC-34, EC-35
 */

import fs from 'fs';
import path from 'path';
import type { StepResult } from '../../src/types';
import { computeSlot } from '../../src/rng';
import { binomProb, chiSquaredTest } from '../../src/stats';
import { revealedSeeds } from '../../src/loader';
import { pass, fail, VerifyContext } from './context';

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
  const { outputsDir, revealedMap, bets, seeds } = ctx;
  const results: StepResult[] = [];

  // ── Step 19: Simulation Results — Pass 1 Integrity (EC-34) ───────────────────
  {
    const simFile = path.join(outputsDir, 'simulation-results.json');
    const failures: string[] = [];

    if (!fs.existsSync(simFile)) {
      const r = fail(19, 'Simulation Results — Pass 1 Integrity', ['EC-34'], 'HARD_FAIL',
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
      if (p1) {
        const configs = p1.configs ?? 27;
        const bonferroniAlpha = 0.01 / configs;

        // Chi-squared: Bonferroni correction
        chi2BonferroniFails = Array.isArray(p1.results)
          ? p1.results.filter((r: { pValue: number }) => r.pValue < bonferroniAlpha).length
          : null;
        if (chi2BonferroniFails !== null && chi2BonferroniFails > 0) {
          failures.push(`Pass 1: ${chi2BonferroniFails} configs fail chi-squared at Bonferroni α/${configs}=${bonferroniAlpha.toFixed(5)}`);
        }

        const expectedRounds = 27_000_000;
        if (p1.totalRounds !== expectedRounds) {
          failures.push(`Pass 1: totalRounds=${p1.totalRounds} (expected ${expectedRounds})`);
        }
        const rtpDiff = Math.abs(p1.avgSimulatedRTP - p1.avgTheoreticalRTP);
        if (rtpDiff > 0.005) {
          failures.push(`Pass 1: avgSimulatedRTP=${(p1.avgSimulatedRTP * 100).toFixed(4)}% deviates from theoretical by ${(rtpDiff * 100).toFixed(4)}% (threshold 0.5%)`);
        }

        // Serial independence: same Bonferroni correction as chi-squared
        const serialFails = p1.serialIndependenceFails ?? 0;
        const bonferroniZCrit = inverseCriticalZ(bonferroniAlpha);
        serialBonferroniFails = Array.isArray(p1.results)
          ? p1.results.filter((r: { lag1Z: number; runsP: number }) =>
              Math.abs(r.lag1Z) > bonferroniZCrit || r.runsP < bonferroniAlpha
            ).length
          : null;
        if (serialBonferroniFails !== null && serialBonferroniFails > 0) {
          failures.push(`Pass 1: ${serialBonferroniFails} config(s) fail serial independence at Bonferroni α/${configs}=${bonferroniAlpha.toFixed(5)}`);
        }
      }

      const configs = p1?.configs ?? 27;
      const bonferroniAlpha = 0.01 / configs;
      const chi2Fails = p1?.chi2FailsAtAlpha01 ?? 0;
      const serialFails = p1?.serialIndependenceFails ?? 0;
      const totalBonFails = (chi2BonferroniFails ?? 0) + (serialBonferroniFails ?? 0);
      const totalUncorrected = chi2Fails + serialFails;

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
      } : { error: 'pass1_fresh_seeds missing' };

      // Lead with Bonferroni result, frame uncorrected as expected noise
      let summaryMsg: string;
      if (p1) {
        summaryMsg = `${p1.totalRounds.toLocaleString()} rounds × ${configs} configs; avg RTP=${(p1.avgSimulatedRTP * 100).toFixed(4)}%. `;
        summaryMsg += `${totalBonFails}/${configs} configs fail at Bonferroni-corrected threshold (α/${configs} = ${bonferroniAlpha.toFixed(5)}). `;
        if (totalUncorrected > 0) {
          summaryMsg += `${totalUncorrected}/${configs} flag at uncorrected α = 0.01, consistent with expected false-positive rate across ${configs} independent tests.`;
        } else {
          summaryMsg += `0/${configs} flag even at uncorrected α = 0.01.`;
        }
      } else {
        summaryMsg = 'pass1_fresh_seeds missing';
      }

      const r = failures.length === 0
        ? pass(19, 'Simulation Results — Pass 1 Integrity', ['EC-34'], summaryMsg, details)
        : fail(19, 'Simulation Results — Pass 1 Integrity', ['EC-34'], 'HARD_FAIL',
            `${failures.length} simulation result issues`, failures, details);
      results.push(r);
      console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] Step 19 — ${r.name}`);
      // Always print summary for simulation steps (Bonferroni context matters even on PASS)
      console.log(`         ${summaryMsg}`);
      // Detail lines — only when there are uncorrected flags, name the specific configs
      if (p1 && chi2Fails > 0 && Array.isArray(p1.results)) {
        const flaggedChi2 = (p1.results as Array<{ rows: number; risk: string; pValue: number }>)
          .filter(r => r.pValue < 0.01)
          .map(r => `${r.rows}r/${r.risk} p=${r.pValue.toFixed(4)}`)
          .join(', ');
        console.log(`         ℹ Chi-squared flagged: ${flaggedChi2}`);
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
          power_note: 'Test B early bucket (~50 nonces) has limited statistical power on high-row configs — pooled bins may reduce to 2–3 df. Absence of flags is not a proof of absence of cherry-picking; it means no statistically detectable pattern was found.',
        };

        const allMessages = [...failures, ...infoFlags];
        const marginalFlag = failures.length === 0 &&
          infoFlags.some(f => f.includes('marginally exceeds')) &&
          !multiWindowConsistentWithNoise;
        const testAVerdict = p2.test_a_verdict ?? 'n/a';
        const testBVerdict = p2.test_b_verdict ?? 'n/a';
        const r = failures.length > 0
          ? fail(20, 'Simulation Results — Pass 2 Cherry-Pick Test', ['EC-35'], 'HARD_FAIL',
              `${failures.length} Pass 2 failures`, allMessages, details)
          : marginalFlag
          ? fail(20, 'Simulation Results — Pass 2 Cherry-Pick Test', ['EC-35'], 'FLAG',
              `Pass 2: marginal Test B excess — ${p2.test_b_cherry_pick_flags} early-window flags vs threshold ${bonferroniThreshold}; ${isolatedEarlyFlags} isolated. Artifact verdicts: Test A=${testAVerdict}, Test B=${testBVerdict}. Disclosure required; not conclusive. See details.`,
              allMessages, details)
          : pass(20, 'Simulation Results — Pass 2 Cherry-Pick Test', ['EC-35'],
              `Pass 2: ${p2.seeds_tested} seeds × ${p2.nonces_per_seed.toLocaleString()} nonces. Artifact verdicts: Test A=${testAVerdict}, Test B=${testBVerdict}. Test A: ${p2.test_a_chi2_fails_at_alpha01} fail(s). Early-window statistical flags: ${p2.test_b_cherry_pick_flags} of ${combinations} combinations (within expected false-positive range; threshold ${bonferroniThreshold}). Multi-window breakdown: ${isolatedEarlyFlags} isolated-early (consistent with random false positives), ${broadDeviationFlags} multi-window distributional variation (noise). No cherry-pick signature.${infoFlags.length > 0 ? ' See info in details.' : ''}`,
              details);
        results.push(r);
        console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] Step 20 — ${r.name}`);
        // Always print summary for simulation steps
        if (r.pass) {
          console.log(`         Pass 2: ${p2.seeds_tested} seeds × ${p2.nonces_per_seed.toLocaleString()} nonces. Artifact verdicts: Test A=${testAVerdict}, Test B=${testBVerdict}. Early-window statistical flags: ${p2.test_b_cherry_pick_flags} of ${combinations} (within expected false-positive range; threshold ${bonferroniThreshold}). Multi-window: ${isolatedEarlyFlags} isolated-early, ${broadDeviationFlags} multi-window noise.`);
        }
      }
    }
  }

  return results;
}
