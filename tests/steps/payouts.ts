/**
 * Steps 7–9: Payout & Multiplier Tables + Phase C Code-Path Equivalence
 * EC-11, EC-15, EC-16, EC-17, EC-18, EC-28, EC-32
 */

import type { StepResult, RiskLevel } from '../../src/types';
import { computeSlot } from '../../src/rng';
import { pass, fail, VerifyContext, tag } from './context';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, phaseB, phaseC, cfg, revealedMap, dataset } = ctx;
  const results: StepResult[] = [];

  // ── Step 7: Payout Math (EC-11, EC-18) ───────────────────────────────────────
  {
    const failures: string[] = [];
    // THE MULTIPLIER IS A LATTICE VALUE; THE PRODUCT IS NOT. Every served payout_multiplier is an
    // exact multiple of 1e-8 — 8,100/8,100, measured 2026-09-15 — so it is checked ON that grid
    // rather than against a tolerance. The win_amount it produces is a full-precision product with
    // no grid, so that comparison keeps a bound, but sized to double arithmetic instead of the
    // 1e-8 it carried: the off-grid forgery nudges a served figure by 1e-9 and passed underneath.
    const MULT_DP = 8;
    const offGrid = (x: number): number => Math.abs(x * 10 ** MULT_DP - Math.round(x * 10 ** MULT_DP));
    // Slack is IEEE-754 representation error in the scaling and nothing else, sized from the
    // magnitude of the scaled value rather than picked as a round number.
    const onGrid  = (x: number): boolean =>
      Number.isFinite(x) && offGrid(x) < Math.max(1e-9, Math.abs(x * 10 ** MULT_DP) * 1e-12);
    const MONEY_REL_TOL = 1e-12;

    let offGridMults = 0;
    for (const bet of bets) {
      const amount = parseFloat(bet.response.amount_currency);
      const mult = parseFloat(bet.response.payout_multiplier);
      const win = parseFloat(bet.response.win_amount);
      if (!onGrid(mult)) {
        offGridMults++;
        failures.push(`bet ${bet.response.id} [phase ${bet.phase}]: payout_multiplier ${bet.response.payout_multiplier} is not on the ${MULT_DP}-dp grid (off by ${offGrid(mult).toExponential(2)})`);
        continue;
      }
      const expected = amount * mult;
      const diff = Math.abs(win - expected);
      if (!Number.isFinite(win) || diff > MONEY_REL_TOL * Math.max(Math.abs(expected), 1)) {
        failures.push(`bet ${bet.response.id} [phase ${bet.phase}]: win=${win} expected=${expected} diff=${diff.toExponential(2)}`);
      }
    }

    const r = failures.length === 0
      ? pass(7, 'Payout Math', ['EC-11', 'EC-18'],
          `All ${bets.length} bets: payout_multiplier is on the ${MULT_DP}-dp grid and win_amount = amount_currency × payout_multiplier (relative ${MONEY_REL_TOL})`,
          { checked: bets.length, multiplierGridDp: MULT_DP, relTolerance: MONEY_REL_TOL })
      // A PAYOUT MISMATCH IS NOT A FLAG. This branch scored 'FLAG', and a flag exits 0 — so a
      // wrong credited amount could be published under a passing verdict. Money hard-fails.
      : fail(7, 'Payout Math', ['EC-11', 'EC-18'], 'HARD_FAIL',
          `${failures.length} payout mismatches (${offGridMults} off-grid multipliers)`, failures.slice(0, 20),
          { checked: bets.length, total: failures.length, offGridMultipliers: offGridMults });
    results.push(r);
    console.log(`  [${tag(r)}] Step 7 — ${r.name}`);
  }

  // ── Step 8: Multiplier Table Provenance (EC-28, EC-32) ────────────────────────
  {
    const TOLERANCE = 1e-5;
    let ptMatches = 0, seMatches = 0, ptOnly = 0, seOnly = 0, neither = 0;
    const failures: string[] = [];
    const sampleMismatches: string[] = [];

    // SLOT RANGE IS ASSERTED BEFORE THE LOOKUP, because an out-of-range slot reads past
    // the end of the multiplier array, `parseFloat(undefined)` is NaN, and every `Math.abs(
    // observed - NaN) > TOLERANCE` comparison below is FALSE — so a bet claiming slot 99 on a
    // 16-row board matched "neither table" without ever being counted as a mismatch. A board
    // of `rows` rows has exactly `rows + 1` landing slots; anything else is not a Plinko
    // outcome and hard-fails here rather than passing through as a silent NaN.
    let outOfRange = 0;
    for (const bet of bets) {
      const { rows } = bet.request;
      const { final_slot } = bet.response;
      if (!Number.isInteger(final_slot) || final_slot < 0 || final_slot > rows) {
        outOfRange++;
        if (failures.length < 5) {
          failures.push(`bet ${bet.response.id}: final_slot ${final_slot} is outside [0, ${rows}] — not a landing slot on a ${rows}-row board`);
        }
      }
    }

    for (const bet of bets) {
      const { rows, risk } = bet.request;
      const { final_slot, payout_multiplier } = bet.response;
      const observed = parseFloat(payout_multiplier);

      const ptMult = cfg.payoutTableMultiplier(rows, risk as RiskLevel, final_slot);
      const seMult = cfg.scalingEdgeMultiplier(rows, risk as RiskLevel, final_slot);

      const ptMatch = Math.abs(observed - ptMult) <= TOLERANCE;
      const seMatch = Math.abs(observed - seMult) <= TOLERANCE;

      if (ptMatch && seMatch) { ptMatches++; seMatches++; }
      else if (ptMatch) { ptMatches++; ptOnly++; }
      else if (seMatch) { seMatches++; seOnly++; }
      else {
        neither++;
        if (sampleMismatches.length < 5) {
          sampleMismatches.push(
            `bet ${bet.response.id} ${rows}r/${risk} slot=${final_slot}: observed=${observed} pt=${ptMult} se=${seMult}`
          );
        }
      }
    }

    const N = bets.length;
    const refTable = seMatches >= ptMatches ? 'scaling_edge[0].multipliers' : 'payout_tables';
    const refMatches = refTable === 'scaling_edge[0].multipliers' ? seMatches : ptMatches;

    const details = {
      total: N,
      payoutTableMatches: ptMatches,
      scalingEdgeMatches: seMatches,
      ptOnlyMatches: ptOnly,
      seOnlyMatches: seOnly,
      neitherMatches: neither,
      referenceTable: refTable,
      slotsOutOfRange: outOfRange,
      configLoadTimestamp: 'plinkoConfig.json loaded separately — predates capture',
    };

    if (neither > 0) {
      failures.push(`${neither} bets match neither payout_tables nor scaling_edge`);
      failures.push(...sampleMismatches);
    }

    const rtpDetails: Record<string, number> = {};
    for (const { rows, risk } of cfg.allConfigs()) {
      rtpDetails[`${rows}r/${risk}`] = cfg.theoreticalRTP(rows, risk);
    }
    (details as Record<string, unknown>).theoreticalRTPs = rtpDetails;
    const rtpValues = Object.values(rtpDetails);
    const avgRTP = rtpValues.reduce((a, b) => a + b, 0) / rtpValues.length;
    (details as Record<string, unknown>).avgTheoreticalRTP = avgRTP;

    // Coverage: how many distinct (rows, risk, slot) table entries the live bets exercised.
    const observedEntries = new Set<string>();
    let totalEntries = 0;
    for (const bet of bets) {
      observedEntries.add(`${bet.request.rows}|${bet.request.risk}|${bet.response.final_slot}`);
    }
    for (const { rows } of cfg.allConfigs()) totalEntries += (rows + 1);
    (details as Record<string, unknown>).observedTableEntries = observedEntries.size;
    (details as Record<string, unknown>).totalTableEntries = totalEntries;

    const r = failures.length === 0
      ? pass(8, 'Multiplier Table Provenance', ['EC-28', 'EC-32'],
          `Every one of ${N} final_slot values lies in [0, rows] for its own board. Given the committed plinkoConfig.json multiplier table, independently-derived binomial probabilities P(slot)=C(rows,k)/2^rows produce ${(avgRTP * 100).toFixed(4)}% RTP (analytic identity over the full table). Live play verifies the observed payout entries (${observedEntries.size}/${totalEntries}); unobserved rare-slot entries are evaluated from the committed table. ${refMatches}/${N} bets match ${refTable}.`, details)
      : fail(8, 'Multiplier Table Provenance', ['EC-28', 'EC-32'], 'HARD_FAIL',
          outOfRange > 0
            ? `${outOfRange} bets report a slot outside [0, rows]${neither ? `; ${neither} bets match no known multiplier table` : ''}`
            : `${neither} bets match no known multiplier table`,
          failures, details);
    results.push(r);
    console.log(`  [${tag(r)}] Step 8 — ${r.name}`);
  }

  // ── Step 9: Phase C Code-Path Equivalence (EC-15, EC-16, EC-17) ──────────────
  {
    const failures: string[] = [];
    const TOLERANCE = 1e-5;

    let slotChecked = 0, slotSkipped = 0;
    for (const bet of phaseC) {
      const seedEntry = revealedMap.get(bet.response.server_seed_hashed);
      if (!seedEntry) { slotSkipped++; continue; }
      const computed = computeSlot(
        seedEntry.seed.serverSeed!,
        bet.response.client_seed,
        bet.response.nonce,
        bet.request.rows
      );
      if (computed !== bet.response.final_slot) {
        failures.push(`EC-15: bet ${bet.response.id} slot mismatch: computed=${computed} actual=${bet.response.final_slot}`);
      }
      slotChecked++;
    }

    for (const bet of phaseC) {
      const observed = parseFloat(bet.response.payout_multiplier);
      const se = cfg.scalingEdgeMultiplier(bet.request.rows, bet.request.risk as RiskLevel, bet.response.final_slot);
      if (Math.abs(observed - se) > TOLERANCE) {
        failures.push(`EC-16: bet ${bet.response.id} multiplier ${observed} not in scaling_edge table (expected ${se})`);
      }
    }

    // THE BOARD IS WHAT MAKES THE COMPARISON MEAN ANYTHING, and it is read from the data.
    // Phase C exists to show that STAKE ALONE changes nothing. Recomputing 200 high-stake
    // slots does not show that: if Phase C ran a different (rows, risk) board from Phase B,
    // stake and board moved together and neither is isolated. This was described in prose
    // and asserted nowhere, so a capture that drifted onto another board would still have
    // scored a clean pass. Both boards are derived from the bets, never named here.
    const boardOf = (rows: typeof phaseC) =>
      [...new Set(rows.map(b => `${b.request.rows}r/${b.request.risk}`))].sort().join(', ');
    const cBoard = boardOf(phaseC);
    const bBoard = boardOf(phaseB ?? []);
    const sameBoard = !!bBoard && cBoard === bBoard;
    if (!sameBoard) {
      failures.push(
        `EC-17: Phase C runs ${cBoard || 'no board'} but Phase B runs ${bBoard || 'no board'} — ` +
        `stake and board both changed, so bet-size invariance is isolated by neither`
      );
    }
    if (slotSkipped > 0 || slotChecked !== phaseC.length) {
      failures.push(`EC-15: ${slotChecked}/${phaseC.length} Phase C slots recomputed, ${slotSkipped} skipped for want of a revealed seed`);
    }

    const details = {
      phaseCSlotRecomputed: slotChecked,
      phaseCSlotSkipped: slotSkipped,
      phaseBBoard: bBoard,
      phaseCBoard: cBoard,
      sameBoard,
      evidence: 'Phase C equivalence is proven deterministically: slots recomputed correctly at $10 using the same HMAC-SHA256 path on the same board as Phase B, and all multipliers match the same scaling_edge[0] table. No distributional test is used — sample size (n=200) is too small for meaningful statistical comparison.',
    };

    const r = failures.length === 0
      ? pass(9, 'Phase C Code-Path Equivalence', ['EC-15', 'EC-16', 'EC-17'],
          `Phase C: ${slotChecked}/${phaseC.length} slots recomputed correctly at $10 on ${cBoard}, which is the Phase B board (${bBoard}) — bet size is the only variable that moved; all multipliers match the same table. Equivalence proven deterministically.`, details)
      : fail(9, 'Phase C Code-Path Equivalence', ['EC-15', 'EC-16', 'EC-17'], 'HARD_FAIL',
          `${failures.length} equivalence failures`, failures.slice(0, 20), details);
    results.push(r);
    console.log(`  [${tag(r)}] Step 9 — ${r.name}`);
  }

  return results;
}
