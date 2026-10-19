#!/usr/bin/env node
/**
 * Step-registry gate (PLINKO-33). Establishes the DECLARED step set from the SOURCE
 * (tests/steps/*.ts), then requires outputs/verification-results.json to carry exactly
 * those ids — each present exactly once, each under the name its module declares. A
 * duplicated, missing, renumbered or renamed step is caught: a count is not an identity.
 *
 * Duel raises one capture-origin FLAG (PLINKO-04, a reconstructed nonce) which is
 * verdict-neutral, so the verdict is Full Pass; this gate does NOT re-derive the verdict —
 * it enforces step IDENTITY and summary/steps internal consistency, independent of it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_STEPS = 23;
const problems = [];
const fail = (m) => problems.push(m);

const CANONICAL = path.join(ROOT, 'outputs', 'verification-results.json');
let doc;
try { doc = JSON.parse(fs.readFileSync(CANONICAL, 'utf8')); }
catch (e) { console.error(`[check-outputs] cannot read ${path.relative(ROOT, CANONICAL)}: ${e.message}`); process.exit(1); }

const steps = Array.isArray(doc.steps) ? doc.steps : [];
const summary = doc.summary ?? {};
const passCount = steps.filter(s => s.pass === true).length;
const flagCount = steps.filter(s => s.severity === 'FLAG').length;
const hardFailCount = steps.filter(s => s.severity === 'HARD_FAIL').length;

// 1. The declared step set, parsed from the SOURCE (never from the artifact under check).
const declared = new Map();
const stepsDir = path.join(ROOT, 'tests', 'steps');
if (!fs.existsSync(stepsDir)) fail('tests/steps is missing — cannot establish the declared step set');
else for (const f of fs.readdirSync(stepsDir).filter(f => f.endsWith('.ts'))) {
  const src = fs.readFileSync(path.join(stepsDir, f), 'utf8');
  for (const m of src.matchAll(/\b(?:pass|fail|info)\(\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'/g)) {
    const id = Number(m[1]);
    const name = m[2].replace(/\\'/g, "'");
    const prev = declared.get(id);
    if (prev !== undefined && prev !== name)
      fail(`tests/steps declares Step ${id} under two names (${JSON.stringify(prev)} vs ${JSON.stringify(name)}) — ambiguous declaration`);
    declared.set(id, name);
  }
}
const declaredIds = [...declared.keys()].sort((a, b) => a - b);
const wantIds = Array.from({ length: EXPECTED_STEPS }, (_, i) => i + 1);
if (declaredIds.length !== EXPECTED_STEPS || declaredIds.some((v, i) => v !== wantIds[i]))
  fail(`tests/steps declares ids [${declaredIds.join(', ')}] but the suite expects 1..${EXPECTED_STEPS}`);

// 2. Identity of the emitted steps against the declaration.
if (steps.length !== EXPECTED_STEPS)
  fail(`the run carries ${steps.length} scored steps (expected ${EXPECTED_STEPS})`);
const seen = new Map();
for (const s of steps) {
  if (seen.has(s.step)) fail(`Step ${s.step} appears more than once — a count is not an identity`);
  seen.set(s.step, 1);
}
const missing = [...declared.keys()].filter(id => !seen.has(id)).sort((a, b) => a - b);
if (missing.length) fail(`the run has no result for Step ${missing.join(', ')} — that step did not run or its entry was replaced`);
const strangers = [...seen.keys()].filter(id => !declared.has(id)).sort((a, b) => a - b);
if (strangers.length) fail(`the run carries Step ${strangers.join(', ')}, which tests/steps does not declare`);
const misnamed = steps.filter(s => s.name !== declared.get(s.step))
  .map(s => `Step ${s.step} is named ${JSON.stringify(s.name)} but the suite declares ${JSON.stringify(declared.get(s.step))}`);
if (misnamed.length) fail(`${misnamed.length} step(s) do not carry the declared name: ${misnamed.slice(0, 3).join('; ')}`);

// 3. Summary counters must reconcile with the steps array (a hand edit that flips a status
//    but leaves the summary untouched is caught).
if (summary.passed !== passCount) fail(`summary.passed is ${summary.passed} but ${passCount} steps have pass=true`);
if ((summary.flags ?? 0) !== flagCount) fail(`summary.flags is ${summary.flags} but ${flagCount} steps are FLAG`);
if ((summary.hardFail ?? 0) !== hardFailCount) fail(`summary.hardFail is ${summary.hardFail} but ${hardFailCount} steps are HARD_FAIL`);

if (problems.length) {
  console.error(`[check-outputs] FAIL:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`[check-outputs] OK: ${steps.length} scored steps, ids 1..${EXPECTED_STEPS} each once, names as tests/steps declares; summary reconciles (${passCount} pass, ${flagCount} flag, ${hardFailCount} hard-fail).`);
