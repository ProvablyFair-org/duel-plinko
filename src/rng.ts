/**
 * PROVENANCE (header added on integration, 20 Oct 2026; everything below this comment is the
 * clean-room module byte for byte).
 *
 * This module was REBUILT FROM A WRITTEN SPECIFICATION, not ported from Duel's code:
 *   spec      docs/ALGORITHM.md, a copy of games/plinko/ALGORITHM.md in the ProvablyFair.org audit
 *             framework (SHA-256 cbc8fd1a…4fe7fa). Written from Duel's public pages, the standard
 *             provably-fair construction, Duel's public plinko config and the 8,100 live bets,
 *             without opening Duel's code (its §8 lists every file read).
 *   rebuild   written by an implementer who read ONLY that spec and a module-interface file (export
 *             names and types), and never opened Duel's code, its Verify-tab file, or this package's
 *             earlier src/rng.ts.
 *   self-test tests/plinko/RngSpecTests.ts (the spec's §5 vectors and properties).
 *
 * Duel's published Verify-tab code (evidence/verify-tab/duel-verify-tab-plinko-2026-09-25.js) is
 * NOT the source of this module. It is run byte for byte as a SECOND CHECK, by Step 5 and the unit
 * tests (src/operator-verifier.ts), next to the ProvablyFair.org docs-site and live-site verifiers.
 *
 * Three-way agreement measured on integration (20 Oct 2026, the 8,100-bet capture, seeds paired to
 * bets by hashing): this module vs the live bets, commitment 8,100/8,100 and final_slot
 * 8,100/8,100; vs Duel's Verify-tab code, bucket 8,100/8,100 and ordered L/R path 8,100/8,100; vs
 * the provablyfair.org live verifier, slot 8,100/8,100 and L/R path 8,100/8,100.
 * Step 5 of `npm run verify` re-measures all three on every run.
 */
// Clean-room implementation of the Duel.com Plinko outcome derivation.
// Built only from ALGORITHM.md (behaviour) and INTERFACE.md (names and types).
// Node `crypto` only, no other dependencies.

import { createHash, createHmac } from "crypto";

// ALGORITHM.md §2 Step 2: each row uses the first 4 digest bytes (8 hex
// characters) as a big-endian unsigned 32-bit integer and takes it mod 2.
// No draw is ever discarded (2^32 is a multiple of 2).
export const BIT_EXTRACTION: Readonly<{
  hexChars: number;
  modulus: number;
  rejectionSampling: boolean;
}> = Object.freeze({
  hexChars: 8,
  modulus: 2,
  rejectionSampling: false,
});

// §1.1: rows is an integer in 8…16.
const MIN_ROWS = 8;
const MAX_ROWS = 16;

const HEX_RE = /^[0-9a-fA-F]*$/;

// Analytic bias of the per-row bit, derived from BIT_EXTRACTION alone
// (§2 Step 2 states the expected result: bias 0).
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
  // Number of distinct values the consumed hex prefix can take.
  const domainSize = 16 ** hexChars;
  const remainder = domainSize % modulus;
  // Each residue gets floor(domain/modulus) values; `remainder` residues get one extra.
  const minResidueCount = Math.floor(domainSize / modulus);
  const maxResidueCount = minResidueCount + (remainder === 0 ? 0 : 1);
  // With rejection sampling, the top `remainder` values would be discarded and
  // every residue would be exactly uniform. Without it, the worst residue is
  // off from 1/modulus by (maxCount/domain - 1/modulus).
  const rejectedDraws = rejectionSampling ? remainder : 0;
  let bias: number;
  if (rejectionSampling || remainder === 0) {
    bias = 0;
  } else {
    const hi = Math.abs(maxResidueCount / domainSize - 1 / modulus);
    const lo = Math.abs(minResidueCount / domainSize - 1 / modulus);
    bias = Math.max(hi, lo);
  }
  return {
    hexChars,
    modulus,
    domainSize,
    remainder,
    minResidueCount,
    maxResidueCount,
    bias,
    exact: bias === 0,
    rejectionSampling,
    rejectedDraws,
  };
}

// §2 Step 2: bit = (first 4 digest bytes as big-endian u32) mod 2.
export function directionBit(hmacHex: string): number {
  const { hexChars, modulus } = BIT_EXTRACTION;
  if (hmacHex.length < hexChars || !HEX_RE.test(hmacHex)) {
    throw new TypeError(`directionBit: expected a hex digest of at least ${hexChars} hex characters`);
  }
  // parseInt on 8 hex chars reads them most-significant first, i.e. big-endian.
  const u = parseInt(hmacHex.slice(0, hexChars), 16);
  return u % modulus;
}

function checkArgs(clientSeed: string, nonce: number, rows: number): void {
  if (typeof clientSeed !== "string") {
    throw new TypeError("clientSeed must be a string");
  }
  // §1.1: nonce is a non-negative integer; §2 Step 1 prints it in plain base 10.
  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    throw new RangeError("nonce must be a non-negative safe integer");
  }
  // §1.1: rows 8…16.
  if (!Number.isInteger(rows) || rows < MIN_ROWS || rows > MAX_ROWS) {
    throw new RangeError(`rows must be an integer in ${MIN_ROWS}..${MAX_ROWS}`);
  }
}

// §2 Step 1: digest_i = HMAC-SHA256(key, UTF-8(clientSeed + ":" + nonce + ":" + i)).
function rowDigestHex(key: Buffer, clientSeed: string, nonce: number, i: number): string {
  // String(n) of a non-negative safe integer is plain base 10 with no padding,
  // sign, separators or exponent (§2 Step 1, decimal(x)).
  const message = `${clientSeed}:${String(nonce)}:${String(i)}`;
  return createHmac("sha256", key).update(Buffer.from(message, "utf8")).digest("hex");
}

// §2 Steps 1–3, also returning the per-row bits packed with row 0 as the
// highest of `rows` bits (INTERFACE.md convention; §6 O2 leaves on-screen
// orientation undetermined, the packing is not a left/right claim).
export function computePathFromBuffer(
  key: Buffer,
  clientSeed: string,
  nonce: number,
  rows: number,
): { slot: number; path: number } {
  checkArgs(clientSeed, nonce, rows);
  let slot = 0;
  let path = 0;
  // §2 Step 1: cursor i runs 0 … rows−1, one HMAC per row.
  for (let i = 0; i < rows; i++) {
    const bit = directionBit(rowDigestHex(key, clientSeed, nonce, i));
    // §2 Step 3: slot is the count of 1-bits.
    slot += bit;
    // Shift left then add: row 0 ends up in the highest of the `rows` bits.
    // rows ≤ 16, so this never leaves the safe 31-bit range of `<<`.
    path = (path << 1) | bit;
  }
  return { slot, path };
}

// §2 Steps 1–3: slot in 0 … rows.
export function computeSlotFromBuffer(key: Buffer, clientSeed: string, nonce: number, rows: number): number {
  return computePathFromBuffer(key, clientSeed, nonce, rows).slot;
}

// §1.1 / §2 Step 1: the server seed is 64 hex characters, and the HMAC key is
// the 32 bytes they encode (not the ASCII text).
function decodeServerSeed(serverSeed: string): Buffer {
  if (typeof serverSeed !== "string" || serverSeed.length !== 64 || !HEX_RE.test(serverSeed)) {
    throw new TypeError("serverSeed must be 64 hex characters");
  }
  return Buffer.from(serverSeed, "hex");
}

export function computeSlot(serverSeed: string, clientSeed: string, nonce: number, rows: number): number {
  return computeSlotFromBuffer(decodeServerSeed(serverSeed), clientSeed, nonce, rows);
}

// §1.2: commitment = lowercase hex of SHA-256 over the hex-decoded seed bytes.
// A seed that is not 64 hex characters cannot match, so it returns false.
export function verifyHash(serverSeed: string, serverSeedHashed: string): boolean {
  let key: Buffer;
  try {
    key = decodeServerSeed(serverSeed);
  } catch {
    return false;
  }
  if (typeof serverSeedHashed !== "string") return false;
  return sha256Buffer(key) === serverSeedHashed.toLowerCase();
}

// Plain SHA-256 of bytes, lowercase hex.
export function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
