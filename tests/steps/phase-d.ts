/**
 * Step 18: Phase D — Client Seed Variation (Standalone Scored Step)
 * EC-27
 */

import type { StepResult, RiskLevel } from '../../src/types';
import { computeSlot, verifyHash } from '../../src/rng';
import { pass, fail, VerifyContext } from './context';

export function run(ctx: VerifyContext): StepResult[] {
  const { phaseD, revealedMap } = ctx;
  const results: StepResult[] = [];

  {
    const slotFailures: string[] = [];
    let checked = 0, skipped = 0;

    for (const bet of phaseD) {
      const seedEntry = revealedMap.get(bet.response.server_seed_hashed);
      if (!seedEntry) { skipped++; continue; }
      const computed = computeSlot(
        seedEntry.seed.serverSeed!,
        bet.response.client_seed,
        bet.response.nonce,
        bet.request.rows
      );
      if (computed !== bet.response.final_slot) {
        slotFailures.push(`bet ${bet.response.id}: computed=${computed} actual=${bet.response.final_slot} (${bet.request.rows}r/${bet.request.risk} nonce=${bet.response.nonce})`);
      }
      checked++;
    }

    const clientSeeds = new Set(phaseD.map(b => b.response.client_seed));
    const configs = new Set(phaseD.map(b => `${b.request.rows}r/${b.request.risk}`));

    // Verify custom client seeds produce different outcomes than default
    const wrongSeed = 'DEFAULT_SEED_COMPARE';
    let changedSlots = 0, totalCompared = 0;
    for (const bet of phaseD) {
      const seedEntry = revealedMap.get(bet.response.server_seed_hashed);
      if (!seedEntry) continue;
      const correctSlot = computeSlot(seedEntry.seed.serverSeed!, bet.response.client_seed, bet.response.nonce, bet.request.rows);
      const wrongSlot = computeSlot(seedEntry.seed.serverSeed!, wrongSeed, bet.response.nonce, bet.request.rows);
      if (correctSlot !== wrongSlot) changedSlots++;
      totalCompared++;
    }

    const details = {
      totalBets: phaseD.length,
      slotsChecked: checked,
      slotsSkipped: skipped,
      slotMismatches: slotFailures.length,
      distinctClientSeeds: clientSeeds.size,
      clientSeedInfluence: `${changedSlots}/${totalCompared} slots changed with wrong seed (${totalCompared > 0 ? ((changedSlots/totalCompared)*100).toFixed(1) : 0}%)`,
    };

    const r = slotFailures.length === 0
      ? pass(18, 'Phase D — Client Seed Variation', ['EC-27'],
          `Phase D: ${checked}/${phaseD.length} slots recomputed correctly. ${clientSeeds.size} distinct custom client seeds. ${changedSlots}/${totalCompared} slots differ with wrong seed.`,
          details)
      : fail(18, 'Phase D — Client Seed Variation', ['EC-27'], 'HARD_FAIL',
          `${slotFailures.length} Phase D slot mismatches`,
          slotFailures.slice(0, 20), details);
    results.push(r);
    console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] Step 18 — ${r.name}`);
  }

  return results;
}
