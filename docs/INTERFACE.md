# Module interface the audit package expects (written by the auditor, not from the casino)

Write `rng.ts` (TypeScript, strict, Node `crypto` only, no dependencies) exporting exactly these names.
Semantics come from ALGORITHM.md; this file only fixes names, types and the package's own conventions.

```ts
// Description of the per-row bit extraction, as data.
export const BIT_EXTRACTION: Readonly<{
  hexChars: number;            // hex characters consumed from the front of the digest
  modulus: number;             // outcomes per row
  rejectionSampling: boolean;  // whether any draw is ever discarded and redrawn
}>;

// Analytic bias report for the per-row bit, computed from BIT_EXTRACTION (no sampling).
export function bitExtractionBiasBound(): {
  hexChars: number; modulus: number;
  domainSize: number;          // 16 ** hexChars
  remainder: number;           // domainSize % modulus
  minResidueCount: number; maxResidueCount: number;
  bias: number;                // worst-case |P(bit) - 1/modulus|
  exact: boolean;              // bias is exactly 0
  rejectionSampling: boolean;
  rejectedDraws: number;
};

// The row's direction bit (0 or 1) from one row's HMAC digest given as hex.
export function directionBit(hmacHex: string): number;
// Final slot (0..rows) from the HMAC key bytes already decoded from the server seed.
export function computeSlotFromBuffer(key: Buffer, clientSeed: string, nonce: number, rows: number): number;
// Slot plus the ordered row directions packed into a bitmask: row 0 is the HIGH bit of `path`
// (path has `rows` bits; bit value = that row's direction bit).
export function computePathFromBuffer(key: Buffer, clientSeed: string, nonce: number, rows: number): { slot: number; path: number };
// Same as computeSlotFromBuffer, taking the server seed as the casino publishes it.
export function computeSlot(serverSeed: string, clientSeed: string, nonce: number, rows: number): number;
// Commitment check: does serverSeed hash to the published serverSeedHashed?
export function verifyHash(serverSeed: string, serverSeedHashed: string): boolean;
// SHA-256 of a byte buffer, as lowercase hex (used to fingerprint files).
export function sha256Buffer(buf: Buffer): string;
```
