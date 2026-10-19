/**
 * PASS 2, REPLAYED IN VERIFY — the shared machinery of Step 20 (profile PLINKO-21).
 *
 * ONE HMAC SCAN SERVES EVERY PASS-2 STATISTIC. A Plinko drop on an r-row board is the sum of the
 * direction bits of cursors 0..r−1 of HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${cursor}`)
 * (src/rng.ts). The bits do not depend on r, so one scan of cursors 0..C−1 at a nonce gives the slot
 * of EVERY board with r ≤ C: slot(r) = popcount of the first r bits. The kernel below records, per
 * nonce, the first C direction bits as an integer PATH (row 0 is the high bit, as in
 * src/rng.ts computePathFromBuffer), using the package's own computePathFromBuffer. From those paths
 * Step 20 re-derives Tests A and B of the committed artifact AND computes Test C, the profile's
 * payout-weighted statistic, without a second HMAC pass.
 *
 * THE TEST C NULL IS CALIBRATED ON FRESH SEEDS. Duel's multipliers carry 8 decimals, too fine a
 * lattice for an exact convolution, so the profile's route applies: Monte-Carlo calibration on
 * ≥ 10,000 fresh seeds with the same window. PASS2_NULL_SEEDS fresh seed pairs are derived by a
 * FIXED RULE (nullSeed below — SHA-256 of a public label and the index), so the calibration is
 * reproducible byte for byte and cannot be re-drawn until it looks right; each calibration seed plays
 * nonces 0..49 through the same HMAC, and a window of a served configuration sequence reads its slots
 * from those paths exactly as an epoch does.
 */

import { createHash } from 'crypto';
import { computePathFromBuffer } from './rng';

/** Direction bits recorded per nonce: the largest board has 16 rows. */
export const MAX_CURSORS = 16;

/** Fresh calibration seeds for the Test C null (profile PLINKO-21: ≥ 10,000). */
export const PASS2_NULL_SEEDS = 10_000;

/** The public label the calibration seeds are derived from. Changing it changes every null. */
export const PASS2_NULL_LABEL = 'pf-duel-plinko-pass2-testC-null-2026-09-24';

/** Calibration seed pair r: server = SHA-256(label:r:server), client = first 16 hex of SHA-256(label:r:client). */
export function nullSeed(r: number): { server: string; client: string } {
  const h = (s: string): string => createHash('sha256').update(s).digest('hex');
  return { server: h(`${PASS2_NULL_LABEL}:${r}:server`), client: h(`${PASS2_NULL_LABEL}:${r}:client`).slice(0, 16) };
}

/** A path-scan job (structured-cloneable): every seed, nonces [nonceStart, nonceStart + nonceCount). */
export interface PathsJob {
  seeds: Array<{ server: string; client: string }>;
  nonceStart: number;
  nonceCount: number;
  cursors: number;
}

export function pathsSlots(job: PathsJob): number {
  return job.seeds.length * job.nonceCount;
}

/** Worker kernel: out[s·nonceCount + i] = the first `cursors` direction bits at nonce nonceStart+i. */
export function plinkoPathsKernel(job: unknown, out: Float64Array): void {
  const j = job as PathsJob;
  for (let s = 0; s < j.seeds.length; s++) {
    const key = Buffer.from(j.seeds[s].server, 'hex');
    const client = j.seeds[s].client;
    for (let i = 0; i < j.nonceCount; i++) {
      out[s * j.nonceCount + i] = computePathFromBuffer(key, client, j.nonceStart + i, j.cursors).path;
    }
  }
}

/** popcount of a path of < 2^31. */
function popcount(x: number): number {
  let c = 0;
  while (x) { c += x & 1; x >>>= 1; }
  return c;
}

/** Slot of an r-row board from a path recorded over `cursors` ≥ r bits. */
export function slotOf(path: number, cursors: number, rows: number): number {
  return popcount(path >>> (cursors - rows));
}

/** Deterministic 32-bit PRNG (mulberry32) for the reference-window bootstrap; seeded by a label. */
export function mulberry32(label: string): () => number {
  let a = createHash('sha256').update(label).digest().readUInt32BE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** P(X ≥ k) for X ~ Binomial(n, p), summed exactly in log space. */
export function binomialUpperTail(n: number, p: number, k: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let lf = [0];
  for (let i = 1; i <= n; i++) lf.push(lf[i - 1] + Math.log(i));
  let s = 0;
  for (let i = k; i <= n; i++) {
    s += Math.exp(lf[n] - lf[i] - lf[n - i] + i * Math.log(p) + (n - i) * Math.log1p(-p));
  }
  lf = [];
  return Math.min(1, s);
}
