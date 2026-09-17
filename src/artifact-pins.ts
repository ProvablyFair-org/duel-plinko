/**
 * ARTIFACTS OF RECORD — pinned.
 *
 * Shipped as evidence and quoted in the report, but until this pin existed nothing hashed them:
 * emptying, duplicating or shrinking any of them left the verifier reporting Full Pass, exit 0.
 * Files this verifier REWRITES each run are deliberately absent — pinning one would fail on the
 * second run; that they are rewritten at all is a separate defect.
 */
export const ARTIFACT_PINS: Readonly<Record<string, string>> = Object.freeze({
  'chi-squared-results.json':
    '64fab5f73fb90e239d3d157197a711f581f05c490352543cea13168544ad5f9a',
  'determinism-log.json':
    '4cb51f9bbc1a838c14c9626d5f8e56d9545dba901daca94a047ef901190074bb',
  'rtp-convergence.html':
    '5b901fbfcdebfe473aba86a0010bc573a022d121904b3fd0c8707b0399b76e62',
  'simulation-results.json':
    '9970da43be8a582c33bd0b23679e162f28a8e01d8f308eacb37b7fd0dace7145',
});
