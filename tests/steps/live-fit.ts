/**
 * Step 23: Epoch-window slot fit (live drops vs binomial) — implements PLINKO-22.
 *
 * Pools the captured drops by board size (rows) and fits each pooled slot
 * distribution against the independent binomial C(rows,k)·0.5^rows, then combines
 * the per-group p-values with Fisher's method. INFORMATIONAL (profile policy INFORMATIONAL,
 * Mike 2026-09-29): a live sample of a few thousand drops has little power and never bears
 * the verdict; a deviation — a per-group p below the Bonferroni alpha, or a combined Fisher
 * p below 0.01 — is reported with severity INFO, never a FLAG, never counted.
 */
import type { StepResult } from '../../src/types';
import type { VerifyContext } from './context';
import { pass, fail } from './context';
import { binomProb, chiSquaredTest, chiSquaredPValue } from '../../src/stats';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets } = ctx;
  const byRows = new Map<number, number[]>();
  for (const b of bets) {
    const rows = b.request.rows;
    if (!byRows.has(rows)) byRows.set(rows, new Array(rows + 1).fill(0));
    byRows.get(rows)![b.response.final_slot]++;
  }

  const groupRows: string[] = [];
  const perGroupP: Record<string, number> = {};
  const perGroupChi2: Record<string, number> = {};
  const perGroupN: Record<string, number> = {};
  let fisher = 0, k = 0, minP = 1;
  for (const [r, freq] of [...byRows].sort((a, b) => a[0] - b[0])) {
    const n = freq.reduce((a, b) => a + b, 0);
    const exp = freq.map((_, s) => n * binomProb(r, s));
    const { chi2, df, pValue } = chiSquaredTest(freq, exp);
    groupRows.push(`rows ${r}: n=${n} chi2=${chi2.toFixed(2)} df=${df} p=${pValue.toFixed(4)}`);
    perGroupP[`rows${r}`] = pValue;
    perGroupChi2[`rows${r}`] = chi2;
    perGroupN[`rows${r}`] = n;
    fisher += -2 * Math.log(Math.max(pValue, 1e-300));
    k += 2;
    minP = Math.min(minP, pValue);
  }

  const combinedP = chiSquaredPValue(fisher, k);
  const bon = 0.01 / Math.max(byRows.size, 1);
  const flagged = minP < bon || combinedP < 0.01;
  const ecRefs = ['EC-33'];
  const summary =
    `${bets.length} captured drops pooled by board size (${byRows.size} groups); ` +
    groupRows.join(' | ') +
    `; Fisher X2=${fisher.toFixed(2)} df=${k} combined p=${combinedP.toFixed(4)}; ` +
    `Bonferroni per-group alpha=${bon.toExponential(2)}; ` +
    `p-values are NOMINAL — informational, a live sample has little power and never bears the verdict`;
  const details = {
    drops: bets.length,
    groups: byRows.size,
    fisherX2: fisher,
    fisherDf: k,
    fisherCombinedP: combinedP,
    minGroupP: minP,
    bonferroniPerGroupAlpha: bon,
    perGroupP,
    perGroupChi2,
    perGroupN,
  };

  const result = flagged
    ? fail(23, 'Epoch-Window Slot Fit (live drops vs binomial)', ecRefs, 'INFO', summary,
        [`minP=${minP.toExponential(2)} vs alpha ${bon.toExponential(2)}, or combined p=${combinedP.toFixed(4)} < 0.01`],
        details)
    : pass(23, 'Epoch-Window Slot Fit (live drops vs binomial)', ecRefs, summary, details);
  console.log(`  [${result.severity === 'PASS' ? 'PASS' : result.severity}] Step 23 — ${result.name}`);
  return [result];
}
