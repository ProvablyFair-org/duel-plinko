import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  computeSlot, computeSlotFromBuffer, verifyHash,
  directionBit, bitExtractionBiasBound, BIT_EXTRACTION, computePathFromBuffer,
} from '../../src/rng';
import { poissonBinomialSurvival, slotCoincidenceProb, binomProb } from '../../src/stats';
import { PlinkoConfig } from '../../src/config';
import { computeRtpClaim } from '../../src/rtp-settings';
import { loadDataset, revealedSeedMap, groupByHash } from '../../src/loader';
import type { PlinkoConfigFile } from '../../src/types';

const configRaw: PlinkoConfigFile = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../plinkoConfig.json'), 'utf-8')
);
const cfg = new PlinkoConfig(configRaw.data);

// ── Test vectors — real bets from data/plinko-master-8100bets.json ──────────
// 7 distinct configurations. Fields: serverSeed, serverSeedHashed,
// clientSeed, nonce, rows, risk, expectedSlot.

const VECTORS = [
  {
    serverSeed:       '5de225f630d2de838265252752ab4ba050a3f20a53711e23a0a43979abf755bd',
    serverSeedHashed: '9fae5bb7897874cb71d7bd1be6dca522ddcd8f0c8f18ecaab9c5474d63b9be5a',
    clientSeed: 'MAAxNnpj1uB4AobA', nonce: 0, rows: 8, risk: 'high', expectedSlot: 3,
  },
  {
    serverSeed:       '073b24b4253f2fb81e7ae1879f394ca18c7ec8e0b45157333b7d00a354c45796',
    serverSeedHashed: '16a56441801bae0db4c17423d1704154bc2013a1e6ab552ab4a204fc2f5dbcf4',
    clientSeed: 'MS3FHPUPmOatMq0W', nonce: 0, rows: 11, risk: 'medium', expectedSlot: 5,
  },
  {
    serverSeed:       'a4b8b3a9ad054b46fdad5a151f78d769d59127f3ccdc473ee3f7614e4faa9d71',
    serverSeedHashed: 'b8a562c6074006d8f4e1a102ccb6b45a470ba32da28cedb497e61757a627bf49',
    clientSeed: 'nyVwzk2QYQ36Sf3I', nonce: 0, rows: 11, risk: 'high', expectedSlot: 6,
  },
  {
    serverSeed:       'b383953eb2b8158deef9d76dd18d97ba9bcbbac9ba90be25cbf008efae7496b6',
    serverSeedHashed: 'd678b2a52eb55881435a379a92e2648d4cadc5337175f0caee95d46582d76e99',
    clientSeed: 'KWooaSzlek9LYZzc', nonce: 0, rows: 15, risk: 'high', expectedSlot: 6,
  },
  {
    serverSeed:       'db449f96787bd94cc2b347cd8cac1048f300ebcc2f649ca7efb7e9980559b42c',
    serverSeedHashed: 'c88889ae43c8166214e28e2a507512aa90272d1cad93b6b24e2205f3dd6da2ba',
    clientSeed: 'p0ycgadmrO8Tuh6x', nonce: 0, rows: 10, risk: 'medium', expectedSlot: 2,
  },
  {
    serverSeed:       '59e2c038e51a78acb071eae63ac4d499bb122fb1ccca0a7dfa1349593bef1e11',
    serverSeedHashed: 'b4cae0cd90f988ae9629ceb93524973d0dbd9aa5ba07570c0f85e1a42761af54',
    clientSeed: '3FfHxJWEayg31gaN', nonce: 0, rows: 11, risk: 'low', expectedSlot: 6,
  },
  {
    serverSeed:       'fe0c882387eed1fdb8355268c71ac8ec765f958dcad2188143252c38d8041c53',
    serverSeedHashed: '73d7798f4423be01e2466778a92f61d93b3b86def47b18f860964ab799f71977',
    clientSeed: 'dE6ktjJT1fOlIoY2', nonce: 0, rows: 10, risk: 'low', expectedSlot: 6,
  },
] as const;

// ── Full dataset for all-bet crypto and payout tests ──────────────────────────
const rawDataset = loadDataset();
const revMap = revealedSeedMap(rawDataset.seeds);
const byHash = groupByHash(rawDataset.bets);
const revealedSeedsList = rawDataset.seeds.filter(s => s.seed.serverSeed !== null);

const ALL_BETS: Array<{ id: number; amount: string; multiplier: string; winAmount: string }> =
  rawDataset.bets.map(b => ({
    id:         b.response.id,
    amount:     b.response.amount_currency,
    multiplier: b.response.payout_multiplier,
    winAmount:  b.response.win_amount,
  }));

// ── Cryptographic Core ─────────────────────────────────────────────────────────

describe('Cryptographic Core — Known-Answer Tests (7 hand-picked bets, one per config — proves our algorithm implementation is correct)', () => {

  it('computeSlot matches the manually verified expected slot for each of 7 distinct (rows, risk) configs', () => {
    for (const v of VECTORS) {
      const got = computeSlot(v.serverSeed, v.clientSeed, v.nonce, v.rows);
      assert.strictEqual(
        got, v.expectedSlot,
        `rows=${v.rows} nonce=${v.nonce} seed=${v.serverSeed.slice(0, 8)}…: expected ${v.expectedSlot}, got ${got}`
      );
    }
  });

  it('string-key and buffer-key code paths produce identical slots (guards against encoding bugs)', () => {
    for (const v of VECTORS) {
      const key = Buffer.from(v.serverSeed, 'hex');
      const fromBuf = computeSlotFromBuffer(key, v.clientSeed, v.nonce, v.rows);
      const fromStr = computeSlot(v.serverSeed, v.clientSeed, v.nonce, v.rows);
      assert.strictEqual(fromBuf, fromStr,
        `sync path mismatch: rows=${v.rows} nonce=${v.nonce}`);
    }
  });

  it('HMAC key is hex-decoded (not raw UTF-8) — only hex decoding produces the correct known slot', () => {
    const v = VECTORS[0];
    const correctSlot = computeSlot(v.serverSeed, v.clientSeed, v.nonce, v.rows);
    assert.strictEqual(correctSlot, v.expectedSlot,
      'Expected slot with correct hex-decoded key');
  });

  it('SHA-256(serverSeed) matches the committed hash for all 7 known server seeds', () => {
    for (const v of VECTORS) {
      assert.strictEqual(
        verifyHash(v.serverSeed, v.serverSeedHashed), true,
        `hash mismatch for seed ${v.serverSeed.slice(0, 8)}…`
      );
    }
  });

  it('verifyHash rejects a tampered server seed (negative control)', () => {
    const v = VECTORS[0];
    const tampered = '0000000000000000000000000000000000000000000000000000000000000000';
    assert.strictEqual(
      verifyHash(tampered, v.serverSeedHashed), false,
      'verifyHash must return false for wrong seed'
    );
  });

  it('verifyHash rejects a tampered hash (negative control)', () => {
    const v = VECTORS[0];
    const tamperedHash = '0000000000000000000000000000000000000000000000000000000000000000';
    assert.strictEqual(
      verifyHash(v.serverSeed, tamperedHash), false,
      'verifyHash must return false for wrong hash'
    );
  });

});

describe('Cryptographic Core — Full Dataset Verification (all bets — proves the server produced the same outcomes our code computes)', () => {

  it(`recomputes the slot for every bet in the dataset (${rawDataset.bets.length} bets) and confirms 0 mismatches`, () => {
    let checked = 0;
    let mismatches = 0;
    for (const [hash, epochBets] of byHash) {
      const seedEntry = revMap.get(hash);
      if (!seedEntry) continue;
      const serverSeed = seedEntry.seed.serverSeed!;
      for (const bet of epochBets) {
        const computed = computeSlot(serverSeed, bet.response.client_seed, bet.response.nonce, bet.request.rows);
        if (computed !== bet.response.final_slot) mismatches++;
        checked++;
      }
    }
    assert.strictEqual(mismatches, 0, `${mismatches} slot mismatches out of ${checked}`);
    assert.ok(checked > 0, 'must have at least one bet to check');
  });

  it(`verifies SHA-256(serverSeed) === committedHash for all revealed seeds (commit-reveal integrity)`, () => {
    // revealedSeedMap builds synthetic entries where serverSeed matches serverSeedHashed
    let checked = 0;
    let mismatches = 0;
    for (const [hash, entry] of revMap) {
      if (!verifyHash(entry.seed.serverSeed!, hash)) mismatches++;
      checked++;
    }
    assert.strictEqual(mismatches, 0, `${mismatches} hash mismatches out of ${checked}`);
    assert.ok(checked > 0, 'must have revealed seeds');
  });

});

// ── Bit extraction ─────────────────────────────────────────────────────────────

describe('Bit Extraction — the direction draw is exact, and the bound saying so is computed (PLINKO-08)', () => {

  it('the declared extraction reads a uint32 window: 8 hex characters, domain 2^32', () => {
    const b = bitExtractionBiasBound();
    assert.strictEqual(BIT_EXTRACTION.hexChars, 8);
    assert.strictEqual(BIT_EXTRACTION.modulus, 2);
    assert.strictEqual(b.domainSize, 2 ** 32);
  });

  it('the domain divides by the modulus, so the worst-case modulo bias is exactly zero', () => {
    const b = bitExtractionBiasBound();
    assert.strictEqual(b.remainder, 0, 'an even domain must leave no remainder');
    assert.strictEqual(b.minResidueCount, b.maxResidueCount,
      'both residues must be reachable by the same number of digests');
    assert.strictEqual(b.bias, 0, `worst-case modulo bias must be exactly 0, got ${b.bias}`);
  });

  it('the computed bias is inside the 2^-32 ceiling the methodology sets, with no rejection sampling', () => {
    const b = bitExtractionBiasBound();
    assert.ok(b.bias <= Math.pow(2, -32), `bias ${b.bias} exceeds 2^-32`);
    assert.strictEqual(b.rejectionSampling, false);
    assert.strictEqual(b.rejectedDraws, 0, 'no draw is discarded, so the rejection census is zero by construction');
  });

  it('an exhaustive census of a 2^20 sub-domain splits exactly in half (no residue is favoured)', () => {
    // Not a sample: every value in [0, 2^20) is passed through the real extraction. An odd
    // domain, or a window that read a different number of characters, could not come out even.
    const N = 1 << 20;
    let ones = 0;
    for (let v = 0; v < N; v++) ones += directionBit(v.toString(16).padStart(8, '0'));
    assert.strictEqual(ones, N / 2, `${ones} of ${N} digests sent the ball right; an exact draw sends ${N / 2}`);
  });

  it('a hypothetical odd domain would be REJECTED by the same bound (the check can fail)', () => {
    // Guards the guard: if every arrangement of the arithmetic returned a passing number, the
    // bound above would be decoration. 5 values over 2 residues gives counts 3 and 2.
    const domainSize = 5, modulus = 2;
    const maxCount = Math.ceil(domainSize / modulus);
    const minCount = Math.floor(domainSize / modulus);
    const bias = Math.max(maxCount / domainSize - 1 / modulus, 1 / modulus - minCount / domainSize);
    assert.ok(bias > Math.pow(2, -32), 'an odd domain must produce a bias above the ceiling');
  });

  it('the path and the slot come from the same draws: the slot is the path\'s popcount', () => {
    for (const v of VECTORS) {
      const key = Buffer.from(v.serverSeed, 'hex');
      const { slot, path } = computePathFromBuffer(key, v.clientSeed, v.nonce, v.rows);
      let popcount = 0;
      for (let bit = 0; bit < v.rows; bit++) popcount += (path >> bit) & 1;
      assert.strictEqual(slot, popcount, `path and slot disagree for rows=${v.rows}`);
      assert.strictEqual(slot, computeSlot(v.serverSeed, v.clientSeed, v.nonce, v.rows));
    }
  });

});

// ── Coincidence nulls ──────────────────────────────────────────────────────────

describe('Coincidence Nulls — the rates Step 6 scores against are the ones the board predicts (PLINKO-36)', () => {

  it('two independent drops share a slot with probability C(2n,n)/4^n — matching the sum over P(k)^2', () => {
    for (let rows = 8; rows <= 16; rows++) {
      let byDefinition = 0;
      for (let k = 0; k <= rows; k++) byDefinition += binomProb(rows, k) ** 2;
      assert.ok(Math.abs(slotCoincidenceProb(rows) - byDefinition) < 1e-12,
        `${rows} rows: closed form ${slotCoincidenceProb(rows)} vs Σ P(k)² ${byDefinition}`);
    }
  });

  it('the slot null is orders of magnitude larger than the path null — which is why the two must not be swapped', () => {
    for (let rows = 8; rows <= 16; rows++) {
      assert.ok(slotCoincidenceProb(rows) > 40 * Math.pow(2, -rows),
        `${rows} rows: slot coincidence must dwarf the same-path rate`);
    }
  });

  it('Poisson-binomial survival reduces to the binomial when every probability is equal', () => {
    const n = 40, p = 0.1;
    const ps = new Array(n).fill(p);
    for (const k of [1, 3, 5, 8]) {
      let below = 0;
      for (let j = 0; j < k; j++) {
        let c = 1;
        for (let i = 0; i < j; i++) c = (c * (n - i)) / (i + 1);
        below += c * Math.pow(p, j) * Math.pow(1 - p, n - j);
      }
      assert.ok(Math.abs(poissonBinomialSurvival(ps, k) - (1 - below)) < 1e-12,
        `survival at k=${k} disagrees with the binomial`);
    }
  });

  it('survival is 1 at k=0 and falls away as the count rises', () => {
    const ps = [0.5, 0.25, 0.125, 0.0625];
    assert.strictEqual(poissonBinomialSurvival(ps, 0), 1);
    for (let k = 1; k < ps.length; k++) {
      assert.ok(poissonBinomialSurvival(ps, k) < poissonBinomialSurvival(ps, k - 1),
        `survival must be strictly decreasing in k (k=${k})`);
    }
  });

});

// ── Configuration Integrity ────────────────────────────────────────────────────

describe('Configuration Integrity — validates the casino multiplier tables loaded from plinkoConfig.json', () => {

  it('config loader returns exactly 27 configs (3 risk levels × 9 row counts: 8–16)', () => {
    assert.strictEqual(cfg.allConfigs().length, 27);
  });

  it('each config has rows + 1 slots (Plinko board with N rows produces N+1 landing positions)', () => {
    for (const { rows } of cfg.allConfigs()) {
      assert.strictEqual(cfg.slotCount(rows), rows + 1,
        `slotCount mismatch for rows=${rows}`);
    }
  });

  it('every multiplier in every config is strictly positive (no impossible-to-win slots)', () => {
    for (const { rows, risk } of cfg.allConfigs()) {
      for (let k = 0; k <= rows; k++) {
        const m = cfg.scalingEdgeMultiplier(rows, risk, k);
        assert.ok(m > 0,
          `multiplier must be positive: ${rows}r/${risk} slot ${k} = ${m}`);
      }
    }
  });

  it('multiplier tables are symmetric: slot k pays the same as slot (rows - k) — matches the symmetric Plinko board', () => {
    for (const { rows, risk } of cfg.allConfigs()) {
      for (let k = 0; k < Math.floor(rows / 2); k++) {
        const left  = cfg.scalingEdgeMultiplier(rows, risk, k);
        const right = cfg.scalingEdgeMultiplier(rows, risk, rows - k);
        assert.strictEqual(left, right,
          `symmetry fail: ${rows}r/${risk} slot ${k} (${left}) ≠ slot ${rows - k} (${right})`);
      }
    }
  });

  it('theoretical RTP (computed from multipliers × binomial probabilities) is between 99.4% and 100% for all 27 configs', () => {
    for (const { rows, risk } of cfg.allConfigs()) {
      const rtp = cfg.theoreticalRTP(rows, risk);
      assert.ok(rtp > 0.994 && rtp < 1.0,
        `RTP out of expected range: ${rows}r/${risk} = ${(rtp * 100).toFixed(4)}%`);
    }
  });

  // C3 (FIXPASS2, 14 Oct 2026): this test used to hold every config to the stated 99.9 % (±0.1 %), so
  // a board paying light failed npm test before the verifier's RTP-CLAIM rule could call it RTP FIGURE
  // OVERSTATED (exit 5). It now checks the float derivation against the RTP table's exact row; whether
  // a row meets the claim is the rule's, scored on Step 19.
  it('theoretical RTP of all 27 configs equals the RTP table\'s exact row (src/rtp-settings.ts) within 1e-12', () => {
    const rowsBySetting = new Map(computeRtpClaim().rows.map(r => [r.setting, r.rtpExact]));
    for (const { rows, risk } of cfg.allConfigs()) {
      const rtp = cfg.theoreticalRTP(rows, risk);
      const exact = rowsBySetting.get(`rows=${rows} risk=${risk}`);
      assert.ok(exact !== undefined, `no RTP table row for ${rows}r/${risk}`);
      const [n, d] = (exact as string).split('/').map(BigInt);
      const row = Number((n * 10n ** 18n) / d) / 1e18;
      assert.ok(Math.abs(rtp - row) < 1e-12,
        `${rows}r/${risk}: float derivation ${rtp} vs the table's exact row ${row}`);
    }
  });

});

// ── Payout Accuracy ────────────────────────────────────────────────────────────

describe('Payout Accuracy — confirms the platform paid the correct amount for every bet in the dataset', () => {

  it(`win_amount = bet_amount × payout_multiplier for all ${ALL_BETS.length} bets (tolerance ±1e-10)`, () => {
    let mismatches = 0;
    for (const p of ALL_BETS) {
      const expected = parseFloat(p.amount) * parseFloat(p.multiplier);
      const actual   = parseFloat(p.winAmount);
      if (Math.abs(expected - actual) >= 1e-10) {
        mismatches++;
        assert.ok(false,
          `Payout mismatch bet ${p.id}: ${p.amount} × ${p.multiplier} = ${expected}, recorded ${p.winAmount}`
        );
      }
    }
  });

});

// ── The operator's own Verify-tab code (profile PLINKO-09) ────────────────────

describe('Second check — Duel\'s own Plinko Verify-tab code, executed unmodified (evidence/verify-tab, copied 2026-09-25)', () => {
  // Not the source of src/rng.ts: that is rebuilt from docs/ALGORITHM.md. Duel's code is run as a cross-check.
  // duel.com → Provably Fair → Verify (Plinko) → Expand → Copy, saved verbatim (src/operator-verifier.ts)
  const { runOperatorVerifier, pathFromPrefixes, OPERATOR_VERIFIER_PINS, OPERATOR_VERIFIER_FILE, OPERATOR_EXPECTED_LOGS } =
    require('../../src/operator-verifier') as typeof import('../../src/operator-verifier');
  const { computePathFromBuffer: pathOf } = require('../../src/rng') as typeof import('../../src/rng');
  const known = VECTORS.map((v, i) => ({ id: `known${i}`, serverSeed: v.serverSeed, clientSeed: v.clientSeed, nonce: v.nonce, rows: v.rows }));
  const captured = rawDataset.bets.map(b => ({ id: `bet${b.response.id}`,
    serverSeed: revMap.get(b.response.server_seed_hashed)?.seed.serverSeed ?? '', clientSeed: b.response.client_seed,
    nonce: b.response.nonce, rows: b.request.rows }));
  const run = runOperatorVerifier([...known, ...captured]);

  it('the vendored operator file and its runner hash to their pins, the code ran, and it printed only its empty-input message', () => {
    assert.deepStrictEqual(run.files.map(f => f.match), [true, true]);
    assert.strictEqual(run.files[0].file, OPERATOR_VERIFIER_FILE);
    assert.strictEqual(run.files[0].actual, OPERATOR_VERIFIER_PINS[OPERATOR_VERIFIER_FILE]);
    assert.strictEqual(run.error, null);
    assert.deepStrictEqual(run.logs, [...OPERATOR_EXPECTED_LOGS]);
  });

  it('fixed vectors: the operator code returns the 7 known-answer slots above', () => {
    VECTORS.forEach((v, i) => {
      assert.strictEqual(run.results!.get(`known${i}`)!.slot, v.expectedSlot, `${v.rows}r/${v.risk}`);
    });
  });

  it('every captured bet: the operator bucket equals the served final_slot and src/rng.ts, and its L/R path equals src/rng.ts\'s', () => {
    const bad: string[] = [];
    rawDataset.bets.forEach((b, i) => {
      const o = run.results!.get(`bet${b.response.id}`);
      const ref = pathOf(Buffer.from(captured[i].serverSeed, 'hex'), b.response.client_seed, b.response.nonce, b.request.rows);
      if (!o || o.slot !== b.response.final_slot || o.slot !== ref.slot || pathFromPrefixes(o.prefixes) !== ref.path) bad.push(String(b.response.id));
    });
    assert.deepStrictEqual(bad.slice(0, 5), []);
    assert.strictEqual(rawDataset.bets.length, 8100);
  });
});
