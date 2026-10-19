#!/usr/bin/env node
/**
 * Duel Plinko — generator for RELEASE-MANIFEST.json.
 *
 * The manifest used to be hand-maintained: every hash was a transcription, and every re-pin of an
 * artifact silently invalidated one. This generator applies the audit's own rule — NOTHING
 * MEASURABLE IS TYPED. Artifact hashes are computed from the bytes on disk; the verdict and scored
 * counts are read out of outputs/verification-results.json; the capture window comes from the
 * dataset's own header. What stays typed is the set of facts no file supplies (the audit's identity,
 * the release, the environment) — those are DECLARED, and a change to one is a visible source edit.
 *
 * Usage:
 *   node scripts/release-manifest.mjs            write RELEASE-MANIFEST.json
 *   node scripts/release-manifest.mjs --check     exit 1 if the committed file is stale
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(ROOT, 'RELEASE-MANIFEST.json');
const CHECK = process.argv.includes('--check');

/** The facts no file in this package can supply. `signature` stays null until actually signed. */
const DECLARED = {
  auditId: 'PF-2026-DL01',
  game: 'plinko',
  casino: 'duel',
  release: 'v1.3.0',
  framework: '1.1',
  environmentHost: 'duel.com',
  environmentStage: 'production',
  environmentQualifier: null,
  supersedes: 'v1.2.0',
  signature: 'SHA256:gEujiJm2pRyq7lQsfYQfQ1r97H/J7GdaKHbOW8GtikY',
};

/** Duel's Pass 1 is deterministic from pinned seeds — described here as the audit declares it. */
const SIMULATION = {
  seeding: 'pinned',
  seedSource: 'src/sim-seeds.ts SIM_SEEDS',
  attestation: 'full replay on every npm test: all 27,000,000 Pass 1 rounds regenerated from the pinned seeds, census and running RTP exact, other derived figures at the reproduction tolerance; npm run test:full also regenerates the artifact into outputs/run/ and diffs it',
  note: 'The Pass 1 experiment is deterministic: npm run simulate re-derives outputs/simulation-results.json from the pinned SIM_SEEDS in src/sim-seeds.ts, and the run is compared against the committed artifact at the reproduction tolerance (outputs/run/diff.json). Step 19 re-derives RTP, standard error, chi-squared and its p-value from the committed histograms rather than reading the artifact\'s own scalars, and, since 24 September 2026, replays all 27,000,000 rounds from the pinned seeds (src/pass1.ts, the generator\'s own loop): the census, simulatedRTP and all 189 running-RTP points must come back exactly and the other derived figures within tolerance. No artifact of record carries run metadata, so every integer, string and count reproduces exactly; only the last bits of a few derived floats move across CPUs, which is what the tolerance is for.',
};

/** Every file whose bytes the release is a claim about. Order is the manifest's order. */
const ARTIFACTS = [
  'data/plinko-master-8100bets.json',
  'plinkoConfig.json',
  'outputs/simulation-results.json',
  'outputs/chi-squared-results.json',
  'outputs/determinism-log.json',
  'outputs/rtp-convergence.html',
  'outputs/verification-results.json',
  'outputs/rtp-claim-table.json',   // RTP-CLAIM per-setting table (src/rtp-settings.ts pins it)
];

/** The falsifiability battery. `mutations` is computed from the registry; the RUN RESULT
 * (killed / declaredSurvivors) is DECLARED from the last completed `npm run mutate`, and must be
 * refreshed by re-running the battery — a generator must never assert a kill it did not run. */
const FALSIFIABILITY_DECLARED = { killed: 53, scoredStepsCovered: '23/23', declaredSurvivors: 0 };

/** How long `npm test` takes, and on what. DECLARED from measured runs — a wall time is a property of
 * the machine, so no file in the package can supply it (Mike's review 2026-09-28, F14). */
const RUNTIME_BUDGET = {
  command: 'npm test',
  budget: [
    { cores: 2, maxMinutes: 20 },
    { cores: 12, maxMinutes: 6 },
  ],
  measured: [
    { date: '2026-09-28', machine: 'Apple M2 Max', cores: 12, workerThreads: 7, node: '22.23.1', wallSeconds: 265, by: 'time npm test' },
    { date: '2026-09-28', machine: 'Apple M2 Max', cores: 12, workerThreads: 2, node: '22.23.1', wallSeconds: 360, by: 'time env PF_PARALLEL_WORKERS=1 npm test (the thread count a 2-core machine gets)' },
    { date: '2026-09-28', machine: 'reviewer (2 cores)', cores: 2, workerThreads: 2, node: null, wallSeconds: 840, by: 'reported in the 2026-09-28 review ("14 minutes on 2 cores")' },
  ],
  scaling: 'Step 19 replays 27,000,000 Pass 1 rounds on worker threads (~60% of reported cores, src/parallel.ts; PF_PARALLEL_WORKERS overrides)',
};

const AUDIT_ID_DOCS = ['README.md', 'MANIFEST.md'];

const problems = [];
const fail = (m) => problems.push(m);
const abs = (rel) => path.join(ROOT, rel);
const sha256 = (rel) => { const a = abs(rel); if (!fs.existsSync(a)) { fail(`${rel} is missing`); return null; } return createHash('sha256').update(fs.readFileSync(a)).digest('hex'); };
const readJson = (rel) => { const a = abs(rel); if (!fs.existsSync(a)) { fail(`${rel} is missing`); return null; } try { return JSON.parse(fs.readFileSync(a, 'utf8')); } catch (e) { fail(`${rel} invalid JSON: ${e.message}`); return null; } };

const results = readJson('outputs/verification-results.json');
const dataset = readJson('data/plinko-master-8100bets.json');
const mutations = readJson('tests/mutations.json');

const artifacts = {};
for (const rel of ARTIFACTS) { const h = sha256(rel); if (h) artifacts[rel] = h; }

// One summary shape across the Duel packages (Mike 2026-09-28, F20):
// { passed, flags, operatorFlags, captureFlags, hardFail, verdict }.
const summary = results?.summary ?? {};
const verdict = summary.verdict;
const scored = {
  passed: summary.passed,
  flags: summary.flags,
  operatorFlags: summary.operatorFlags,
  captureFlags: summary.captureFlags,
  hardFail: summary.hardFail,
};
for (const k of Object.keys(scored)) if (typeof scored[k] !== 'number') fail(`verification-results.json summary.${k} is not a number — the summary is not in the one Duel shape`);
scored.of = [scored.passed, scored.flags, scored.hardFail].every((n) => typeof n === 'number') ? scored.passed + scored.flags + scored.hardFail : undefined;
if (typeof verdict !== 'string' || !verdict) fail('verification-results.json has no summary.verdict — run npm test first');
if (typeof scored.flags === 'number' && scored.flags !== scored.operatorFlags + scored.captureFlags) fail(`summary.flags ${scored.flags} != operatorFlags + captureFlags`);
if (scored.hardFail !== 0) fail(`the committed run has hardFail=${scored.hardFail} — a release manifest may only describe a run with no hard failures`);

const datasetSha256 = artifacts['data/plinko-master-8100bets.json'] ?? null;
const meta = dataset?.meta ?? {};
const capturedAt = { from: meta.createdAt ?? null, to: meta.completedAt ?? null };
if (!capturedAt.from || !capturedAt.to) fail('dataset meta is missing createdAt / completedAt');

for (const doc of AUDIT_ID_DOCS) { const a = abs(doc); if (!fs.existsSync(a)) { fail(`${doc} is missing`); continue; } if (!fs.readFileSync(a, 'utf8').includes(DECLARED.auditId)) fail(`${doc} does not carry the declared audit ID ${DECLARED.auditId}`); }

const manifest = {
  auditId: DECLARED.auditId,
  game: DECLARED.game,
  casino: DECLARED.casino,
  release: DECLARED.release,
  framework: DECLARED.framework,
  simulation: SIMULATION,
  runtimeBudget: RUNTIME_BUDGET,
  datasetSha256,
  artifacts,
  verdict,
  scored,
  capturedAt,
  environment: { host: DECLARED.environmentHost, stage: DECLARED.environmentStage, qualifier: DECLARED.environmentQualifier },
  supersedes: DECLARED.supersedes,
  signature: DECLARED.signature,
  falsifiability: {
    registry: 'tests/mutations.json',
    runner: 'scripts/mutate.mjs',
    mutations: Array.isArray(mutations) ? mutations.length : null,
    killed: FALSIFIABILITY_DECLARED.killed,
    scoredStepsCovered: FALSIFIABILITY_DECLARED.scoredStepsCovered,
    declaredSurvivors: FALSIFIABILITY_DECLARED.declaredSurvivors,
  },
};

if (problems.length) { console.error('  [release-manifest] cannot produce a manifest:'); for (const p of problems) console.error(`    - ${p}`); process.exit(1); }

const rendered = `${JSON.stringify(manifest, null, 2)}\n`;

if (CHECK) {
  if (!fs.existsSync(MANIFEST_PATH)) { console.error('  [release-manifest] RELEASE-MANIFEST.json missing — run npm run release-manifest'); process.exit(1); }
  if (fs.readFileSync(MANIFEST_PATH, 'utf8') !== rendered) { console.error('  [release-manifest] RELEASE-MANIFEST.json is STALE — regenerate with npm run release-manifest'); process.exit(1); }
  console.log(`  [release-manifest] OK: ${Object.keys(artifacts).length} artifact hashes match disk, verdict "${verdict}", scored ${scored.passed}/${scored.of} (flags ${scored.flags})`);
  process.exit(0);
}
fs.writeFileSync(MANIFEST_PATH, rendered);
console.log(`  [release-manifest] wrote RELEASE-MANIFEST.json — ${Object.keys(artifacts).length} artifacts, verdict "${verdict}", scored ${scored.passed}/${scored.of} (flags ${scored.flags})`);
