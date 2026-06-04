import crypto from 'crypto';

/**
 * Compute final_slot from a pre-computed key Buffer.
 * Use this when calling computeSlot in a tight loop over the same serverSeed
 * (e.g. Pass 2 simulation) to avoid repeated Buffer.from() allocations.
 */
export function computeSlotFromBuffer(
  key: Buffer,
  clientSeed: string,
  nonce: number,
  rows: number
): number {
  let slot = 0;
  for (let cursor = 0; cursor < rows; cursor++) {
    const message = `${clientSeed}:${nonce}:${cursor}`;
    const hmac = crypto.createHmac('sha256', key).update(message).digest('hex');
    slot += parseInt(hmac.substring(0, 8), 16) % 2;
  }
  return slot;
}

/**
 * Compute final_slot via HMAC-SHA256 per-row commit-reveal.
 *
 * key     = Buffer.from(serverSeed, 'hex')
 * for cursor = 0..rows-1:
 *   message = `${clientSeed}:${nonce}:${cursor}`
 *   hmac    = HMAC-SHA256(key, message).hex()
 *   hex4    = hmac[0..7]  (first 4 bytes)
 *   int     = parseInt(hex4, 16)
 *   if int % 2 === 1: slot++   // odd = right (+1), even = left (no change)
 */
export function computeSlot(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  rows: number
): number {
  return computeSlotFromBuffer(Buffer.from(serverSeed, 'hex'), clientSeed, nonce, rows);
}

/**
 * Verify commit-reveal: SHA-256(Buffer.from(serverSeed, 'hex')) === serverSeedHashed
 */
export function verifyHash(serverSeed: string, serverSeedHashed: string): boolean {
  const hash = crypto
    .createHash('sha256')
    .update(Buffer.from(serverSeed, 'hex'))
    .digest('hex');
  return hash === serverSeedHashed;
}

/**
 * SHA-256 of a raw Buffer (for dataset hash EC-25).
 */
export function sha256Buffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
