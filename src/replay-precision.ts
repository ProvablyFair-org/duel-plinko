/**
 * Replay precision tally — what a replay comparison may put in a COMPARED artifact, and what it
 * may not.
 *
 * ── WHY (Mike's review of 2026-09-28, finding F2) ───────────────────────────────────────────────
 * Step 20 stored `testsABRederived.bitIdentical` — how many re-derived p-values came back equal to
 * the committed ones to the last bit — inside outputs/verification-results.json, the artifact
 * `npm test` field-diffs against. On a second machine two p-values differed in the last bit, the
 * count went 1,452 → 1,450, and because two distinct integers never agree under the reproduction
 * rule (src/diff.ts), npm test exited 1: "this run disagrees with the committed evidence". The
 * p-values themselves were inside tolerance; only the COUNT of bit-identical values was not
 * portable. Step 19 carried the same class of field (`derivedStatisticsBitIdentical`,
 * `largestGapWithinTolerance`) and would have failed the same way on a CPU that moved one of its
 * library-function figures.
 *
 * The rule (Framework 1.0 reproduction rule): nothing machine-dependent lives in a compared
 * artifact. So a tally has two views:
 *
 *   artifactView — compared / withinTolerance / beyondTolerance. On any machine that reproduces
 *                  the result these are the same integers, so they are safe to pin.
 *   runView      — bitIdentical / largestGap. Properties of THIS machine's arithmetic, written
 *                  only under outputs/run/ (never compared, never pinned).
 *
 * The comparison itself is unchanged: a value either agrees at the reproduction tolerance
 * (numbersAgree), or it is required exactly (`exact`), or it is a mismatch.
 */
import { numbersAgree } from './diff';

export interface PrecisionTally {
  compared: number;
  withinTolerance: number;
  beyondTolerance: number;
  bitIdentical: number;
  largestGap: number;
}

export const newTally = (): PrecisionTally =>
  ({ compared: 0, withinTolerance: 0, beyondTolerance: 0, bitIdentical: 0, largestGap: 0 });

/** Score one stored/derived pair. Returns true when they agree (exactly if `exact`, else at tolerance). */
export function tallyPair(t: PrecisionTally, stored: unknown, derived: number, exact = false): boolean {
  t.compared++;
  if (typeof stored !== 'number' || (exact ? stored !== derived : !numbersAgree(stored, derived))) {
    t.beyondTolerance++;
    return false;
  }
  t.withinTolerance++;
  if (stored === derived) t.bitIdentical++;
  const gap = Math.abs(stored - derived);
  if (gap > t.largestGap) t.largestGap = gap;
  return true;
}

/** The machine-independent part — the only part a compared artifact may carry. */
export const artifactView = (t: PrecisionTally) =>
  ({ compared: t.compared, withinTolerance: t.withinTolerance, beyondTolerance: t.beyondTolerance });

/** The machine-dependent part — outputs/run/ only. */
export const runView = (t: PrecisionTally) =>
  ({ bitIdentical: t.bitIdentical, largestGap: t.largestGap });
