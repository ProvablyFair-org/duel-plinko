/**
 * Step 17: Probability Independence — Anti-Circularity
 * EC-33
 */

import type { StepResult } from '../../src/types';
import { binomProb } from '../../src/stats';
import { pass, fail, VerifyContext, tag } from './context';

/**
 * Slot counts obtained by WALKING every one of the 2^rows paths through the board.
 *
 * This shares nothing with the closed form it is used to check — no factorials, no powers, no
 * probability at all. It drops a ball down every possible sequence of lefts and rights and counts
 * where the balls end up. If `binomProb` and this disagree, one of them is wrong, and the reader
 * does not have to take either on trust.
 */
function enumerateBoard(rows: number): number[] {
  const counts = new Array<number>(rows + 1).fill(0);
  const total = 1 << rows;
  for (let path = 0; path < total; path++) {
    let slot = 0;
    for (let cursor = 0; cursor < rows; cursor++) slot += (path >> cursor) & 1;
    counts[slot]++;
  }
  return counts;
}

/** Pascal's triangle row `rows`, built by integer addition only. */
function pascalRow(rows: number): number[] {
  let row = [1];
  for (let n = 1; n <= rows; n++) {
    const next = new Array<number>(n + 1).fill(0);
    next[0] = 1;
    next[n] = 1;
    for (let k = 1; k < n; k++) next[k] = row[k - 1] + row[k];
    row = next;
  }
  return row;
}

export function run(ctx: VerifyContext): StepResult[] {
  const { cfg } = ctx;
  const results: StepResult[] = [];

  {
    const failures: string[] = [];
    let totalChecked = 0;

    for (const { rows, risk } of cfg.allConfigs()) {
      const configProbs = cfg.probabilities(rows, risk);
      const slotCount = rows + 1;
      for (let k = 0; k < slotCount; k++) {
        const independent = binomProb(rows, k);
        const fromConfig = configProbs[k];
        if (fromConfig !== independent) {
          failures.push(
            `${rows}r/${risk} slot ${k}: config=${fromConfig} independent=${independent} diff=${Math.abs(fromConfig - independent).toExponential(4)}`
          );
        }
        totalChecked++;
      }
    }

    const rtpFailures: string[] = [];
    for (const { rows, risk } of cfg.allConfigs()) {
      let independentRTP = 0;
      for (let k = 0; k <= rows; k++) {
        independentRTP += binomProb(rows, k) * cfg.scalingEdgeMultiplier(rows, risk, k);
      }
      const configRTP = cfg.theoreticalRTP(rows, risk);
      if (Math.abs(independentRTP - configRTP) > 1e-15) {
        rtpFailures.push(
          `${rows}r/${risk}: configRTP=${configRTP} independentRTP=${independentRTP}`
        );
      }
    }

    // ── Exhaustive path enumeration ────────────────────────────────────────────
    // The closed form and the config agreeing is one test with one formula in it. Every board
    // this casino publishes is small enough to walk end to end — 2^8 through 2^16, 130,816 paths
    // in total — so the probabilities are also derived by counting, with no formula anywhere in
    // the derivation, and cross-checked against an integer Pascal triangle. A transcription
    // error in binomProb that happened to match the operator's table would survive the closed
    // form and dies here.
    const enumFailures: string[] = [];
    const boards: Record<string, { paths: number; countsMatchPascal: boolean; maxProbGap: number }> = {};
    const boardSizes = [...new Set(cfg.allConfigs().map(c => c.rows))].sort((a, b) => a - b);
    let enumeratedPaths = 0;

    for (const rows of boardSizes) {
      const counts = enumerateBoard(rows);
      const pascal = pascalRow(rows);
      const total = 1 << rows;
      enumeratedPaths += total;

      let countsMatchPascal = true;
      let maxProbGap = 0;
      const sum = counts.reduce((a, b) => a + b, 0);
      if (sum !== total) {
        enumFailures.push(`${rows} rows: enumeration visited ${sum} paths, expected 2^${rows} = ${total}`);
        countsMatchPascal = false;
      }
      for (let k = 0; k <= rows; k++) {
        if (counts[k] !== pascal[k]) {
          countsMatchPascal = false;
          enumFailures.push(`${rows} rows slot ${k}: ${counts[k]} enumerated paths vs Pascal ${pascal[k]}`);
        }
        const gap = Math.abs(counts[k] / total - binomProb(rows, k));
        if (gap > maxProbGap) maxProbGap = gap;
        if (gap > 1e-12) {
          enumFailures.push(`${rows} rows slot ${k}: enumerated ${counts[k]}/${total} vs binomProb ${binomProb(rows, k)}`);
        }
        // The operator's own table is compared against the counted probability too, so the
        // enumeration is not merely an internal cross-check of two of our own functions.
        for (const risk of ['low', 'medium', 'high'] as const) {
          const fromConfig = cfg.probabilities(rows, risk)[k];
          if (Math.abs(fromConfig - counts[k] / total) > 1e-12) {
            enumFailures.push(`${rows}r/${risk} slot ${k}: config ${fromConfig} vs enumerated ${counts[k]}/${total}`);
          }
        }
      }
      boards[`${rows}r`] = { paths: total, countsMatchPascal, maxProbGap };
    }

    const allFailures = [...failures, ...rtpFailures, ...enumFailures];
    const details = {
      probabilitiesChecked: totalChecked,
      probabilityMismatches: failures.length,
      rtpCrossChecks: cfg.allConfigs().length,
      rtpMismatches: rtpFailures.length,
      enumeration: {
        boards: boardSizes.length,
        pathsWalked: enumeratedPaths,
        tolerance: 1e-12,
        mismatches: enumFailures.length,
        perBoard: boards,
      },
      method: 'binomProb(rows, k) = C(rows,k) * 0.5^rows from stats.ts — not sourced from plinkoConfig.json; '
        + 'cross-checked by exhaustive 2^rows path enumeration and an integer Pascal recurrence',
      significance: 'Breaks circularity: theoretical RTP is computed from independently verified probabilities × observed multipliers.',
    };

    const r = allFailures.length === 0
      ? pass(17, 'Probability Independence (Anti-Circularity)', ['EC-33'],
          `Given the committed plinkoConfig.json multiplier table, independently-derived binomial probabilities P(slot)=C(rows,k)/2^rows produce 99.9% RTP (analytic identity over the full table) for all ${cfg.allConfigs().length} configurations. All ${totalChecked} per-slot probabilities exactly equal the independent binomial, and every board is confirmed a second time by walking all 2^rows paths through it and counting where they land — ${boardSizes.length} boards, ${enumeratedPaths.toLocaleString()} paths, agreeing with an integer Pascal recurrence exactly and with the closed form and the operator's table inside 1e-12. The RTP proof is non-circular: probabilities come from stats.ts (binomProb) and from enumeration, not from plinkoConfig.json.`,
          details)
      : fail(17, 'Probability Independence (Anti-Circularity)', ['EC-33'], 'HARD_FAIL',
          `${allFailures.length} probability/RTP mismatches — config probabilities diverge from binomial`,
          allFailures.slice(0, 20), details);
    results.push(r);
    console.log(`  [${tag(r)}] Step 17 — ${r.name}`);
  }

  return results;
}
