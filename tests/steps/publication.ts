/**
 * Step 22 — Published-Pin Drift Scan.
 *
 * A chapter is where the reader actually meets the evidence, and it is the one surface nothing
 * in this suite used to check. Every hash a chapter prints is a claim about a file or a record:
 * "this is the dataset", "this is the seed that produced that bet". Re-capture the game, re-pin
 * the artifact, and those quoted values go stale silently — the verifier keeps printing Full Pass
 * because it never reads the prose.
 *
 * This scan reads every 64-hex token in every published chapter and requires each one to resolve
 * to something the package can point at: a pin the loader declares, a value that genuinely
 * occurs in the audited dataset or the committed configuration, or the recomputed SHA-256 of an
 * image in evidence/ (the only other allowed token is the all-zero placeholder). It is deliberately KEYWORD-FREE —
 * it does not look for tokens near the word "hash", it looks at all of them — because the ones
 * that drift are exactly the ones nobody labelled.
 *
 * On its first run it flagged two worked examples (in chapters since consolidated into
 * MANIFEST.md) whose values did not resolve; both were recomputed from the audited dataset.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

import type { StepResult } from '../../src/types';
import { pass, fail, VerifyContext, tag } from './context';
import {
  loadMasterBuffer, getConfigPath,
  EXPECTED_DATASET_SHA256, PLINKO_CONFIG_HASH,
} from '../../src/loader';
import { ARTIFACT_PINS } from '../../src/artifact-pins';
import { SITE_VERIFIER_PINS } from '../../src/site-verifier';
import { LIVE_SITE_PINS } from '../../src/live-site-verifier';
import { OPERATOR_VERIFIER_PINS } from '../../src/operator-verifier';

const HEX64 = /[0-9a-f]{64}/g;

/**
 * Tokens that are deliberately not a real value: illustrative placeholders in prose.
 * Every entry needs a reason — an allow-list without one is a way to make a failure go away.
 */
const ALLOWED: ReadonlyArray<{ token: string; reason: string }> = Object.freeze([
  {
    token: '0'.repeat(64),
    reason: 'the all-zero placeholder used in negative-control examples; it is not a value from the capture',
  },
]);

export function run(ctx: VerifyContext): StepResult[] {
  const root = path.join(__dirname, '..', '..');

  // Everything the package can vouch for, gathered once.
  const declaredPins = new Map<string, string>([
    [EXPECTED_DATASET_SHA256, 'src/loader.ts EXPECTED_DATASET_SHA256'],
    [PLINKO_CONFIG_HASH, 'src/loader.ts PLINKO_CONFIG_HASH'],
    ...Object.entries(ARTIFACT_PINS).map(([file, h]) => [h, `src/artifact-pins.ts ${file}`] as [string, string]),
    // The ProvablyFair.org site-verifier pins (PLINKO-24). Step 5 hashes the vendored bytes in
    // verifier-parity/ against these before executing them, so each is bound to a shipped file.
    ...Object.entries(SITE_VERIFIER_PINS).map(([file, h]) => [h, `src/site-verifier.ts ${file}`] as [string, string]),
    ...Object.entries(LIVE_SITE_PINS).map(([file, h]) => [h, `src/live-site-verifier.ts ${file}`] as [string, string]),
    ...Object.entries(OPERATOR_VERIFIER_PINS).map(([file, h]) => [h, `src/operator-verifier.ts ${file}`] as [string, string]),
  ]);

  const fromDataset = new Set<string>();
  for (const s of ctx.seeds) {
    if (s.seed.serverSeed) fromDataset.add(s.seed.serverSeed);
    if (s.seed.serverSeedHashed) fromDataset.add(s.seed.serverSeedHashed);
    if (s.seed.nextServerSeedHash) fromDataset.add(s.seed.nextServerSeedHash);
    if (s.nextSeedPromotion) {
      fromDataset.add(s.nextSeedPromotion.previousNextHash);
      fromDataset.add(s.nextSeedPromotion.newActiveHash);
      if (s.nextSeedPromotion.newNextHash) fromDataset.add(s.nextSeedPromotion.newNextHash);
    }
  }
  for (const b of ctx.bets) fromDataset.add(b.response.server_seed_hashed);

  const configText = fs.readFileSync(getConfigPath(), 'utf8');
  const allowed = new Map(ALLOWED.map(a => [a.token, a.reason]));

  // Exhibit image hashes published in MANIFEST.md Evidence (PLINKO-30): allow exactly the SHA-256s that
  // match a real image file in evidence/. A genuine exhibit hash resolves; a fabricated or
  // substituted one matches no file on disk and still fails the scan — the hash is bound to bytes,
  // not just allow-listed.
  const evidenceDir = path.join(root, 'evidence');
  if (fs.existsSync(evidenceDir)) {
    for (const f of fs.readdirSync(evidenceDir).filter(n => /\.(png|jpe?g|gif|webp)$/i.test(n))) {
      const h = createHash('sha256').update(fs.readFileSync(path.join(evidenceDir, f))).digest('hex');
      allowed.set(h, `evidence/${f} — recomputed exhibit image hash`);
    }
  }

  const chapters = fs.readdirSync(root).filter(f => f.endsWith('.md')).sort();
  const unresolved: string[] = [];
  const byOrigin: Record<string, number> = { declaredPin: 0, datasetValue: 0, configValue: 0, allowListed: 0 };
  let scanned = 0;

  for (const file of chapters) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const seen = new Set<string>();
    for (const m of text.matchAll(HEX64)) {
      const token = m[0];
      scanned++;
      if (declaredPins.has(token)) { byOrigin.declaredPin++; continue; }
      if (fromDataset.has(token)) { byOrigin.datasetValue++; continue; }
      if (allowed.has(token)) { byOrigin.allowListed++; continue; }
      if (configText.includes(token)) { byOrigin.configValue++; continue; }
      if (seen.has(token)) continue;
      seen.add(token);
      unresolved.push(
        `${file}: ${token.slice(0, 16)}… matches no pin the loader declares and occurs nowhere in the `
        + `audited dataset or the committed config — it names evidence this package does not ship`
      );
    }
  }

  // A scan that found nothing because it looked at nothing is not a passing scan.
  if (chapters.length === 0) {
    unresolved.push('no chapters found to scan — the drift scan had nothing to read');
  }

  const details = {
    chapters: chapters.length,
    tokensScanned: scanned,
    resolvedBy: byOrigin,
    unresolved: unresolved.length,
    declaredPins: [...declaredPins.values()],
    allowList: ALLOWED,
    method: 'keyword-free: every 64-hex token in every root-level .md is read, not only those near the word "hash"',
  };

  const r = unresolved.length === 0
    ? pass(22, 'Published-Pin Drift Scan', ['EC-25'],
        `${scanned} 64-hex tokens across ${chapters.length} published chapters, every one of them a pin src/ `
        + `declares, a value that occurs in the audited dataset or the committed config, or an allow-listed token `
        + `(the recomputed SHA-256 of an image in evidence/, or the all-zero placeholder). Nothing quoted in the `
        + `prose names evidence this package does not ship.`,
        details)
    : fail(22, 'Published-Pin Drift Scan', ['EC-25'], 'HARD_FAIL',
        `${unresolved.length} published hash(es) resolve to nothing in this package`, unresolved, details);
  console.log(`  [${tag(r)}] Step 22 — ${r.name}`);
  return [r];
}
