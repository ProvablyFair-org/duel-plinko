/**
 * ARTIFACTS OF RECORD — pinned.
 *
 * Shipped as evidence and quoted in the report, but until this pin existed nothing hashed them:
 * emptying, duplicating or shrinking any of them left the verifier reporting Full Pass, exit 0.
 * Every one of these is now stable across runs: the verifier writes its own products under
 * outputs/run/ and no longer rewrites a committed path, and no artifact here carries run
 * metadata. A `generatedAt` inside a pinned file makes the pin unreproducible even when every
 * figure is identical, which defeats the point of pinning it; `chi-squared-results.json` and
 * `determinism-log.json` carried one until this release.
 *
 * The pin is the identity of the COMMITTED bytes and is never rewritten to make a regeneration
 * agree with it. Whether a regeneration is the SAME RESULT is a different question, answered at
 * tolerance in outputs/run/diff.json — because the last bits of a derived statistic belong to
 * the machine. Measured here on 18 September: rerunning the pinned-seed simulation moved
 * `pass2_casino_seeds.test_b_cherry_pick_pvalue` from 0.7730031061099987 to 0.7730031061099988,
 * one unit in the last place, with every other leaf of the artifact identical. The committed
 * bytes stand; the run record carries the difference.
 */
export const ARTIFACT_PINS: Readonly<Record<string, string>> = Object.freeze({
  'chi-squared-results.json':
    'c6d8f718085c388d7f9ab06d2747e98b74541d39724f214866dc6767df255d84',
  'determinism-log.json':
    '5d5c00c597424ea5ba692454c5998a53ec6ff21e1e314908d79553d7213859f4',
  'rtp-convergence.html':
    '57a9b8a30cee238c35dc785ed51c2333bbfc4bf25e4983436f86e2dfe7d279e9',
  'simulation-results.json':
    'b7744254a4d331158ab8f789581c37ecf64aeec123dcf71a651cc13859699514',
});
