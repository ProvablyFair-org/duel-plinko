#!/usr/bin/env node
/**
 * mutate — the falsifiability gate.
 *
 * A verification suite that passes is worth nothing until you know it can fail. Every step in
 * this package prints PASS on the honest dataset; so would a step that returns `pass()`
 * unconditionally, and this package shipped three of those. The only way to tell the two apart
 * is to break the thing the step claims to check and watch the step go red.
 *
 * This runs that experiment once per entry in `tests/mutations.json`. Each entry names the
 * scored step that must die, the exact edit that should kill it, and the reason the guard exists.
 * A mutation the suite does not notice is reported as SURVIVED and fails the gate — that is a
 * defect in the suite, found here rather than by a reader.
 *
 * DISPOSABLE COPY. Nothing is ever written inside the package. The tree is copied to a temporary
 * directory (node_modules symlinked, not copied), mutated there, and deleted afterwards, so a
 * battery that crashes half way cannot leave a doctored source or a rewritten artifact behind.
 *
 * WHAT AN ENTRY MAY DO
 *   file/find/replace     one textual edit
 *   edits: [...]          several, applied in order
 *   delete: ["path"]      remove a file for the run — "absent ⇒ pass" is its own defect class
 *   transform: {file,name} a named structural rewrite for what find/replace cannot express
 *   repin: [{file,find,hashOf}]  recompute a SHA-256 pin AFTER the edits, so a forgery that
 *                         re-pins the artifact it invalidated is a mutation the battery can run
 *   runner: verify|mocha  which entry point must reject it
 *   expect: "..."         a marker that must appear in the output, so the INTENDED guard fired
 *                         rather than the run merely going red for some other reason
 *   step: N               the scored step this proves falsifiable
 *   regen: ["rtp-table","record"]  regenerate the RTP table (re-pinned) and the record after the
 *                         edits, so an RTP miss is tested on a consistent package (C3, 14 Oct 2026)
 *   expectExit: N         the exit the run must end with (5 = RTP FIGURE OVERSTATED)
 *   runner: test          mocha, then verify — what `npm test` runs
 *
 * Exits 0 only when every mutation was killed as declared AND every scored step the verifier
 * reports has at least one mutation naming it.
 *
 * Usage: npm run mutate  [--only <substring>[,<substring>...]]
 */
import { readFileSync, writeFileSync, existsSync, rmSync, cpSync, mkdtempSync, symlinkSync, mkdirSync, readdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import path from 'path';

const PKG = path.resolve(path.join(new URL('.', import.meta.url).pathname, '..'));
const REGISTRY = path.join(PKG, 'tests', 'mutations.json');

const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

// ── Named transforms ──────────────────────────────────────────────────────────
// Some counterexamples cannot be written as a string edit. The important one is the SMOOTH
// HISTOGRAM: a Pass 1 census invented as round(binomial × N) rather than played. It sums
// correctly, re-derives the right RTP and matches the multiplier table — every recompute check
// in the step agrees with it — and the only thing wrong with it is that it has no noise. That is
// what the dispersion floor exists for, and this is how the claim gets tested.
const TRANSFORMS = {
  'smooth-histograms'(text) {
    const doc = JSON.parse(text);
    const binom = (n, k) => {
      let c = 1;
      for (let i = 0; i < Math.min(k, n - k); i++) c = (c * (n - i)) / (i + 1);
      return c * Math.pow(0.5, n);
    };
    for (const row of doc.pass1_fresh_seeds.results) {
      const n = row.rounds;
      const counts = [];
      for (let k = 0; k <= row.rows; k++) counts.push(Math.round(binom(row.rows, k) * n));
      // Put the rounding residue in the centre so the census still sums to n exactly.
      const drift = n - counts.reduce((a, b) => a + b, 0);
      counts[Math.floor(counts.length / 2)] += drift;
      row.slotCounts = counts;
    }
    return JSON.stringify(doc, null, 2);
  },
  // THE TAIL FORGERY. Swap the two edge slots of the first configuration's census (slot 0 and slot
  // `rows`). The board is symmetric, so the RTP, the chi-squared and its p-value re-derived from the
  // histogram are unchanged, and no convergence point moves: every check that reads the histogram
  // agrees with it, and a prefix replay of the opening rounds cannot see it. Only replaying all
  // 1,000,000 rounds and comparing the census can (profile PLINKO-20).
  'swap-symmetric-census'(text) {
    const doc = JSON.parse(text);
    const row = doc.pass1_fresh_seeds.results[0];
    const c = row.slotCounts;
    [c[0], c[c.length - 1]] = [c[c.length - 1], c[0]];
    return JSON.stringify(doc, null, 2);
  },
};

// ── Workspace ─────────────────────────────────────────────────────────────────

const SKIP = new Set(['node_modules', '.git', '.browser-profile', '.DS_Store', 'outputs']);
const work = mkdtempSync(path.join(tmpdir(), 'plinko-mutate-'));

function buildWorkspace() {
  cpSync(PKG, work, {
    recursive: true,
    filter: (src) => !SKIP.has(path.basename(src)) || src === PKG,
  });
  // outputs/ is skipped above so the run directory of the real package is never copied; the
  // committed artifacts of record are then copied back explicitly.
  mkdirSync(path.join(work, 'outputs'), { recursive: true });
  // rtp-claim-table.json added 2026-10-05: since the RTP-CLAIM table was wired in (2026-09-30), verify
  // exits 1 when the committed table is ABSENT, so without it the baseline in the copy was never green.
  for (const f of ['simulation-results.json', 'determinism-log.json', 'chi-squared-results.json',
                   'verification-results.json', 'rtp-convergence.html', 'rtp-claim-table.json', '.gitkeep']) {
    const from = path.join(PKG, 'outputs', f);
    if (existsSync(from)) cpSync(from, path.join(work, 'outputs', f));
  }
  symlinkSync(path.join(PKG, 'node_modules'), path.join(work, 'node_modules'), 'dir');
}

/** Put every file an entry touches back the way the package has it. */
function restore(files) {
  for (const rel of files) {
    const from = path.join(PKG, rel);
    const to = path.join(work, rel);
    if (existsSync(from)) cpSync(from, to);
    else if (existsSync(to)) rmSync(to);
  }
}

function touchedBy(m) {
  const files = new Set();
  for (const e of edits(m)) files.add(e.file);
  for (const d of m.delete ?? []) files.add(d);
  if (m.transform) files.add(m.transform.file);
  for (const r of m.repin ?? []) files.add(r.file);
  return [...files];
}

function edits(m) {
  if (m.edits) return m.edits;
  if (m.file) return [{ file: m.file, find: m.find, replace: m.replace }];
  return [];
}

function sha256Of(rel) {
  return createHash('sha256').update(readFileSync(path.join(work, rel))).digest('hex');
}

function apply(m) {
  for (const e of edits(m)) {
    const p = path.join(work, e.file);
    const before = readFileSync(p, 'utf8');
    if (!before.includes(e.find)) {
      throw new Error(`anchor not found in ${e.file}: ${JSON.stringify(e.find.slice(0, 70))}`);
    }
    writeFileSync(p, before.replace(e.find, e.replace));
  }
  if (m.transform) {
    const fn = TRANSFORMS[m.transform.name];
    if (!fn) throw new Error(`unknown transform ${m.transform.name}`);
    const p = path.join(work, m.transform.file);
    writeFileSync(p, fn(readFileSync(p, 'utf8')));
  }
  for (const rel of m.delete ?? []) {
    const p = path.join(work, rel);
    if (!existsSync(p)) throw new Error(`cannot delete ${rel}: not present`);
    rmSync(p);
  }
  // Re-pinning happens last: a forgery re-pins what it has already changed.
  for (const r of m.repin ?? []) {
    const p = path.join(work, r.file);
    const before = readFileSync(p, 'utf8');
    if (!before.includes(r.find)) throw new Error(`repin anchor not found in ${r.file}`);
    writeFileSync(p, before.replace(r.find, sha256Of(r.hashOf)));
  }
}

// ── C3 route (FIXPASS2 class C3, 14 Oct 2026) ───────────────────────────────────
// An RTP miss reaches the verdict only when the committed RTP table and the committed verification
// record are consistent with the mutated package; with either stale the run is a reproduction
// failure (exit 1), which is a different guard. An entry with `regen` therefore regenerates them in
// the disposable copy, in order:
//   "rtp-table"  outputs/rtp-claim-table.json by the package's own writer (src/rtp-settings.ts, the
//                script behind `npm run rtp-claim:write`), and RTP_CLAIM_TABLE_SHA256 re-pinned to it
//   "record"     the committed record re-emitted (PF_EMIT=1 tests/verify.ts)
// and `expectExit: N` kills the entry only when the run exits N (5 = RTP FIGURE OVERSTATED) as well as
// printing its marker. Everything a regen rewrote is put back before the next entry.
function regenerate(m) {
  const tsNode = path.join(work, 'node_modules/.bin/ts-node');
  for (const what of m.regen ?? []) {
    if (what === 'rtp-table') {
      const r = spawnSync(tsNode, ['src/rtp-settings.ts'], { cwd: work, encoding: 'utf8', timeout: 900_000 });
      const sha = /sha256 ([0-9a-f]{64})/.exec(r.stdout ?? '')?.[1];
      if (r.status !== 0 || !sha) throw new Error(`regen rtp-table: exit ${r.status} ${String(r.stderr ?? '').slice(-400)}`);
      const p = path.join(work, 'src', 'rtp-settings.ts');
      const text = readFileSync(p, 'utf8');
      const pin = /(export const RTP_CLAIM_TABLE_SHA256 = ')[0-9a-f]{64}(')/;
      if (!pin.test(text)) throw new Error('regen rtp-table: RTP_CLAIM_TABLE_SHA256 pin not found in src/rtp-settings.ts');
      writeFileSync(p, text.replace(pin, `$1${sha}$2`));
    } else if (what === 'record') {
      const r = spawnSync(tsNode, ['tests/verify.ts'], {
        cwd: work, encoding: 'utf8', timeout: 1_800_000,
        env: { ...process.env, PF_EMIT: '1' },
      });
      if (r.status === null) throw new Error(`regen record: no exit status (${r.signal})`);
    } else {
      throw new Error(`unknown regen "${what}"`);
    }
  }
}

/** The files a regen may rewrite: src/rtp-settings.ts and every file directly in outputs/. */
function snapshotRegen() {
  const dir = path.join(work, 'outputs');
  const files = new Map();
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isFile()) files.set(f, readFileSync(p));
  }
  return { settings: readFileSync(path.join(work, 'src', 'rtp-settings.ts')), files };
}
function restoreRegen(snap) {
  const dir = path.join(work, 'outputs');
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isFile() && !snap.files.has(f)) rmSync(p);
  }
  for (const [f, bytes] of snap.files) writeFileSync(path.join(dir, f), bytes);
  writeFileSync(path.join(work, 'src', 'rtp-settings.ts'), snap.settings);
}

const RUNNERS = {
  verify: ['node_modules/.bin/ts-node', ['tests/verify.ts']],
  mocha:  ['node_modules/.bin/mocha', []],
};

// PASS-1 REPLAY. Step 19 replays all 27 × 1,000,000 rounds (minutes, not seconds). A mutation
// aimed at another step runs with PF_P1_REPLAY=off, which caps Step 19 at FLAG — irrelevant to the
// step under test, whose own `expect` marker decides the kill — and saves the full replay per
// mutation. The baseline and every Step 19 mutation run the FULL replay: under PF_P1_REPLAY=off
// every run caps Step 19 at FLAG (printed "[FLAG:operator] Step 19" since 2026-09-28, "[FAIL] Step 19"
// before), so a Step 19 marker must come from a full-replay run to mean anything.
// runner "test": what `npm test` runs — mocha first, verify only when mocha passed — so an entry can
// show that no unit test ends the run before the verifier's own verdict does.
function runRunner(name, fullReplay = true) {
  if (name !== 'test') return runRunner1(name, fullReplay);
  const unit = runRunner1('mocha', fullReplay);
  if (unit.status !== 0) return { ...unit, out: `[runner test: mocha exit ${unit.status}]\n${unit.out}` };
  const v = runRunner1('verify', fullReplay);
  return { ...v, out: `[runner test: mocha exit 0]\n${v.out}` };
}

function runRunner1(name, fullReplay = true) {
  const [bin, args] = RUNNERS[name] ?? RUNNERS.verify;
  const res = spawnSync(path.join(work, bin), args, {
    cwd: work, encoding: 'utf8', timeout: 1_800_000,
    env: { ...process.env, PF_EMIT: '', PF_P1_REPLAY: fullReplay ? '' : 'off' },
  });
  return {
    status: res.status,
    signal: res.signal,
    out: `${res.stdout ?? ''}${res.stderr ?? ''}`,
  };
}

// ── Run ───────────────────────────────────────────────────────────────────────

const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
// --only a,b,c: every entry whose name contains any of the comma-separated substrings.
const selected = ONLY ? registry.filter(m => ONLY.split(',').some(o => m.name.includes(o))) : registry;

console.log(`\n  mutation battery — ${selected.length} of ${registry.length} entries`);
console.log(`  workspace: ${work}\n`);

buildWorkspace();

// The baseline has to be green in the copy, or a KILL means nothing: every mutation would
// "fail" because the copy itself was broken.
const baselineVerify = runRunner('verify');
const baselineMocha = runRunner('mocha');
const baselineOk = baselineVerify.status === 0 && baselineMocha.status === 0
  && baselineVerify.out.includes('PROVABLY FAIR — Full Pass');
if (!baselineOk) {
  console.error('  BASELINE NOT GREEN in the disposable copy — the battery cannot distinguish a kill from a broken copy.');
  console.error(`  verify exit ${baselineVerify.status}, mocha exit ${baselineMocha.status}`);
  console.error(baselineVerify.out.split('\n').slice(-25).join('\n'));
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}
console.log('  baseline: verify exit 0, mocha exit 0, verdict PROVABLY FAIR — Full Pass\n');

// Which steps the verifier actually scores, read from the baseline run rather than assumed.
const scoredSteps = [...baselineVerify.out.matchAll(/\[(?:PASS|FAIL|HARD_FAIL|FLAG(?::capture|:operator)?)\] Step (\d+) —/g)]
  .map(m => Number(m[1]));
const scoredSet = new Set(scoredSteps);

const outcomes = [];
for (const m of selected) {
  const files = touchedBy(m);
  restore(files);
  let result;
  let regenSnap = null;
  try {
    if (m.regen) regenSnap = snapshotRegen();
    apply(m);
    if (m.regen) regenerate(m);
    const run = runRunner(m.runner ?? 'verify', m.step === 19);
    const markerSeen = !m.expect || run.out.includes(m.expect);
    const rejected = run.status !== 0;
    const exitOk = m.expectExit === undefined || run.status === m.expectExit;
    result = rejected && markerSeen && !exitOk
      ? { verdict: 'WRONG-EXIT', detail: `exit ${run.status}, expected ${m.expectExit}${m.expect ? ` (saw "${m.expect}")` : ''}` }
      : rejected && markerSeen
      ? { verdict: 'KILLED', detail: `exit ${run.status}${m.expectExit !== undefined ? ` (expected ${m.expectExit})` : ''}${m.expect ? `, saw "${m.expect}"` : ''}` }
      : rejected
        ? { verdict: 'WRONG-GUARD', detail: `exit ${run.status} but "${m.expect}" never appeared — something else failed` }
        : { verdict: 'SURVIVED', detail: 'exit 0 — the suite accepted the mutation' };
  } catch (err) {
    result = { verdict: 'BROKEN', detail: String(err.message ?? err) };
  } finally {
    if (regenSnap) restoreRegen(regenSnap);
    restore(files);
  }
  outcomes.push({ ...m, ...result });
  const mark = result.verdict === 'KILLED' ? '✓' : '✗';
  console.log(`  ${mark} ${result.verdict.padEnd(11)} ${m.name}`);
  if (result.verdict !== 'KILLED' || m.expectExit !== undefined) console.log(`      ${result.detail}`);
}

// ── Coverage: every scored step needs at least one mutation that kills it ──────

const killedSteps = new Set(outcomes.filter(o => o.verdict === 'KILLED').map(o => o.step));
const uncovered = [...scoredSet].filter(s => !killedSteps.has(s)).sort((a, b) => a - b);

const failed = outcomes.filter(o => o.verdict !== 'KILLED');

console.log('\n  ──────────────────────────────────────────────────────────');
console.log(`  ${outcomes.length - failed.length}/${outcomes.length} mutations killed`);
console.log(`  ${killedSteps.size}/${scoredSet.size} scored steps have a mutation that kills them`);
if (uncovered.length && !ONLY) console.log(`  steps with no killing mutation: ${uncovered.join(', ')}`);
console.log('  ──────────────────────────────────────────────────────────\n');

rmSync(work, { recursive: true, force: true });

if (failed.length || (uncovered.length && !ONLY)) process.exit(1);
