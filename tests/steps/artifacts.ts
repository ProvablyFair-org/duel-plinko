/**
 * Step 21 — Artifact Integrity. Recompute each artifact of record and compare with its pin.
 * A missing or altered artifact is a HARD_FAIL, not a flag: these figures are published.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { StepResult } from '../../src/types';
import { pass, fail, VerifyContext, tag } from './context';
import { ARTIFACT_PINS } from '../../src/artifact-pins';
import { domainRules, validateDomains, describeDomainFailures } from '../../src/domains';

export function run(ctx: VerifyContext): StepResult[] {
  const outputsDir = (ctx as unknown as { outputsDir?: string }).outputsDir
    ?? path.join(__dirname, '..', '..', 'outputs');

  const issues: string[] = [];
  const notes: string[] = [];

  for (const [file, expected] of Object.entries(ARTIFACT_PINS)) {
    const fp = path.join(outputsDir, file);
    if (!fs.existsSync(fp)) { issues.push(`${file} ABSENT`); continue; }
    const actual = createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
    if (actual !== expected) issues.push(`${file} sha256 ${actual.slice(0,16)} != pin ${expected.slice(0,16)}`);
    else notes.push(`${file} matches its pin`);
  }

  // Value-domain integrity: the hash proves the bytes are the committed ones; it does not prove
  // the numbers inside are physically possible. Re-pinning a doctored scalar defeats the hash but
  // not this — every numeric leaf of every pinned JSON artifact must lie in the domain it
  // physically admits, and every leaf path must be covered by a rule (src/domains.ts). Bounds are
  // derived from src/ and the pinned config, never from the artifact under check.
  const rulesByFile = domainRules();
  let leavesChecked = 0;
  for (const [file, rules] of Object.entries(rulesByFile)) {
    const fp = path.join(outputsDir, file);
    if (!fs.existsSync(fp)) continue; // absence already recorded above
    let doc: unknown;
    try { doc = JSON.parse(fs.readFileSync(fp, 'utf8')); }
    catch { issues.push(`${file} is not parseable JSON`); continue; }
    const res = validateDomains(doc, rules);
    leavesChecked += res.checked;
    if (res.violations.length || res.uncovered.length) {
      for (const line of describeDomainFailures(file, res)) issues.push(line);
    } else {
      notes.push(`${file} — ${res.checked} numeric leaves within their value domains`);
    }
  }

  const r = issues.length === 0
    ? pass(21, 'Artifact Integrity (pinned artifacts of record)', ['EC-25'],
        `${Object.keys(ARTIFACT_PINS).length} artifact(s) match src/artifact-pins.ts and ${leavesChecked} numeric leaves lie within value domains derived from src/: ${notes.join('; ')}`)
    : fail(21, 'Artifact Integrity (pinned artifacts of record)', ['EC-25'], 'HARD_FAIL',
        `the scored artifact is not the committed one or carries an impossible value: ${issues.join('; ')}`, issues);
  console.log(`  [${tag(r)}] Step 21 — ${r.name}`);
  return [r];
}
