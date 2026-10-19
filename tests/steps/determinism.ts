/**
 * Steps 5–6: RNG Determinism
 * EC-6, EC-7, EC-27
 */

import type { StepResult, RiskLevel } from '../../src/types';
import { computeSlot, computePathFromBuffer, bitExtractionBiasBound } from '../../src/rng';
import { EXPECTED_BETS } from '../../src/loader';
import { poissonBinomialSurvival, slotCoincidenceProb } from '../../src/stats';
import { pass, fail, VerifyContext, tag } from './context';
import { loadSiteVerifier, SITE_VERIFIER_PROVENANCE, DECLARED_SITE_MULTIPLIER_DIVERGENCE } from '../../src/site-verifier';
import { runLiveSiteVerifier, LIVE_SITE_PROVENANCE } from '../../src/live-site-verifier';
import {
  runOperatorVerifier, checkOperatorCites, pathFromPrefixes, OPERATOR_EXPECTED_LOGS, OPERATOR_VERIFIER_PROVENANCE,
} from '../../src/operator-verifier';

/**
 * The profile's ceiling on modulo bias in the direction extraction (methodology S2): an
 * extraction biased by more than one part in 2^32, without rejection sampling to correct it, is
 * a hard fail. Declared here as the number it is so the comparison in Step 5 is arithmetic.
 */
const BIT_BIAS_CEILING = Math.pow(2, -32);

/**
 * Significance level for the same-path coincidence test in Step 6. One-sided: only an EXCESS of
 * coincidences is evidence that the client seed is not reaching the HMAC.
 */
const SAME_PATH_ALPHA = 1e-3;

export function run(ctx: VerifyContext): StepResult[] {
  const { byHash, revealedMap, determinismLog, cfg } = ctx;
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

    // COVERAGE IS PART OF THE ASSERTION. Scoring only `failures.length === 0` made an
    // unrecomputed bet free: withhold every server seed and the step recomputes nothing,
    // finds no mismatch and passes. A bet whose epoch was never revealed is not verified,
    // so it is a failure of this step rather than an exclusion from it, and the number
    // recomputed must equal the audited population in src/loader.ts — not the number of
    // bets that happened to carry a revealed seed.
    const coverageIssues: string[] = [];
    if (skipped !== 0) coverageIssues.push(`${skipped} bets were not recomputed (their epoch's server seed is unrevealed)`);
    if (checked !== EXPECTED_BETS) coverageIssues.push(`${checked} bets recomputed, ${EXPECTED_BETS} declared in src/loader.ts EXPECTED_BETS`);

    // ── Bit-extraction bias bound ──────────────────────────────────────────────
    // Reproducing every slot proves the algorithm is the one the operator ran. It says nothing
    // about whether that algorithm draws left and right EQUALLY — and if the extraction's domain
    // did not divide by two, every one of these 8,100 agreements would be an agreement about a
    // board that leans. The bound is computed from the same parameters directionBit() reads, so
    // it describes the extraction that produced these slots, and it is compared against the
    // profile's ceiling rather than asserted to be fine.
    const bias = bitExtractionBiasBound();
    const biasIssues: string[] = [];
    if (!(bias.bias <= BIT_BIAS_CEILING)) {
      biasIssues.push(
        `direction extraction bias exceeds the ceiling: ${bias.bias} > 2^-32, `
        + `domain 16^${bias.hexChars} leaves remainder ${bias.remainder} over modulus ${bias.modulus}`
      );
    }
    if (!bias.exact && !bias.rejectionSampling) {
      biasIssues.push(
        `the extraction domain does not divide by ${bias.modulus} and no rejection sampling corrects it`
      );
    }

    // ── Player-verifier parity (profile PLINKO-24) ─────────────────────────────
    // Two site verifiers a player can paste a bet into, each EXECUTED from pinned bytes on every
    // captured bet — not re-typed. Slot, path and (live) commitment must equal src/rng.ts on every
    // bet; the multiplier must equal what Duel served, except for the DECLARED divergence of the
    // docusaurus table (src/site-verifier.ts, L5), which must reproduce exactly as declared.
    const siteIssues: string[] = [];
    const pathString = (p: number, rows: number): string =>
      p.toString(2).padStart(rows, '0').replace(/1/g, 'R').replace(/0/g, 'L');
    const siteBets = [...byHash].flatMap(([hash, eb]) => {
      const s = revealedMap.get(hash);
      return s ? eb.map(bet => ({ bet, serverSeed: s.seed.serverSeed! })) : [];
    });

    // (1) docusaurus VerifyBets derive.js (+ paytables.js, scalingEdge.js, lib/hmac-sha256.js)
    const site = loadSiteVerifier();
    let siteChecked = 0, siteSlotOrPath = 0, siteMultDeclared = 0, siteMultUndeclared = 0, siteMaxDelta = 0;
    const siteCells = new Set<string>();
    if (!site.derivePlinko) {
      siteIssues.push(`docusaurus site verifier: ${site.error}`);
    } else {
      for (const { bet, serverSeed } of siteBets) {
        const { client_seed, nonce, final_slot, payout_multiplier } = bet.response;
        const { rows, risk } = bet.request;
        const ref = computePathFromBuffer(Buffer.from(serverSeed, 'hex'), client_seed, nonce, rows);
        const out = site.derivePlinko({ clientSeed: client_seed, serverSeed, nonce, rows, risk });
        siteChecked++;
        if (out.slot !== ref.slot || out.slot !== final_slot || out.path !== pathString(ref.path, rows)) {
          siteSlotOrPath++;
          if (siteIssues.length < 10) siteIssues.push(`docusaurus site verifier, bet ${bet.response.id}: slot ${out.slot} path ${out.path}; src/rng.ts slot ${ref.slot} path ${pathString(ref.path, rows)}; served slot ${final_slot}`);
        }
        const served = parseFloat(payout_multiplier);
        if (out.multiplier !== served) {
          const pt = cfg.payoutTableMultiplier(rows, risk as RiskLevel, out.slot);
          const se = cfg.scalingEdgeMultiplier(rows, risk as RiskLevel, out.slot);
          const delta = Math.abs(out.multiplier - served);
          if (out.multiplier === pt && pt !== se && se === served && delta <= DECLARED_SITE_MULTIPLIER_DIVERGENCE.maxAbsDelta) {
            siteMultDeclared++;
            siteCells.add(`${rows}/${risk}/${out.slot}`);
            if (delta > siteMaxDelta) siteMaxDelta = delta;
          } else {
            siteMultUndeclared++;
            if (siteIssues.length < 10) siteIssues.push(`docusaurus site verifier, bet ${bet.response.id}: multiplier ${out.multiplier} vs served ${payout_multiplier} — not the declared payout_tables divergence`);
          }
        }
      }
      if (siteChecked !== EXPECTED_BETS) siteIssues.push(`docusaurus site verifier ran on ${siteChecked} bets, ${EXPECTED_BETS} declared`);
      const d = DECLARED_SITE_MULTIPLIER_DIVERGENCE;
      if (siteMultDeclared !== d.betsAffected || siteCells.size !== d.cellsHit) {
        siteIssues.push(`docusaurus site verifier multiplier divergence is ${siteMultDeclared} bets on ${siteCells.size} cells; `
          + `declared ${d.betsAffected} bets on ${d.cellsHit} cells (src/site-verifier.ts, L5) — retire or update the declaration`);
      }
    }

    // (2) the live www.provablyfair.org/verify-bets bundle (Duel.com → verifyDuelsGame → plinko)
    const live = runLiveSiteVerifier('Duel.com', siteBets.map(({ bet, serverSeed }) => ({
      id: bet.response.id, serverSeed, clientSeed: bet.response.client_seed, nonce: bet.response.nonce,
      rows: bet.request.rows, risk: bet.request.risk,
    })));
    let liveChecked = 0, liveMismatch = 0;
    if (!live.printed) {
      siteIssues.push(`live-site verifier: ${live.error}`);
    } else {
      for (const { bet, serverSeed } of siteBets) {
        const p = live.printed.get(String(bet.response.id));
        const { client_seed, nonce, final_slot, payout_multiplier, server_seed_hashed } = bet.response;
        const { rows } = bet.request;
        const ref = computePathFromBuffer(Buffer.from(serverSeed, 'hex'), client_seed, nonce, rows);
        const served = parseFloat(payout_multiplier);
        const shown = p?.multiplierText == null ? NaN : parseFloat(p.multiplierText);
        const halfUnit = p?.multiplierDecimals == null ? NaN : 0.5 * Math.pow(10, -p.multiplierDecimals);
        const ok = !!p
          && p.slotFromDirection === final_slot && p.slotFromBuckets === final_slot && ref.slot === final_slot
          && p.bucketCount === rows + 1
          && p.path === pathString(ref.path, rows)
          && p.serverSeedHash === server_seed_hashed
          // The page prints the paytable cell rounded for display ("0.30x"); the served multiplier
          // must round to what it printed: |printed − served| ≤ half a unit of the printed precision.
          && Math.abs(shown - served) <= halfUnit + 1e-12;
        if (p) liveChecked++;
        if (!ok) {
          liveMismatch++;
          if (siteIssues.length < 10) siteIssues.push(`live-site verifier, bet ${bet.response.id}: printed ${JSON.stringify(p)}; src/rng.ts slot ${ref.slot} path ${pathString(ref.path, rows)}; served slot ${final_slot} ×${payout_multiplier}`);
        }
      }
      if (liveChecked !== EXPECTED_BETS) siteIssues.push(`live-site verifier printed ${liveChecked} bets, ${EXPECTED_BETS} declared`);
    }
    if (siteSlotOrPath > 0) siteIssues.unshift(`docusaurus site verifier disagrees with src/rng.ts on ${siteSlotOrPath} bet(s)`);
    if (siteMultUndeclared > 0) siteIssues.unshift(`docusaurus site verifier multiplier differs from the served one on ${siteMultUndeclared} bet(s) outside the declared divergence`);
    if (liveMismatch > 0) siteIssues.unshift(`live-site verifier disagrees on ${liveMismatch} bet(s)`);

    // ── Operator-code parity (profile PLINKO-09) ───────────────────────────────
    // Duel's own Plinko code panel (duel.com → Provably Fair → Verify → Expand → Copy, 2026-09-25),
    // vendored verbatim under evidence/verify-tab/ and pinned in src/operator-verifier.ts, EXECUTED
    // unmodified on every captured bet: its validatePlinkoResult bucket must equal the served
    // final_slot and src/rng.ts, and the L/R path read from its own prefix sums must equal
    // src/rng.ts's path. It must print only its empty-input message, and every operator line
    // src/rng.ts cites must carry the quoted text. HARD FAIL otherwise, or on a count other than
    // EXPECTED_BETS.
    const opIssues: string[] = [];
    const op = runOperatorVerifier(siteBets.map(({ bet, serverSeed }) => ({
      id: String(bet.response.id), serverSeed, clientSeed: bet.response.client_seed, nonce: bet.response.nonce, rows: bet.request.rows,
    })));
    const opCites = checkOperatorCites();
    let opChecked = 0, opSlotVsServed = 0, opSlotVsRng = 0, opPathVsRng = 0;
    if (!op.results) {
      opIssues.push(`operator Verify-tab code: ${op.error}`);
    } else {
      const logsOk = op.logs.length === OPERATOR_EXPECTED_LOGS.length && op.logs.every((l, i) => l === OPERATOR_EXPECTED_LOGS[i]);
      if (!logsOk) opIssues.push(`operator Verify-tab code printed ${JSON.stringify(op.logs).slice(0, 200)} — not only its empty-input message`);
      for (const { bet, serverSeed } of siteBets) {
        const o = op.results.get(String(bet.response.id));
        const { client_seed, nonce, final_slot } = bet.response;
        const { rows } = bet.request;
        const ref = computePathFromBuffer(Buffer.from(serverSeed, 'hex'), client_seed, nonce, rows);
        if (o) opChecked++;
        const opPath = pathFromPrefixes(o?.prefixes ?? null);
        const bad: string[] = [];
        if (!o || o.slot !== final_slot) { opSlotVsServed++; bad.push(`bucket ${o?.slot} vs served ${final_slot}`); }
        if (!o || o.slot !== ref.slot) { opSlotVsRng++; bad.push(`bucket ${o?.slot} vs src/rng.ts ${ref.slot}`); }
        if (opPath === null || opPath !== ref.path || o?.prefixes?.length !== rows) {
          opPathVsRng++; bad.push(`path ${opPath === null ? 'unreadable' : pathString(opPath, rows)} vs src/rng.ts ${pathString(ref.path, rows)}`);
        }
        if (bad.length && opIssues.length < 10) opIssues.push(`operator Verify-tab code, bet ${bet.response.id}: ${bad.join('; ')}`);
      }
      if (opChecked !== EXPECTED_BETS) opIssues.push(`operator Verify-tab code ran on ${opChecked} bets, ${EXPECTED_BETS} declared`);
    }
    if (opCites.bad.length > 0 || opCites.checked === 0) opIssues.push(`src/rng.ts operator citations: ${opCites.bad.slice(0, 2).join('; ')}`);
    if (opSlotVsServed + opSlotVsRng + opPathVsRng > 0) {
      opIssues.unshift(`operator Verify-tab code disagrees: bucket vs served on ${opSlotVsServed}, bucket vs src/rng.ts on ${opSlotVsRng}, path vs src/rng.ts on ${opPathVsRng} bet(s)`);
    }
    siteIssues.push(...opIssues);

    const details5 = {
      checked, skipped, expected: EXPECTED_BETS,
      totalMismatches: failures.length,
      bitExtraction: {
        ...bias,
        ceiling: BIT_BIAS_CEILING,
        withinCeiling: bias.bias <= BIT_BIAS_CEILING,
      },
      siteVerifierParity: {
        docusaurus: {
          files: site.files, provenance: SITE_VERIFIER_PROVENANCE, error: site.error,
          betsExecuted: siteChecked, slotOrPathMismatches: siteSlotOrPath,
          multiplierDivergence: { measuredBets: siteMultDeclared, measuredCells: siteCells.size, measuredMaxAbsDelta: siteMaxDelta,
            outsideDeclaration: siteMultUndeclared, declared: DECLARED_SITE_MULTIPLIER_DIVERGENCE },
          bracketIndex: 0,
        },
        liveSite: {
          files: live.files, provenance: LIVE_SITE_PROVENANCE, error: live.error, standIns: live.standIns,
          betsPrinted: liveChecked, mismatches: liveMismatch,
          compared: 'slot (both printed forms), bucket count, L/R path, serverSeedHash, multiplier at the printed precision',
        },
      },
      operatorVerifier: {
        files: op.files, provenance: OPERATOR_VERIFIER_PROVENANCE, error: op.error,
        betsExecuted: opChecked, bucketVsServed: opSlotVsServed, bucketVsRng: opSlotVsRng, pathVsRng: opPathVsRng,
        citesChecked: opCites.checked, citesBad: opCites.bad.length,
        compared: 'validatePlinkoResult bucket vs served final_slot and src/rng.ts; L/R path from its own prefix sums vs src/rng.ts',
      },
    };

    const r = failures.length === 0 && coverageIssues.length === 0 && biasIssues.length === 0 && siteIssues.length === 0
      ? pass(5, 'Slot Recomputation & Bit-Extraction Bound', ['EC-6', 'EC-7'],
          `All ${checked}/${EXPECTED_BETS} bets recomputed, 0 skipped: HMAC-SHA256 recompute matches final_slot. Outcome `
          + `reproduces exactly from (server seed, client seed, nonce) — no external entropy. The direction extraction `
          + `reads ${bias.hexChars} hex characters and takes the result modulo ${bias.modulus}; the domain divides `
          + `exactly, so the worst-case modulo bias is computed rather than estimated and is reported in details `
          + `against the profile's 2^-32 ceiling. No draw is rejected. Player-verifier parity (PLINKO-24): the pinned `
          + `ProvablyFair.org docusaurus derive.js and the pinned live /verify-bets bundle were each executed on all `
          + `${siteChecked}/${liveChecked} bets — slot and L/R path equal src/rng.ts on every bet, the live page's `
          + `commitment hash and display-rounded multiplier agree with the capture on every bet; the docusaurus `
          + `multiplier differs from the served one on exactly the declared ${siteMultDeclared} bets (its table is `
          + `payout_tables, Duel pays scaling_edge[0]; largest gap ${siteMaxDelta.toExponential(2)}; L5). `
          + `Operator-code parity (PLINKO-09): Duel's own Plinko Verify-tab code (${OPERATOR_VERIFIER_PROVENANCE.savedAs}, `
          + `copied ${OPERATOR_VERIFIER_PROVENANCE.copiedOn}, SHA-256-pinned) executed unmodified on ${opChecked}/${EXPECTED_BETS} bets — `
          + `its bucket equals the served final_slot and src/rng.ts on every bet, and the L/R path read from its own prefix sums `
          + `equals src/rng.ts's (${opSlotVsServed + opSlotVsRng + opPathVsRng} disagreements); operator lines cited by src/rng.ts `
          + `${opCites.checked - opCites.bad.length}/${opCites.checked} verbatim.`,
          details5)
      : fail(5, 'Slot Recomputation & Bit-Extraction Bound', ['EC-6', 'EC-7'], 'HARD_FAIL',
          failures.length
            ? `${failures.length} slot mismatches out of ${checked}`
            : biasIssues.length
              ? `BIT EXTRACTION: ${biasIssues.join('; ')}`
              : coverageIssues.length
                ? `COVERAGE: ${coverageIssues.join('; ')}`
                : opIssues.length
                  ? `OPERATOR VERIFY-TAB CODE PARITY: ${opIssues[0]}`
                  : `SITE VERIFIER PARITY: ${siteIssues[0]}`,
          [...coverageIssues, ...biasIssues, ...siteIssues, ...failures.slice(0, 20)],
          details5);
    results.push(r);
    console.log(`  [${tag(r)}] Step 5 — ${r.name}`);
  }

  // ── Step 6: Client Seed Influence (EC-27) ─────────────────────────────────────
  //
  // SCORED AGAINST WHAT THE BOARD PREDICTS, NOT AGAINST ZERO.
  //
  // The old test asked only whether SOME slot changed when the client seed was replaced. That
  // floor is almost impossible to fail: two independent drops on a twelve-row board land in the
  // same slot about 16 % of the time anyway, so an implementation that ignored the client seed
  // for one bet in five would still change "most" slots and pass. And a percentage pooled across
  // boards of 8 to 16 rows is a number about no board in particular — coincidence is 256 times
  // likelier on the smallest board than on the largest.
  //
  // Two statistics replace it, each against its own exact null and each aggregated by
  // Poisson-binomial survival over the per-bet probability of ITS OWN board:
  //
  //   path  — the ordered sequence of directions. Coincides with probability exactly 2^-rows.
  //           This is the sharp test: on this population the null expects about five coincidences
  //           in 8,100 drops, so a client seed quietly dropped from the HMAC is unmissable.
  //   slot  — the sum. Coincides with probability C(2·rows, rows)/4^rows, which is large. Kept
  //           because the slot is what the player is paid on, and reported against its own null
  //           so its size cannot be mistaken for a weak result.
  //
  // The floor survives underneath both: an epoch where nothing at all moved still fails.
  {
    const wrongClientSeed = 'WRONG_CLIENT_SEED_FOR_AUDIT_TEST';
    const failures: string[] = [];
    let totalChanged = 0;
    let totalChecked = 0;
    let samePathCount = 0;
    let sameSlotCount = 0;
    const pathNullPs: number[] = [];
    const slotNullPs: number[] = [];
    const epochResults: { hash: string; changed: number; total: number }[] = [];

    for (const [hash, epochBets] of byHash) {
      const seedEntry = revealedMap.get(hash);
      if (!seedEntry || epochBets.length !== 50) continue;
      const serverSeed = seedEntry.seed.serverSeed!;
      const key = Buffer.from(serverSeed, 'hex');
      let changed = 0;
      for (const bet of epochBets) {
        const { client_seed, nonce } = bet.response;
        const { rows } = bet.request;
        const real  = computePathFromBuffer(key, client_seed, nonce, rows);
        const wrong = computePathFromBuffer(key, wrongClientSeed, nonce, rows);
        if (wrong.slot !== real.slot) changed++; else sameSlotCount++;
        if (wrong.path === real.path) samePathCount++;
        pathNullPs.push(Math.pow(2, -rows));
        slotNullPs.push(slotCoincidenceProb(rows));
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

    const pathExpected = pathNullPs.reduce((a, b) => a + b, 0);
    const slotExpected = slotNullPs.reduce((a, b) => a + b, 0);
    const pathSurvival = poissonBinomialSurvival(pathNullPs, samePathCount);
    const slotSurvival = poissonBinomialSurvival(slotNullPs, sameSlotCount);

    if (totalChecked > 0 && pathSurvival < SAME_PATH_ALPHA) {
      failures.push(
        `same-path coincidences exceed the exact null: ${samePathCount} observed against a Poisson-binomial `
        + `expectation of ${pathExpected.toFixed(4)} over Σ 2^-rows, survival below the declared alpha`
      );
    }
    if (totalChecked > 0 && slotSurvival < SAME_PATH_ALPHA) {
      failures.push(
        `same-slot coincidences exceed the exact null: ${sameSlotCount} observed against a Poisson-binomial `
        + `expectation of ${slotExpected.toFixed(2)} over Σ C(2·rows,rows)/4^rows, survival below the declared alpha`
      );
    }

    const details = {
      epochsTested: epochResults.length,
      totalChecked,
      totalChanged,
      alpha: SAME_PATH_ALPHA,
      samePath: {
        observed: samePathCount,
        expectedUnderNull: pathExpected,
        survival: pathSurvival,
        null: 'per-bet 2^-rows of the bet\'s own board, aggregated by exact Poisson-binomial survival',
      },
      sameSlot: {
        observed: sameSlotCount,
        expectedUnderNull: slotExpected,
        survival: slotSurvival,
        null: 'per-bet C(2·rows,rows)/4^rows of the bet\'s own board, aggregated by exact Poisson-binomial survival',
      },
      wrongClientSeed,
      epochResults,
    };

    const r = failures.length === 0
      ? pass(6, 'Client Seed Influence (exact null)', ['EC-27'],
          `Re-dropping all ${totalChecked} bets under a wrong client seed on the same server seed and nonce: the ordered `
          + `path coincided ${samePathCount} time(s) and the landing slot ${sameSlotCount} time(s), each scored against the `
          + `exact Poisson-binomial null of its own board rather than against a round-number rate, at alpha ${SAME_PATH_ALPHA}. `
          + `Expectations, survivals and the wrong seed used are in details. No epoch was unchanged.`,
          details)
      : fail(6, 'Client Seed Influence (exact null)', ['EC-27'], 'HARD_FAIL',
          'Client seed influence test failed', failures, details);
    results.push(r);
    console.log(`  [${tag(r)}] Step 6 — ${r.name}`);
  }

  return results;
}
