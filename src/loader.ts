import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Dataset, Bet, SeedEntry } from './types';

const DATA_DIR = path.join(__dirname, '..', 'data');
const MASTER_FILE = path.join(DATA_DIR, 'plinko-master-8100bets.json');
const CONFIG_FILE = path.join(__dirname, '..', 'plinkoConfig.json');

export const PLINKO_CONFIG_HASH = '78f0a39201a8c24fd1577143732e004f77e27d4d36efeedc6b3f7b93b2078fed';

/**
 * The dataset of record, by content.
 *
 * Declared here rather than beside the pre-flight guard in tests/verify.ts so that the guard and
 * the scored step that reports the comparison read ONE constant. Two copies of a pin are two
 * places it can be loosened, and only one of them is in the published evidence.
 */
export const EXPECTED_DATASET_SHA256 = '3cf9359d88220bc800bb32edfe04399f55b909302262928ee3a0582715635267';

export function loadDataset(): Dataset {
  const raw = fs.readFileSync(MASTER_FILE, 'utf8');
  return JSON.parse(raw) as Dataset;
}

export function loadMasterBuffer(): Buffer {
  return fs.readFileSync(MASTER_FILE);
}

export function getDatasetPath(): string {
  return MASTER_FILE;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function checkConfigHash(): { expected: string; actual: string; match: boolean } {
  const raw = fs.readFileSync(CONFIG_FILE);
  const actual = crypto.createHash('sha256').update(raw).digest('hex');
  return { expected: PLINKO_CONFIG_HASH, actual, match: actual === PLINKO_CONFIG_HASH };
}

/** Group bets by server_seed_hashed. */
export function groupByHash(bets: Bet[]): Map<string, Bet[]> {
  const map = new Map<string, Bet[]>();
  for (const bet of bets) {
    const h = bet.response.server_seed_hashed;
    if (!map.has(h)) map.set(h, []);
    map.get(h)!.push(bet);
  }
  return map;
}

/**
 * Build a Map<serverSeedHashed, { serverSeed, clientSeed }> for O(1) lookup.
 *
 * In the v3 dataset, seeds[N].seed.serverSeed is the PREVIOUS epoch's revealed seed
 * (revealed during rotation N). The plaintext for seeds[N].serverSeedHashed is in
 * seeds[N+1].seed.serverSeed (revealed during the next rotation).
 *
 * So: map[seeds[N].serverSeedHashed] = seeds[N+1].serverSeed
 */
export function revealedSeedMap(seeds: SeedEntry[]): Map<string, SeedEntry> {
  const crypto = require('crypto');
  const map = new Map<string, SeedEntry>();
  for (let i = 0; i < seeds.length - 1; i++) {
    const nextEntry = seeds[i + 1];
    if (nextEntry.seed.serverSeed !== null) {
      // Verify the revealed seed actually hashes to this entry's serverSeedHashed
      const hash = crypto.createHash('sha256')
        .update(Buffer.from(nextEntry.seed.serverSeed, 'hex'))
        .digest('hex');
      if (hash !== seeds[i].seed.serverSeedHashed) continue; // phase boundary — skip

      const synth: SeedEntry = {
        ...seeds[i],
        seed: { ...seeds[i].seed, serverSeed: nextEntry.seed.serverSeed },
      };
      map.set(seeds[i].seed.serverSeedHashed, synth);
    }
  }
  return map;
}

/**
 * Get all seed entries that have a revealed plaintext (via the next rotation).
 * Returns synthetic entries where serverSeed matches serverSeedHashed.
 */
export function revealedSeeds(seeds: SeedEntry[]): SeedEntry[] {
  const crypto = require('crypto');
  const result: SeedEntry[] = [];
  for (let i = 0; i < seeds.length - 1; i++) {
    const nextEntry = seeds[i + 1];
    if (nextEntry.seed.serverSeed !== null) {
      const hash = crypto.createHash('sha256')
        .update(Buffer.from(nextEntry.seed.serverSeed, 'hex'))
        .digest('hex');
      if (hash !== seeds[i].seed.serverSeedHashed) continue;
      result.push({
        ...seeds[i],
        seed: { ...seeds[i].seed, serverSeed: nextEntry.seed.serverSeed },
      });
    }
  }
  return result;
}

/** Bets for a specific phase. */
export function phaseBets(bets: Bet[], phase: 'A' | 'B' | 'C' | 'D'): Bet[] {
  return bets.filter(b => b.phase === phase);
}

// ── POPULATION OF RECORD ─────────────────────────────────────────────────────────
// The capture plan, stated as CODE so a shrunken dataset cannot pass by agreeing with
// itself. Deleting rounds and doctoring the header to match leaves a file that is
// internally consistent and re-pins cleanly — and re-pinning is exactly what a forger
// does, so the expected hash cannot see it. The counts have to be asserted from
// somewhere the dataset does not control, and a step that finds them wrong must
// HARD_FAIL. Step 14 previously validated phase LABELS but never the phase COUNTS,
// so a uniformly shrunken capture kept every label valid and passed.
export const EXPECTED_BETS  = 8100;
export const EXPECTED_SEEDS = 166;
export const EXPECTED_PHASE_BETS: Readonly<Record<string, number>> =
  Object.freeze({ A: 5400, B: 2000, C: 200, D: 500 });

/** Bets per commitment. The capture rotates the server seed every 50 rounds, in all four phases. */
export const EXPECTED_EPOCH_SIZE = 50;

/**
 * Commitments the capture plan covers: 8100 bets / 50 per epoch. Asserted separately from the
 * epoch SIZE because the two fail differently — a uniform shrink keeps every epoch the right
 * size and only the count notices, and a merge keeps the count and only the size notices.
 */
export const EXPECTED_EPOCHS = 162;

/**
 * Phase transitions in the capture plan: A→B, B→C, C→D.
 *
 * At each of these the end-of-phase rotation reveals the seed of the epoch that phase ENDED on,
 * not the one the next phase begins with, so the plaintext at that index does not hash to the
 * preceding record's commitment. That is a property of the capture plan, known in advance and
 * bounded by it — three transitions, no more — which is what makes it a declared exemption
 * rather than a heuristic that silently absorbs a genuine commitment break.
 */
export const EXPECTED_PHASE_BOUNDARIES = 3;

/** Distinct player-set client seeds the plan drives through Phase D. */
export const EXPECTED_PHASE_D_CLIENT_SEEDS = 10;
