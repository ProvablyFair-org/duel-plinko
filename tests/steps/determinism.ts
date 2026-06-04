/**
 * Steps 5–6: RNG Determinism
 * EC-6, EC-7, EC-27
 */

import type { StepResult } from '../../src/types';
import { computeSlot } from '../../src/rng';
import { pass, fail, VerifyContext } from './context';

export function run(ctx: VerifyContext): StepResult[] {
  const { byHash, revealedMap, determinismLog } = ctx;
  const results: StepResult[] = [];

  // ── Step 5: Slot Recomputation (EC-6, EC-7) ───────────────────────────────────
  {
    const failures: string[] = [];
    let checked = 0;
    let skipped = 0;

    for (const [hash, epochBets] of byHash) {
      const seedEntry = revealedMap.get(hash);
      if (!seedEntry) { skipped += epochBets.length; continue; }

      const serverSeed = seedEntry.seed.serverSeed!;
      for (const bet of epochBets) {
        const { client_seed, nonce, final_slot } = bet.response;
        const { rows } = bet.request;
        const computed = computeSlot(serverSeed, client_seed, nonce, rows);
        determinismLog.push({
          id: bet.response.id,
          phase: bet.phase,
          rows,
          risk: bet.request.risk,
          nonce,
          computed_slot: computed,
          actual_slot: final_slot,
          match: computed === final_slot,
        });
        if (computed !== final_slot) {
          failures.push(`bet ${bet.response.id}: computed=${computed} actual=${final_slot} (${rows}r/${bet.request.risk} nonce=${nonce})`);
        }
        checked++;
      }
    }

    const r = failures.length === 0
      ? pass(5, 'Slot Recomputation (RNG determinism)', ['EC-6', 'EC-7'],
          `All ${checked} bets with revealed seeds: HMAC-SHA256 recompute matches final_slot. Outcome reproduces exactly from (server seed, client seed, nonce) — no external entropy.`,
          { checked, skipped })
      : fail(5, 'Slot Recomputation (RNG determinism)', ['EC-6', 'EC-7'], 'HARD_FAIL',
          `${failures.length} slot mismatches out of ${checked}`,
          failures.slice(0, 20), { checked, skipped, totalMismatches: failures.length });
    results.push(r);
    console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] Step 5 — ${r.name}`);
  }

  // ── Step 6: Client Seed Influence (EC-27) ─────────────────────────────────────
  {
    const wrongClientSeed = 'WRONG_CLIENT_SEED_FOR_AUDIT_TEST';
    const failures: string[] = [];
    let totalChanged = 0;
    let totalChecked = 0;
    const epochResults: { hash: string; changed: number; total: number }[] = [];

    for (const [hash, epochBets] of byHash) {
      const seedEntry = revealedMap.get(hash);
      if (!seedEntry || epochBets.length !== 50) continue;
      const serverSeed = seedEntry.seed.serverSeed!;
      let changed = 0;
      for (const bet of epochBets) {
        const { client_seed, nonce } = bet.response;
        const { rows } = bet.request;
        const correctSlot = computeSlot(serverSeed, client_seed, nonce, rows);
        const wrongSlot = computeSlot(serverSeed, wrongClientSeed, nonce, rows);
        if (wrongSlot !== correctSlot) changed++;
        totalChecked++;
      }
      totalChanged += changed;
      epochResults.push({ hash: hash.substring(0, 20) + '...', changed, total: epochBets.length });
      if (changed === 0) {
        failures.push(`Epoch ${hash.substring(0, 16)}: wrong client seed produced 0 changed slots — client seed may not be in HMAC`);
      }
    }

    if (totalChanged === 0) {
      failures.push(`Wrong client seed produced identical results across all ${totalChecked} bets — client seed is NOT in HMAC`);
    }

    const details = {
      epochsTested: epochResults.length,
      totalChecked,
      totalChanged,
      pctChanged: `${((totalChanged / totalChecked) * 100).toFixed(1)}%`,
      epochResults,
    };

    const r = failures.length === 0
      ? pass(6, 'Client Seed Influence', ['EC-27'],
          `Wrong client seed changed ${totalChanged}/${totalChecked} slots (${details.pctChanged}) across ${epochResults.length} epochs`, details)
      : fail(6, 'Client Seed Influence', ['EC-27'], 'HARD_FAIL',
          'Client seed influence test failed', failures, details);
    results.push(r);
    console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] Step 6 — ${r.name}`);
  }

  return results;
}
