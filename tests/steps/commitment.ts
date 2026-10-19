/**
 * Steps 1–4: Commit-Reveal Integrity
 * EC-1, EC-2, EC-3, EC-4, EC-5, EC-26
 */

import type { Bet, StepResult } from '../../src/types';
import { computeSlot, verifyHash } from '../../src/rng';
import { revealedSeeds, EXPECTED_SEEDS, EXPECTED_PHASE_BOUNDARIES } from '../../src/loader';
import { pass, fail, VerifyContext, tag } from './context';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seeds, byHash, revealedMap } = ctx;
  const results: StepResult[] = [];

  // ── Step 1: Seed Hash Integrity (EC-1) ──────────────────────────────────────
  // For each seed entry N with a revealed serverSeed, that seed hashes to
  // seed entry N-1's serverSeedHashed (because rotation reveals the PREVIOUS seed).
  //
  // THE POPULATION IS A CODE CONSTANT AND THE EXEMPTION IS DECLARED. Two ways this step used to
  // pass on evidence it never saw:
  //
  //   Coverage. `checked` was whatever the file happened to contain. Withhold half the
  //   plaintexts and the step verified half as many commitments, found no mismatch, and said so
  //   in a sentence a reader has no denominator for. The count of records, the count that must
  //   verify and the count of declared exemptions all come from src/loader.ts now, and a
  //   shortfall is a failure of this step rather than a smaller number in its summary.
  //
  //   The exemption. `!match && phase differs` was a heuristic: it asked the data whether to
  //   forgive the mismatch, so a real commitment break sitting on a phase change was forgiven
  //   for free and nothing counted how often that happened. The capture plan declares exactly
  //   EXPECTED_PHASE_BOUNDARIES of them; more than that, fewer than that, or one at an index
  //   where the phase label does not actually change is a failure.
  {
    const failures: string[] = [];
    let checked = 0;
    let unrevealed = 0;
    const boundarySkips: Array<{ index: number; from: string; to: string }> = [];

    for (let i = 1; i < seeds.length; i++) {
      const s = seeds[i];
      if (!s.seed.serverSeed) { unrevealed++; continue; }
      const prevHash = seeds[i - 1].seed.serverSeedHashed;
      const match = verifyHash(s.seed.serverSeed, prevHash);
      if (!match && seeds[i].phase !== seeds[i - 1].phase) {
        boundarySkips.push({ index: i, from: seeds[i - 1].phase, to: seeds[i].phase });
        continue; // Declared exemption — counted and bounded below.
      }
      if (!match) {
        failures.push(`seed[${i}]: SHA-256(revealed) ≠ seed[${i-1}].serverSeedHashed (${prevHash.substring(0, 16)}...)`);
      }
      checked++;
    }

    // What the capture plan says this step must have seen, stated as arithmetic over the
    // constants rather than as a count read back out of the dataset.
    const expectedLinks = EXPECTED_SEEDS - 1;
    const expectedChecked = expectedLinks - EXPECTED_PHASE_BOUNDARIES;

    const coverage: string[] = [];
    if (seeds.length !== EXPECTED_SEEDS) {
      coverage.push(`${seeds.length} seed records, ${EXPECTED_SEEDS} declared in src/loader.ts EXPECTED_SEEDS`);
    }
    if (unrevealed !== 0) {
      coverage.push(`${unrevealed} seed record(s) carry no revealed plaintext — every rotation in the plan reveals one`);
    }
    if (boundarySkips.length !== EXPECTED_PHASE_BOUNDARIES) {
      coverage.push(
        `${boundarySkips.length} phase-boundary exemption(s) taken, ${EXPECTED_PHASE_BOUNDARIES} declared in `
        + `src/loader.ts EXPECTED_PHASE_BOUNDARIES — an undeclared exemption is a commitment break, not a boundary`
      );
    }
    if (checked !== expectedChecked) {
      coverage.push(`${checked} commitments verified, ${expectedChecked} required (EXPECTED_SEEDS − 1 − EXPECTED_PHASE_BOUNDARIES)`);
    }

    const details = {
      checked,
      expectedChecked,
      seedRecords: seeds.length,
      expectedSeedRecords: EXPECTED_SEEDS,
      unrevealed,
      phaseBoundarySkips: boundarySkips.length,
      expectedPhaseBoundarySkips: EXPECTED_PHASE_BOUNDARIES,
      phaseBoundaries: boundarySkips,
      failed: failures.length,
    };

    const r = failures.length === 0 && coverage.length === 0
      ? pass(1, 'Seed Hash Integrity', ['EC-1'],
          `${checked}/${expectedChecked} commitments verified against the population declared in src/loader.ts, `
          + `and exactly ${boundarySkips.length} declared phase-boundary exemptions taken (A→B, B→C, C→D — the `
          + `end-of-phase rotation reveals the seed the phase ended on, not the one the next begins with)`,
          details)
      : fail(1, 'Seed Hash Integrity', ['EC-1'], 'HARD_FAIL',
          failures.length
            ? `${failures.length} hash mismatches out of ${checked}`
            : `COVERAGE: ${coverage.join('; ')}`,
          [...coverage, ...failures], details);
    results.push(r);
    console.log(`  [${tag(r)}] Step 1 — ${r.name}`);
  }

  // ── Step 2: Next-Seed Promotion Verification (HARD_FAIL if mismatch) ────────
  // Recompute the next-seed commitment chain independently from raw fields.
  // The property: the hash pre-committed as "next" in epoch i (captured at
  // rotation as previousNextHash, and stored on the previous epoch as
  // nextServerSeedHash) must equal the active serverSeedHashed of epoch i+1
  // (captured at rotation as newActiveHash). We derive match here rather than
  // reading the capture-script-supplied boolean.
  //
  // THE ANCHOR IS MANDATORY. A chain of 166 links says nothing about where the chain STARTS: an
  // operator that generated epoch 0's seed after seeing the first bet would produce exactly the
  // evidence above, because the first record was only ever checked against its own two fields.
  //
  // The capture takes one reading before it rotates anything — GET the active seed, keep
  // `next_server_seed_hash` — and that value is what `seeds[0].nextSeedPromotion.previousNextHash`
  // holds. It is a PRE-CAPTURE record: the hash the account was already committed to before this
  // audit touched it. Requiring it to equal the hash epoch 0 actually ran under, and requiring
  // epoch 0's plaintext to be revealed and to hash to it, is what pins the front of the chain.
  //
  // The boundary is exact and is stated rather than implied: evidence begins at that GET.
  // Nothing in this dataset speaks to any commitment the account held before it, and no
  // arrangement of these 166 records could.
  //
  // `if (!s.nextSeedPromotion) continue` was the other half of the hole — a dataset with the
  // promotion records stripped out checked nothing at all and passed. Every record must carry one.
  {
    const failures: string[] = [];
    let checked = 0;
    let recomputedMatches = 0;

    const anchor = seeds[0];
    const anchorIssues: string[] = [];
    if (!anchor) {
      anchorIssues.push('no seed records at all — the chain has no anchor');
    } else if (!anchor.nextSeedPromotion) {
      anchorIssues.push('seeds[0] carries no nextSeedPromotion — the pre-capture reading is absent');
    } else {
      const preCaptureNextHash = anchor.nextSeedPromotion.previousNextHash;
      const epoch0Hash = anchor.seed.serverSeedHashed;
      if (preCaptureNextHash !== epoch0Hash) {
        anchorIssues.push(
          `pre-capture next-hash ${preCaptureNextHash.substring(0, 16)}... ≠ epoch 0's active hash `
          + `${epoch0Hash.substring(0, 16)}... — epoch 0 was not the commitment the account already held`
        );
      }
      if (!anchor.seed.serverSeed) {
        anchorIssues.push("epoch 0's server seed is never revealed, so the anchor commitment has no plaintext behind it");
      } else if (!verifyHash(anchor.seed.serverSeed, epoch0Hash)) {
        anchorIssues.push(`SHA-256(epoch 0 revealed seed) ≠ ${epoch0Hash.substring(0, 16)}...`);
      }
    }
    failures.push(...anchorIssues);

    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      if (!s.nextSeedPromotion) {
        failures.push(`seed[${i}] (${s.context}): no nextSeedPromotion record — this rotation is unverified, not exempt`);
        continue;
      }
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

    if (checked !== EXPECTED_SEEDS) {
      failures.push(`${checked} rotation records carry a promotion, ${EXPECTED_SEEDS} declared in src/loader.ts EXPECTED_SEEDS`);
    }

    const details = {
      checked,
      expectedChecked: EXPECTED_SEEDS,
      recomputedMatches,
      failed: failures.length,
      anchor: anchor?.nextSeedPromotion ? {
        source: 'GET /api/v2/client-seed before the first rotation (capture/capture-auto.reference.js doRotation, meta.lastNextHash)',
        preCaptureNextHash: anchor.nextSeedPromotion.previousNextHash,
        epoch0ActiveHash: anchor.seed.serverSeedHashed,
        epoch0PlaintextRevealed: !!anchor.seed.serverSeed,
        bound: anchorIssues.length === 0,
      } : { bound: false },
      evidenceBoundary:
        'the chain is anchored at the pre-capture next-seed hash read before the first rotation; '
        + 'no commitment the account held before that reading is in evidence',
    };

    const r = failures.length === 0
      ? pass(2, 'Next-Seed Promotion (Commitment Linkage)', ['EC-2'],
          `${recomputedMatches}/${checked} rotation transitions independently recomputed (previousNextHash === newActiveHash; `
          + `cross-checked against the seed-level nextServerSeedHash chain), and the chain is anchored before epoch 0 by the `
          + `pre-capture next-seed hash, whose plaintext epoch 0 later reveals. Evidence begins at that reading and the step `
          + `claims nothing earlier.`,
          details)
      : fail(2, 'Next-Seed Promotion (Commitment Linkage)', ['EC-2'], 'HARD_FAIL',
          anchorIssues.length
            ? `the commitment chain is not anchored: ${anchorIssues.join('; ')}`
            : `${failures.length} next-seed promotion mismatches — server may generate fresh seeds at rotation time`,
          failures, details);
    results.push(r);
    console.log(`  [${tag(r)}] Step 2 — ${r.name}`);
  }

  // ── Step 3: Hash Consistency Within Epoch (EC-26) ────────────────────────────
  // THE EPOCH IS DERIVED FROM CAPTURE ORDER, NOT FROM THE HASH. Grouping the bets by
  // `server_seed_hashed` and then asking how many distinct hashes each group holds is
  // an identity: every group has exactly one because that is what it was built on, so
  // the check returned "all epochs consistent" for any dataset whatsoever, including
  // one where the hash changes in the middle of a round.
  //
  // An epoch is instead the run of consecutive captured bets that starts when `nonce`
  // returns to 0. That identity comes from the nonce stream and the capture order, not
  // from the field under test, so a hash swapped mid-epoch puts two hashes inside one
  // run and FAILs here. The derived run count must also equal the number of distinct
  // hashes, or an epoch was split or merged without either count noticing.
  {
    const failures: string[] = [];
    const runs: Bet[][] = [];
    let current: Bet[] = [];
    for (const bet of bets) {
      if (bet.response.nonce === 0 && current.length) { runs.push(current); current = []; }
      current.push(bet);
    }
    if (current.length) runs.push(current);

    runs.forEach((runBets, i) => {
      const hashes = new Set(runBets.map(b => b.response.server_seed_hashed));
      if (hashes.size !== 1) {
        failures.push(
          `Epoch ${i} (nonces ${runBets[0].response.nonce}–${runBets[runBets.length - 1].response.nonce}): ` +
          `${hashes.size} distinct server_seed_hashed among ${runBets.length} bets`
        );
      }
    });
    if (runs.length !== byHash.size) {
      failures.push(
        `${runs.length} epochs in capture order but ${byHash.size} distinct server_seed_hashed values — ` +
        `an epoch was split across commitments or two epochs share one`
      );
    }

    const r = failures.length === 0
      ? pass(3, 'Hash Consistency Within Epoch', ['EC-26'],
          `All ${runs.length} epochs, delimited by the nonce returning to 0 in capture order rather than by the hash being tested: server_seed_hashed identical across every bet of each epoch, and ${runs.length} epochs to ${byHash.size} distinct commitments`,
          { epochs: runs.length, distinctCommitments: byHash.size })
      : fail(3, 'Hash Consistency Within Epoch', ['EC-26'], 'HARD_FAIL',
          `${failures.length} epochs have mid-epoch hash changes`, failures);
    results.push(r);
    console.log(`  [${tag(r)}] Step 3 — ${r.name}`);
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

        // A missed nonce is RECONSTRUCTED, not verified: when the revealed server seed hashes to
        // the commitment the epoch's bets carried, the outcome computed from it is the one that
        // seed fixes, but the capture never saw the server's response for it. The hash match is a
        // consistency check (P1), not a witness, so these are a capture-origin FLAG (L2), never a
        // PASS. Reconstruction is gated on that hash match; without it the nonce is unverifiable.
        const commitmentVerified = seedEntry ? verifyHash(seedEntry.seed.serverSeed!, hash) : false;
        if (seedEntry && rowsSet.size === 1 && commitmentVerified) {
          const rows = sorted[0].request.rows;
          const computedSlot = computeSlot(seedEntry.seed.serverSeed!, clientSeedVal, missedNonce, rows);
          reconstructedDetails.push({ epoch: shortHash, missedNonce, rows, computedSlot });
          captureArtifacts.push(
            `Epoch ${shortHash}: capture-retry — nonce ${missedNonce} missed live; reconstructed from the revealed server seed, which hashes to the pre-bet commitment (computed slot=${computedSlot}); the capture did not witness this outcome`
          );
        } else {
          const reason = !seedEntry ? 'server seed unrevealed'
            : !commitmentVerified ? 'revealed seed does not hash to the commitment'
            : `epoch spans ${rowsSet.size} distinct row configs`;
          captureArtifacts.push(`Epoch ${shortHash}: capture-retry — nonce ${missedNonce} missed; NOT verifiable (${reason})`);
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
      ? fail(4, 'Nonce Audit', ['EC-2', 'EC-3', 'EC-4', 'EC-5'], 'FLAG',
          `${epochsChecked} epochs: nonces sequential. ${captureArtifacts.length} capture-retry epoch(s): the live capture missed a nonce and each was reconstructed from a revealed server seed whose SHA-256 matches the pre-bet commitment. The commit-reveal chain determines the outcome, but the auditor did not witness it in the capture, so this is disclosed as a capture-origin FLAG (limitation L2 in MANIFEST.md), not a PASS. Capture-origin: verdict-neutral — the verdict stays Full Pass. 0 unverifiable.`,
          captureArtifacts, { epochsChecked, captureArtifacts: captureArtifacts.length, reconstructed: reconstructedDetails }, 'capture')
      : allOk && hasCaptureArtifacts
      ? fail(4, 'Nonce Audit', ['EC-2', 'EC-3', 'EC-4', 'EC-5'], 'FLAG',
          `${epochsChecked} epochs. ${captureArtifacts.length} capture-retry: ${reconstructedCount} reconstructed from a revealed seed that hashes to the commitment, ${unverifiableArtifacts} NOT verifiable (no revealed seed or the seed does not hash to the commitment) — the unverifiable one(s) carry this flag.`,
          captureArtifacts, { epochsChecked, reconstructed: reconstructedDetails })
      : fail(4, 'Nonce Audit', ['EC-2', 'EC-3', 'EC-4', 'EC-5'], 'HARD_FAIL',
          `${hardFailures.length} nonce violations`,
          hardFailures.slice(0, 20), { epochsChecked, captureArtifacts });
    results.push(r);
    console.log(`  [${tag(r)}] Step 4 — ${r.name}`);
  }

  return results;
}
