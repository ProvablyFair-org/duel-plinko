/**
 * Step 21 — Artifact Integrity. Recompute each artifact of record and compare with its pin.
 * A missing or altered artifact is a HARD_FAIL, not a flag: these figures are published.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { StepResult } from '../../src/types';
import { pass, fail, VerifyContext } from './context';
import { ARTIFACT_PINS } from '../../src/artifact-pins';

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

  const r = issues.length === 0
    ? pass(21, 'Artifact Integrity (pinned artifacts of record)', ['EC-25'],
        `${Object.keys(ARTIFACT_PINS).length} artifact(s) match src/artifact-pins.ts: ${notes.join('; ')}`)
    : fail(21, 'Artifact Integrity (pinned artifacts of record)', ['EC-25'], 'HARD_FAIL',
        `the scored artifact is not the committed one: ${issues.join('; ')}`, issues);
  console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] Step 21 — ${r.name}`);
  return [r];
}
