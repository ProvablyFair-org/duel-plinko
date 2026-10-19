/**
 * Value-domain unit tests — the standing contract for src/domains.ts.
 *
 * Asserts BOTH directions against the COMMITTED artifacts, because a mistake in the domain table
 * fails in two opposite ways and only one is caught by looking at the artifact:
 *
 *   1. Every numeric leaf of every pinned JSON artifact satisfies its declared domain. A rule
 *      that is too tight (rejects an honest value) is caught here rather than in the field, where
 *      it would reject a genuine audit.
 *   2. Every numeric leaf PATH is covered by a rule — no silent fallback. A numeric field added
 *      to an artifact with no declared domain would otherwise be carried unbounded, which is the
 *      exact hole the module closes. Adding such a field fails this suite until a domain is
 *      declared for it.
 *
 * The forger's move — re-pinning a doctored scalar — is caught by Step 21 at verify time (it runs
 * validateDomains over the same artifacts and HARD_FAILs on any out-of-domain leaf). This suite
 * guards the table itself.
 */
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { domainRules, validateDomains, numericLeaves } from '../../src/domains';

const outputsDir = path.join(__dirname, '..', '..', 'outputs');

describe('Value domains — every numeric leaf of every pinned artifact is bounded (src/domains.ts)', () => {
  const rulesByFile = domainRules();

  for (const [file, rules] of Object.entries(rulesByFile)) {
    const fp = path.join(outputsDir, file);

    it(`${file} exists and every numeric leaf lies within its declared domain`, () => {
      assert.ok(fs.existsSync(fp), `${file} is missing from outputs/`);
      const doc = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const res = validateDomains(doc, rules);
      assert.strictEqual(
        res.violations.length, 0,
        `impossible value(s): ${res.violations.slice(0, 6).map(v => `${v.path}=${v.value} is not ${v.expected}`).join('; ')}`,
      );
    });

    it(`${file} has no numeric leaf without a declared value domain`, () => {
      const doc = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const res = validateDomains(doc, rules);
      assert.strictEqual(
        res.uncovered.length, 0,
        `undeclared field(s) — add a rule in src/domains.ts: ${res.uncovered.slice(0, 8).join('; ')}`,
      );
    });

    it(`${file} has at least one numeric leaf checked (the artifact is not empty)`, () => {
      const doc = JSON.parse(fs.readFileSync(fp, 'utf8'));
      assert.ok(numericLeaves(doc).length > 0, `${file} carries no numeric leaves`);
    });
  }
});
