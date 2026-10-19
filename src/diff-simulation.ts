/**
 * Compare a REGENERATED simulation (outputs/run/, written by `npm run simulate:run`) with the
 * committed artifacts of record (profile PLINKO-28). Ported from
 * pf-duel-workspace/games/mines/src/diff-simulation.ts.
 *
 *   outputs/simulation-results.json   field by field under the reproduction rule (src/diff.ts:
 *                                     integers and strings exact, non-integers within
 *                                     1e-14 + 1e-12·max(|a|,|b|));
 *   outputs/rtp-convergence.html      byte for byte (it prints figures at 1–4 decimals; a regeneration
 *                                     that changes one of them is a different chart).
 *
 * `npm run test:full` runs it after re-simulating, so a regeneration is never written and then left
 * unexamined. Writes outputs/run/diff-simulation.json with the Node runtime; exits 1 on anything
 * beyond tolerance or a missing file. Never writes a committed artifact.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { fieldDiff, beyondTolerance, maxima, DIFF_ATOL, DIFF_RTOL } from './diff';

const OUT = path.join(__dirname, '..', 'outputs');
let beyond = 0;
const report: unknown[] = [];

{
  const f = 'simulation-results.json';
  const committedPath = path.join(OUT, f), runPath = path.join(OUT, 'run', f);
  if (!fs.existsSync(committedPath) || !fs.existsSync(runPath)) {
    console.log(`  ${f}: ${fs.existsSync(runPath) ? 'committed copy' : 'regeneration'} ABSENT — nothing to compare`);
    beyond++;
  } else {
    const diffs = fieldDiff(JSON.parse(fs.readFileSync(committedPath, 'utf8')), JSON.parse(fs.readFileSync(runPath, 'utf8')), []);
    const real = beyondTolerance(diffs);
    beyond += real.length;
    const gap = maxima(diffs);
    report.push({ file: `outputs/${f}`, differences: diffs, beyondTolerance: real.length, largestGap: gap });
    console.log(`  ${f}: ${real.length === 0 ? 'REPRODUCED' : `${real.length} field(s) BEYOND TOLERANCE`}`
      + ` (${diffs.length} field(s) differ at all, ${diffs.length - real.length} within tolerance${gap ? `, largest ${gap.absDiff.toExponential(2)} at ${gap.path}` : ''})`);
    for (const d of real.slice(0, 5)) console.log(`      ${d.path}: committed ${JSON.stringify(d.committed)} vs regenerated ${JSON.stringify(d.thisRun)}`);
  }
}
{
  const f = 'rtp-convergence.html';
  const committedPath = path.join(OUT, f), runPath = path.join(OUT, 'run', f);
  const sha = (p: string): string | null => (fs.existsSync(p) ? createHash('sha256').update(fs.readFileSync(p)).digest('hex') : null);
  const a = sha(committedPath), b = sha(runPath);
  const same = a !== null && a === b;
  if (!same) beyond++;
  report.push({ file: `outputs/${f}`, comparison: 'byte-for-byte', committedSha256: a, regeneratedSha256: b, identical: same });
  console.log(`  ${f}: ${same ? 'IDENTICAL' : 'DIFFERS'} (committed ${a ?? 'absent'}, regenerated ${b ?? 'absent'})`);
}

fs.mkdirSync(path.join(OUT, 'run'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'run', 'diff-simulation.json'), JSON.stringify({
  runtime: process.versions.node, tolerance: { atol: DIFF_ATOL, rtol: DIFF_RTOL }, reproduced: beyond === 0, files: report,
}, null, 2));
if (beyond > 0) process.exit(1);
