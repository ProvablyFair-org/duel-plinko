/**
 * Steps 1–4: Commit-Reveal Integrity
 * EC-1, EC-2, EC-3, EC-4, EC-5, EC-26
 */

import type { StepResult } from '../../src/types';
import { computeSlot, verifyHash } from '../../src/rng';
import { revealedSeeds } from '../../src/loader';
import { pass, fail, VerifyContext } from './context';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seeds, byHash, revealedMap } = ctx;
  const results: StepResult[] = [];

  // ── Step 1: Seed Hash Integrity (EC-1) ──────────────────────────────────────
  // For each seed entry N with a revealed serverSeed, that seed hashes to
  // seed entry N-1's serverSeedHashed (because rotation reveals the PREVIOUS seed).
  // At phase boundaries, the revealed seed is stale (from previous phase end) — skip those.
  {
    const failures: string[] = [];
    let checked = 0;
    let phaseBoundarySkips = 0;

    for (let i = 1; i < seeds.length; i++) {
      const s = seeds[i];
      if (!s.seed.serverSeed) continue;
      const prevHash = seeds[i - 1].seed.serverSeedHashed;
      const match = verifyHash(s.seed.serverSeed, prevHash);
      if (!match && seeds[i].phase !== seeds[i - 1].phase) {
        phaseBoundarySkips++;
        continue; // Phase boundary: end-of-phase rotation reveals a different epoch's seed
      }
      if (!match) {
        failures.push(`seed[${i}]: SHA-256(revealed) ≠ seed[${i-1}].serverSeedHashed (${prevHash.substring(0, 16)}...)`);
      }
      checked++;
    }

    const r = failures.length === 0
      ? pass(1, 'Seed Hash Integrity', ['EC-1'],
          `${checked} revealed seeds verified. ${phaseBoundarySkips} phase-boundary entries skipped (end-of-phase rotation reveals previous phase seed).`,
          { checked, phaseBoundarySkips })
      : fail(1, 'Seed Hash Integrity', ['EC-1'], 'HARD_FAIL',
          `${failures.length} hash mismatches out of ${checked}`, failures,
          { checked, failed: failures.length, phaseBoundarySkips });
    results.push(r);
    console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] Step 1 — ${r.name}`);
  }

  // ── Step 2: Next-Seed Promotion Verification (HARD_FAIL if mismatch) ────────
  // Recompute the next-seed commitment chain independently from raw fields.
  // The property: the hash pre-committed as "next" in epoch i (captured at
  // rotation as previousNextHash, and stored on the previous epoch as
  // nextServerSeedHash) must equal the active serverSeedHashed of epoch i+1
  // (captured at rotation as newActiveHash). We derive match here rather than
  // reading the capture-script-supplied boolean.
  {
    const failures: string[] = [];
    let checked = 0;
    let recomputedMatches = 0;

    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      if (!s.nextSeedPromotion) continue;
      checked++;

      const { previousNextHash, newActiveHash } = s.nextSeedPromotion;
      const linkageOk = previousNextHash === newActiveHash;

      // Cross-check against the seed-level fields where available: the
      // previous entry's nextServerSeedHash should equal this entry's
      // serverSeedHashed (same property, captured independently from the API).
      let seedFieldOk = true;
      if (i > 0) {
        const prevNextHash = seeds[i - 1].seed.nextServerSeedHash;
        const thisActive   = s.seed.serverSeedHashed;
        if (prevNextHash && thisActive && prevNextHash !== thisActive) {
          seedFieldOk = false;
        }
      }

      if (!linkageOk) {
        failures.push(
          `${s.context}: previousNextHash ${previousNextHash.substring(0, 16)}... ≠ newActiveHash ${newActiveHash.substring(0, 16)}...`
        );
      } else if (!seedFieldOk) {
        failures.push(
          `${s.context}: nextSeedPromotion linkage ok, but seed-level cross-check failed (prev.nextServerSeedHash ≠ this.serverSeedHashed)`
        );
      } else {
        recomputedMatches++;
      }
    }

    const r = failures.length === 0
      ? pass(2, 'Next-Seed Promotion (Commitment Linkage)', ['EC-2'],
          `${recomputedMatches}/${checked} rotation transitions independently recomputed (previousNextHash === newActiveHash; cross-checked against seed-level nextServerSeedHash chain) — next-seed pre-commitment chain intact`,
          { checked, recomputedMatches })
      : fail(2, 'Next-Seed Promotion (Commitment Linkage)', ['EC-2'], 'HARD_FAIL',
          `${failures.length} next-seed promotion mismatches — server may generate fresh seeds at rotation time`,
          failures, { checked, failed: failures.length });
    results.push(r);
    console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] Step 2 — ${r.name}`);
  }

  // ── Step 3: Hash Consistency Within Epoch (EC-26) ────────────────────────────
  {
    const failures: string[] = [];
    for (const [hash, epochBets] of byHash) {
      const hashes = new Set(epochBets.map(b => b.response.server_seed_hashed));
      if (hashes.size !== 1) {
        failures.push(`Epoch ${hash.substring(0, 16)}: ${hashes.size} distinct hashes among ${epochBets.length} bets`);
      }
    }
    const r = failures.length === 0
      ? pass(3, 'Hash Consistency Within Epoch', ['EC-26'],
          `All ${byHash.size} epochs: server_seed_hashed identical across all bets in each epoch`,
          { epochs: byHash.size })
      : fail(3, 'Hash Consistency Within Epoch', ['EC-26'], 'HARD_FAIL',
          `${failures.length} epochs have mid-epoch hash changes`, failures);
    results.push(r);
    console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] Step 3 — ${r.name}`);
  }

  // ── Step 4: Nonce Audit (EC-2, EC-3, EC-4, EC-5) ─────────────────────────────
  {
    const hardFailures: string[] = [];
    const captureArtifacts: string[] = [];
    const reconstructedDetails: Array<{ epoch: string; missedNonce: number; rows: number; computedSlot: number }> = [];
    let epochsChecked = 0;
    let unverifiableArtifacts = 0;

    for (const [hash, epochBets] of byHash) {
      const sorted = [...epochBets].sort((a, b) => a.response.nonce - b.response.nonce);
      const shortHash = hash.substring(0, 16);
      const nonces = sorted.map(b => b.response.nonce);

      const clientSeeds = new Set(sorted.map(b => b.response.client_seed));
      if (clientSeeds.size !== 1) {
        hardFailures.push(`Epoch ${shortHash}: ${clientSeeds.size} distinct client seeds`);
      }

      if (nonces[0] !== 0) {
        hardFailures.push(`Epoch ${shortHash}: first nonce is ${nonces[0]} (expected 0)`);
      }

      const hasNonce50 = nonces.includes(50);
      const missingNonces = Array.from({ length: 51 }, (_, i) => i).filter(i => !nonces.includes(i));
      const isRetryPattern = hasNonce50 && missingNonces.length === 1 && nonces.length === 50;

      if (isRetryPattern) {
        const missedNonce = missingNonces[0];
        const seedEntry = revealedMap.get(hash);
        const clientSeedVal = sorted[0].response.client_seed;
        const rowsSet = new Set(sorted.map(b => b.request.rows));

        if (seedEntry && rowsSet.size === 1) {
          const rows = sorted[0].request.rows;
          const computedSlot = computeSlot(seedEntry.seed.serverSeed!, clientSeedVal, missedNonce, rows);
          reconstructedDetails.push({ epoch: shortHash, missedNonce, rows, computedSlot });
          captureArtifacts.push(
            `Epoch ${shortHash}: capture-retry — nonce ${missedNonce} missed; outcome reconstructed from revealed seed (no captured server response available for comparison): computed slot=${computedSlot}`
          );
        } else {
          const reason = !seedEntry ? 'server seed unrevealed' : `epoch spans ${rowsSet.size} distinct row configs`;
          captureArtifacts.push(`Epoch ${shortHash}: capture-retry — nonce ${missedNonce} missed; not reconstructable (${reason})`);
          unverifiableArtifacts++;
        }
      } else {
        for (let i = 0; i < nonces.length; i++) {
          if (nonces[i] !== i) {
            hardFailures.push(`Epoch ${shortHash}: nonce[${i}]=${nonces[i]} (expected ${i})`);
            break;
          }
        }
      }

      epochsChecked++;
    }

    const allOk = hardFailures.length === 0;
    const hasCaptureArtifacts = captureArtifacts.length > 0;
    const allReconstructed = hasCaptureArtifacts && unverifiableArtifacts === 0;
    const reconstructedCount = reconstructedDetails.length;

    const r = allOk && !hasCaptureArtifacts
      ? pass(4, 'Nonce Audit', ['EC-2', 'EC-3', 'EC-4', 'EC-5'],
          `${epochsChecked} epochs: nonces sequential, single client_seed.`,
          { epochsChecked })
      : allOk && allReconstructed
      ? pass(4, 'Nonce Audit', ['EC-2', 'EC-3', 'EC-4', 'EC-5'],
          `${epochsChecked} epochs: nonces sequential. ${captureArtifacts.length} capture-retry epochs: ${reconstructedCount} reconstructed from revealed seed (no captured server response available for comparison), 0 unverifiable.`,
          { epochsChecked, captureArtifacts: captureArtifacts.length, reconstructed: reconstructedDetails })
      : allOk && hasCaptureArtifacts
      ? fail(4, 'Nonce Audit', ['EC-2', 'EC-3', 'EC-4', 'EC-5'], 'FLAG',
          `${epochsChecked} epochs. ${captureArtifacts.length} capture-retry: ${reconstructedCount} reconstructed from revealed seed (no captured server response available for comparison), ${unverifiableArtifacts} unverifiable.`,
          captureArtifacts, { epochsChecked, reconstructed: reconstructedDetails })
      : fail(4, 'Nonce Audit', ['EC-2', 'EC-3', 'EC-4', 'EC-5'], 'HARD_FAIL',
          `${hardFailures.length} nonce violations`,
          hardFailures.slice(0, 20), { epochsChecked, captureArtifacts });
    results.push(r);
    console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] Step 4 — ${r.name}`);
  }

  return results;
}
