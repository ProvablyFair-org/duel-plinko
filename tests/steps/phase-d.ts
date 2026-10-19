/**
 * Step 18: Phase D — Client Seed Variation (Standalone Scored Step)
 * EC-27
 */

import type { StepResult, RiskLevel } from '../../src/types';
import { computeSlot, verifyHash } from '../../src/rng';
import { EXPECTED_PHASE_BETS, EXPECTED_PHASE_D_CLIENT_SEEDS } from '../../src/loader';
import { pass, fail, VerifyContext, tag } from './context';

/**
 * The capture's own Phase D client seeds are `'pfaudit' + Date.now().toString(36)`
 * (capture/capture-auto.reference.js). Everything after the prefix is a millisecond clock reading in
 * base 36, so the seed carries no entropy the operator could not enumerate: knowing the capture
 * window to the minute leaves ~60,000 candidates, and knowing it to the second leaves 1,000.
 *
 * That matters because a client seed is supposed to be the player's half of the commitment. A
 * predictable one lets an operator that has not yet fixed its server seed search for a pairing
 * it likes. No such search is detectable in this data — Pass 2 tests exactly that — but the
 * epochs where the protection was weakened belong in the record by name.
 */
const PREDICTABLE_SEED = /^pfaudit([0-9a-z]{6,10})$/;

function decodeClockSeed(clientSeed: string): { predictable: boolean; decodedAt?: string } {
  const m = PREDICTABLE_SEED.exec(clientSeed);
  if (!m) return { predictable: false };
  const ms = parseInt(m[1], 36);
  if (!Number.isFinite(ms) || ms < Date.UTC(2020, 0, 1) || ms > Date.UTC(2100, 0, 1)) {
    return { predictable: false };
  }
  return { predictable: true, decodedAt: new Date(ms).toISOString() };
}

export function run(ctx: VerifyContext): StepResult[] {
  const { phaseD, revealedMap } = ctx;
  const results: StepResult[] = [];

  {
    const slotFailures: string[] = [];
    let checked = 0, skipped = 0;

    for (const bet of phaseD) {
      const seedEntry = revealedMap.get(bet.response.server_seed_hashed);
      if (!seedEntry) {
        // A Phase D bet whose epoch was never revealed is not a bet this step excluded — it is
        // a bet this step failed to verify, and the difference decides whether withholding
        // seeds is a way to pass.
        skipped++;
        slotFailures.push(
          `bet ${bet.response.id}: epoch ${bet.response.server_seed_hashed.substring(0, 16)}... never revealed a server seed, so the outcome cannot be recomputed`
        );
        continue;
      }
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

    // ── Population and the distinct-seed floor, both from code constants ───────
    const coverage: string[] = [];
    if (phaseD.length !== EXPECTED_PHASE_BETS.D) {
      coverage.push(`${phaseD.length} Phase D bets, ${EXPECTED_PHASE_BETS.D} declared in src/loader.ts EXPECTED_PHASE_BETS`);
    }
    if (checked !== phaseD.length) {
      coverage.push(`${checked} of ${phaseD.length} Phase D bets recomputed`);
    }
    if (clientSeeds.size !== EXPECTED_PHASE_D_CLIENT_SEEDS) {
      coverage.push(
        `${clientSeeds.size} distinct player-set client seeds, ${EXPECTED_PHASE_D_CLIENT_SEEDS} declared in `
        + `src/loader.ts EXPECTED_PHASE_D_CLIENT_SEEDS — the phase exists to vary the client seed, so the count is the test`
      );
    }

    // ── Predictable-seed disclosure, with the exposed epochs named ─────────────
    const exposure: Array<{ clientSeed: string; decodedAt: string; bets: number; epochs: string[] }> = [];
    for (const seed of clientSeeds) {
      const decoded = decodeClockSeed(seed);
      if (!decoded.predictable) continue;
      const betsWithSeed = phaseD.filter(b => b.response.client_seed === seed);
      exposure.push({
        clientSeed: seed,
        decodedAt: decoded.decodedAt!,
        bets: betsWithSeed.length,
        epochs: [...new Set(betsWithSeed.map(b => b.response.server_seed_hashed))],
      });
    }

    const details = {
      totalBets: phaseD.length,
      expectedBets: EXPECTED_PHASE_BETS.D,
      slotsChecked: checked,
      slotsSkipped: skipped,
      slotMismatches: slotFailures.length,
      distinctClientSeeds: clientSeeds.size,
      expectedDistinctClientSeeds: EXPECTED_PHASE_D_CLIENT_SEEDS,
      configs: [...configs],
      clientSeedInfluence: { changed: changedSlots, compared: totalCompared },
      predictableClientSeeds: {
        count: exposure.length,
        construction: "'pfaudit' + Date.now().toString(36) — capture/capture-auto.reference.js",
        exposedEpochs: exposure.reduce((n, e) => n + e.epochs.length, 0),
        exposedBets: exposure.reduce((n, e) => n + e.bets, 0),
        entries: exposure,
        consequence: 'the auditor-side seed is enumerable from the capture window, so these epochs do not '
          + 'demonstrate the protection an unguessable player seed would give; the outcomes themselves '
          + 'still recompute exactly and Pass 2 tests the seed selection they were paired with',
      },
    };

    const r = slotFailures.length === 0 && coverage.length === 0
      ? pass(18, 'Phase D — Client Seed Variation', ['EC-27'],
          `Phase D: all ${checked}/${phaseD.length} slots recomputed from the revealed seed, none skipped. `
          + `${clientSeeds.size} distinct player-set client seeds against the floor in src/loader.ts, and the wrong-seed `
          + `re-drop moved ${changedSlots} of ${totalCompared} slots. All ${exposure.length} of those seeds are clock-derived `
          + `and therefore enumerable; the epochs they were used in are listed in details as a disclosure.`,
          details)
      : fail(18, 'Phase D — Client Seed Variation', ['EC-27'], 'HARD_FAIL',
          slotFailures.length
            ? `${slotFailures.length} Phase D bets not verified`
            : `COVERAGE: ${coverage.join('; ')}`,
          [...coverage, ...slotFailures.slice(0, 20)], details);
    results.push(r);
    console.log(`  [${tag(r)}] Step 18 — ${r.name}`);
  }

  return results;
}
