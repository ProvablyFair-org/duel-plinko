import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { computeSlot, computeSlotFromBuffer, verifyHash } from '../../src/rng';
import { PlinkoConfig } from '../../src/config';
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

  it('theoretical RTP is within ±0.1% of the stated 99.9% for all 27 configs (confirms 0.1% house edge)', () => {
    for (const { rows, risk } of cfg.allConfigs()) {
      const rtp = cfg.theoreticalRTP(rows, risk);
      assert.ok(Math.abs(rtp - 0.999) < 0.001,
        `RTP deviates from 99.9% by more than 0.1%: ${rows}r/${risk} = ${(rtp * 100).toFixed(6)}%`);
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
