import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Dataset, Bet, SeedEntry } from './types';

const DATA_DIR = path.join(__dirname, '..', 'data');
const MASTER_FILE = path.join(DATA_DIR, 'plinko-master-8100bets.json');
const CONFIG_FILE = path.join(__dirname, '..', 'plinkoConfig.json');

export const PLINKO_CONFIG_HASH = '78f0a39201a8c24fd1577143732e004f77e27d4d36efeedc6b3f7b93b2078fed';

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
