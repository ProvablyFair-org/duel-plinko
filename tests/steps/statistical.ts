/**
 * Informational Context: RTP, Serial Independence, Slot Symmetry (not scored)
 *
 * These are NOT verification steps — they provide context only.
 * Live dataset sample sizes (~200 bets/config) are insufficient for
 * conclusive distribution, RTP, or serial independence testing.
 * Authoritative results come from simulation Pass 1 (1M rounds/config)
 * and analytical RTP proof (Step 17, EC-33).
 */

import { binomProb, chiSquaredTest, lag1Autocorrelation, runsTest, rtpCI } from '../../src/stats';
import { VerifyContext } from './context';
import type { InfoItem } from './context';

export function run(ctx: VerifyContext): InfoItem[] {
  const { bets, phaseA, phaseB, phaseC, cfg, chiSquaredLog } = ctx;
  const items: InfoItem[] = [];

  // ── RTP Analysis ──────────────────────────────────────────────────────────
  {
    const phaseResults: Record<string, ReturnType<typeof rtpCI>> = {};
    for (const [label, phaseBets] of [['A', phaseA], ['B', phaseB], ['C', phaseC]] as const) {
      const amounts = phaseBets.map(b => parseFloat(b.response.amount_currency));
      const wins = phaseBets.map(b => parseFloat(b.response.win_amount));
      phaseResults[label] = rtpCI(amounts, wins);
    }

    items.push({
      label: 'RTP Analysis',
      detail: `Empirical RTP: A=${(phaseResults['A'].rtp * 100).toFixed(3)}% (${phaseA.length} bets) B=${(phaseResults['B'].rtp * 100).toFixed(3)}% (${phaseB.length} bets) C=${(phaseResults['C'].rtp * 100).toFixed(3)}% (${phaseC.length} bets). Deviations from 99.9% are expected at these sample sizes — high-multiplier slots (up to 1009×) create large per-bet variance. Theoretical RTP=99.900% proven analytically in Step 17.`,
    });
  }

  // ── Serial Independence (lag-1) ───────────────────────────────────────────
  {
    if (phaseB.length >= 10) {
      const mults = phaseB.map(b => parseFloat(b.response.payout_multiplier));
      const r1 = lag1Autocorrelation(mults);
      const threshold = 3 / Math.sqrt(phaseB.length);
      const z = r1 / (1 / Math.sqrt(phaseB.length));
      items.push({
        label: 'Serial Independence (lag-1)',
        detail: `Phase B: r₁=${r1.toFixed(4)} (±${threshold.toFixed(4)} = 3/√n threshold), z=${z.toFixed(2)}. Tested on Phase B only (${phaseB.length} same-config bets) to avoid cross-config ordering artifacts. At ${phaseB.length} bets, power is limited — simulation Pass 1 tests at 1M rounds per config.`,
      });
    }
  }

  // ── Serial Independence (runs test) ───────────────────────────────────────
  {
    if (phaseB.length >= 10) {
      const wins = phaseB.map(b => parseFloat(b.response.payout_multiplier) >= 1);
      const { z, pValue } = runsTest(wins);
      items.push({
        label: 'Serial Independence (runs test)',
        detail: `Phase B: runs z=${z.toFixed(3)}, p=${pValue < 1e-10 ? pValue.toExponential(2) : pValue.toFixed(4)}. Tested on Phase B only (${phaseB.length} same-config bets) to avoid cross-config ordering artifacts. Per-config simulation in Pass 1 confirms RNG outputs are serially independent.`,
      });
    }
  }

  // ── Slot Symmetry (chi-squared goodness-of-fit) ───────────────────────────
  {
    const failures: string[] = [];
    const chiResults: Record<string, { chi2: number; df: number; pValue: number; n: number }> = {};

    const allGroups = new Map<string, typeof bets>();
    for (const bet of bets) {
      const key = `${bet.request.rows}r/${bet.request.risk}`;
      if (!allGroups.has(key)) allGroups.set(key, []);
      allGroups.get(key)!.push(bet);
    }

    for (const [key, groupBets] of allGroups) {
      if (groupBets.length < 100) continue;
      const rows = groupBets[0].request.rows;
      const slotCount = rows + 1;
      const observed = new Array(slotCount).fill(0);
      for (const bet of groupBets) observed[bet.response.final_slot]++;

      const allExpected = observed.map((_, slot) => groupBets.length * binomProb(rows, slot));
      const { chi2, df, pValue } = chiSquaredTest(observed, allExpected);
      chiResults[key] = { chi2, df, pValue, n: groupBets.length };
      chiSquaredLog.push({
        config: key,
        n: groupBets.length,
        chi2,
        df,
        pValue,
        pass: pValue >= 0.01,
        observed: [...observed],
        expected: allExpected,
      });
      if (pValue < 0.01) {
        failures.push(`Config ${key} (n=${groupBets.length}): chi2=${chi2.toFixed(2)} df=${df} p=${pValue.toFixed(4)} < 0.01`);
      }
    }

    const failCount = failures.length;
    const configCount = Object.keys(chiResults).length;
    items.push({
      label: 'Slot Symmetry (Live Bets)',
      detail: `${configCount} configs tested with n≥100; ${failCount} fail at α=0.01 (~200 bets/config insufficient; see simulation Pass 1)`,
    });
  }

  return items;
}
