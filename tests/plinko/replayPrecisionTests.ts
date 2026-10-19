/**
 * Finding F2 (Mike's review, 2026-09-28) — a second CPU must not fail the reproduction gate.
 *
 * What happened: on a second machine two re-derived Pass 2 p-values came back one unit in the
 * last place away from the committed ones. Both were inside the reproduction tolerance, but
 * Step 20 stored the COUNT of bit-identical values (`testsABRederived.bitIdentical`) in the
 * compared artifact, 1,452 → 1,450, and two distinct integers never agree — npm test exit 1.
 *
 * No second machine is available to this suite, so the CPU difference is SIMULATED here the only
 * honest way it can be: the committed p-values are taken from outputs/simulation-results.json
 * and two of them are moved by exactly one ulp, which is the difference Mike measured.
 */
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { newTally, tallyPair, artifactView, runView } from '../../src/replay-precision';
import { fieldDiff, beyondTolerance, flattenLeaves } from '../../src/diff';

const outputs = path.join(__dirname, '..', '..', 'outputs');

/** The next double above x (x finite, > 0): one unit in the last place. */
function nextUp(x: number): number {
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, x);
  b.setBigUint64(0, b.getBigUint64(0) + 1n);
  return b.getFloat64(0);
}

describe('Replay precision — a one-ulp CPU difference stays out of the compared artifact (F2)', () => {
  const sim = JSON.parse(fs.readFileSync(path.join(outputs, 'simulation-results.json'), 'utf8'));
  const stored: number[] = sim.pass2_casino_seeds.results
    .flatMap((r: any) => [r.full_range_chi2, r.full_range_p, r.early_chi2, r.early_p, r.late_chi2, r.late_p]);

  // "This machine" re-derives every value bit for bit; "the second machine" moves two p-values by one ulp.
  const here = stored.slice();
  const there = stored.slice();
  const moved = [1, 3]; // full_range_p and early_p of the first row
  for (const i of moved) there[i] = nextUp(there[i]);

  const tHere = newTally(), tThere = newTally();
  stored.forEach((s, i) => { tallyPair(tHere, s, here[i]); tallyPair(tThere, s, there[i]); });

  it('the perturbed p-values really differ in the last bit, and are inside the reproduction tolerance', () => {
    for (const i of moved) {
      assert.notStrictEqual(there[i], stored[i]);
      const d = fieldDiff({ p: stored[i] }, { p: there[i] });
      assert.strictEqual(d.length, 1);
      assert.strictEqual(d[0].withinTolerance, true, `one ulp at ${stored[i]} must be within tolerance`);
    }
  });

  it('every value agrees at tolerance on both machines — no mismatch, no failure', () => {
    assert.strictEqual(tHere.beyondTolerance, 0);
    assert.strictEqual(tThere.beyondTolerance, 0);
    assert.strictEqual(tThere.withinTolerance, stored.length);
  });

  it('the artifact view is IDENTICAL across the two machines, so the field diff is empty', () => {
    assert.deepStrictEqual(artifactView(tHere), artifactView(tThere));
    assert.deepStrictEqual(fieldDiff({ testsABRederived: artifactView(tHere) }, { testsABRederived: artifactView(tThere) }), []);
  });

  it('the bit-identical count DOES move — which is why it lives in outputs/run/ only', () => {
    assert.strictEqual(runView(tHere).bitIdentical, stored.length);
    assert.strictEqual(runView(tThere).bitIdentical, stored.length - moved.length);
    assert.ok(runView(tThere).largestGap > 0);
  });

  it('counter-check: the OLD artifact shape (bitIdentical stored) fails the gate on the same data', () => {
    const oldShape = (t: typeof tHere) => ({ floatsCompared: t.compared, bitIdentical: t.bitIdentical });
    const real = beyondTolerance(fieldDiff(oldShape(tHere), oldShape(tThere)));
    assert.strictEqual(real.length, 1);
    assert.strictEqual(real[0].path, 'bitIdentical');
  });

  it('the committed verification-results.json carries no bit-identity count and no largest gap', () => {
    const doc = JSON.parse(fs.readFileSync(path.join(outputs, 'verification-results.json'), 'utf8'));
    const bad = [...flattenLeaves(doc).keys()].filter(k => /bitIdentical|BitIdentical|largestGap/.test(k));
    assert.deepStrictEqual(bad, [], `machine-dependent field(s) in a compared artifact: ${bad.join(', ')}`);
  });
});
