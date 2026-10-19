import crypto from 'crypto';

/*
 * PORTED FROM THE OPERATOR'S OWN SOURCE: the Plinko code panel of duel.com → Provably Fair → Verify
 * (Expand → Copy), copied verbatim by Paulo on 2026-09-25 to
 * evidence/verify-tab/duel-verify-tab-plinko-2026-09-25.js (SHA-256 8b3366d1…65c9ce, pinned in
 * src/operator-verifier.ts; evidence/S10 shows the same panel). "Lxx" below is a line of that file.
 * Every citation is listed in OPERATOR_SOURCE_CITES and checked against the pinned bytes by Step 5
 * and the unit tests — a cited line that does not carry the quoted text FAILs. Step 5 also EXECUTES
 * that file on every captured bet and requires its bucket and its L/R path to equal this module's
 * and the served final_slot.
 *
 * NOT in the operator file: the commitment encoding (verifyHash below — SHA-256 of the hex-decoded
 * seed). It is established from the capture (Step 1), not from operator source.
 */

// ── Operator source citations (checked, not decorative) ────────────────────
/**
 * Each entry: a line of evidence/verify-tab/duel-verify-tab-plinko-2026-09-25.js and text that line
 * must contain verbatim. src/operator-verifier.ts checkOperatorCites reads the pinned file and FAILs
 * any entry whose line does not carry its text.
 */
export const OPERATOR_SOURCE_CITES: ReadonlyArray<{ line: number; text: string; ports: string }> = Object.freeze([
  { line: 29, text: 'const keyBytes = hexToBytes(keyHex);', ports: 'the server seed is hex-decoded to the HMAC key' },
  { line: 35, text: "{ name: 'HMAC', hash: 'SHA-256' },", ports: 'HMAC-SHA256' },
  { line: 48, text: 'let position = 0;', ports: 'slot starts at 0' },
  { line: 50, text: 'for (let cursor = 0; cursor < rows; cursor++) {', ports: 'one HMAC per row, cursor = 0 … rows − 1' },
  { line: 52, text: 'new TextEncoder().encode(`${clientSeed}:${nonce}:${cursor}`)', ports: 'the HMAC message' },
  { line: 56, text: 'const value = parseInt(bounceHash.slice(0, 8), 16);', ports: 'BIT_EXTRACTION.hexChars = 8: first 4 bytes, big-endian' },
  { line: 60, text: 'position += (value % 2);', ports: 'BIT_EXTRACTION.modulus = 2: odd = right (+1), even = left' },
  { line: 63, text: 'return position;', ports: 'final_slot = the sum' },
]);

/**
 * THE DIRECTION EXTRACTION, DECLARED AS PARAMETERS.
 *
 * Every row of the board turns one HMAC-SHA256 digest into one left/right decision. How that
 * decision is drawn out of the digest decides whether the board is fair before any statistic is
 * computed: an extraction whose domain does not divide evenly by the number of outcomes favours
 * the low residues, and no amount of live data makes that go away.
 *
 * The parameters live here, `directionBit` is the only place that reads them, and
 * `bitExtractionBiasBound()` computes the bound from the same two numbers — so the bound a step
 * prints describes the code that produced the slots, not a claim typed beside it.
 */
export const BIT_EXTRACTION = Object.freeze({
  /** Hex characters consumed from the front of the digest: 8 → a uint32 domain. */
  hexChars: 8,   // operator L56
  /** Outcomes per row: left or right. */
  modulus: 2,    // operator L60
  /** No draw is ever discarded and redrawn; the bound below is what makes that admissible. */
  rejectionSampling: false,
});

/**
 * The exact worst-case modulo bias of the declared extraction.
 *
 * `domainSize` values map onto `modulus` residues. Residue r is produced by
 * `floor((domainSize - 1 - r) / modulus) + 1` of them, so the counts differ by at most one and
 * the bias is the largest gap between any residue's share and 1/modulus. When the domain divides
 * exactly the gap is zero and the extraction is EXACT — which is the case here: 16^8 = 2^32 is
 * even, so 2^31 digests send the ball left and 2^31 send it right.
 *
 * Returned as numbers, never as a sentence: the profile's floor is 2^-32 and a reader has to be
 * able to compare the two.
 */
export function bitExtractionBiasBound(): {
  hexChars: number;
  modulus: number;
  domainSize: number;
  remainder: number;
  minResidueCount: number;
  maxResidueCount: number;
  bias: number;
  exact: boolean;
  rejectionSampling: boolean;
  rejectedDraws: number;
} {
  const { hexChars, modulus, rejectionSampling } = BIT_EXTRACTION;
  const domainSize = Math.pow(2, 4 * hexChars);
  const remainder = domainSize % modulus;
  const minResidueCount = Math.floor(domainSize / modulus);
  const maxResidueCount = remainder === 0 ? minResidueCount : minResidueCount + 1;
  const bias = Math.max(
    maxResidueCount / domainSize - 1 / modulus,
    1 / modulus - minResidueCount / domainSize
  );
  return {
    hexChars, modulus, domainSize, remainder,
    minResidueCount, maxResidueCount,
    bias,
    exact: remainder === 0,
    rejectionSampling,
    // No draw is rejected, so the census the profile asks for when rejection sampling IS used
    // is zero by construction rather than unmeasured.
    rejectedDraws: 0,
  };
}

/** One row's direction from one digest, under the declared extraction. 0 = left, 1 = right. */
export function directionBit(hmacHex: string): number {
  return parseInt(hmacHex.substring(0, BIT_EXTRACTION.hexChars), 16) % BIT_EXTRACTION.modulus;
}

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
  let slot = 0;                                        // operator L48
  for (let cursor = 0; cursor < rows; cursor++) {      // operator L50
    const message = `${clientSeed}:${nonce}:${cursor}`;                           // operator L52
    const hmac = crypto.createHmac('sha256', key).update(message).digest('hex');  // operator L28–L43
    slot += directionBit(hmac);                        // operator L56, L60
  }
  return slot;                                         // operator L63
}

/**
 * The ordered directions of one drop, packed into a bitmask (row 0 is the high bit).
 *
 * The slot is a SUM, so two different paths routinely land in the same slot — C(2·rows, rows)/4^rows
 * of the time for a fresh draw, about 16 % on a twelve-row board. A test that asks whether a wrong
 * client seed changed the SLOT is therefore testing against a coincidence rate of one in six, while
 * the path it is really asking about coincides only 2^-rows of the time. Both are measured; this is
 * what makes the stronger one possible.
 */
export function computePathFromBuffer(
  key: Buffer,
  clientSeed: string,
  nonce: number,
  rows: number
): { slot: number; path: number } {
  let slot = 0;
  let path = 0;
  for (let cursor = 0; cursor < rows; cursor++) {
    const message = `${clientSeed}:${nonce}:${cursor}`;
    const hmac = crypto.createHmac('sha256', key).update(message).digest('hex');
    const bit = directionBit(hmac);
    slot += bit;
    path = path * 2 + bit;
  }
  return { slot, path };
}

/**
 * Compute final_slot via HMAC-SHA256 per-row commit-reveal.
 *
 * key     = Buffer.from(serverSeed, 'hex')          (operator L29)
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
