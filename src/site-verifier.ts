/**
 * PLAYER-VERIFIER PARITY (profile PLINKO-24) — the docusaurus site verifier.
 *
 * The ProvablyFair.org docs site ships a player-facing verifier for Duel Plinko: the VerifyBets
 * component, whose Plinko derivation is `src/components/VerifyBets/games/plinko/derive.js`. It
 * imports three files: `lib/hmac-sha256.js` (the HMAC), `games/plinko/paytables.js` (the bracket-0
 * multiplier tables) and `games/plinko/scalingEdge.js` (the scaling-edge formula, which itself
 * imports paytables.js). A player who pastes a bet into that page is trusting THAT code, not this
 * package's src/rng.ts. Until 2026-09-24 the two were related by nothing but a comment in derive.js
 * ("Source of truth: …/duel-plinko/blob/main/src/rng.ts") — a hand sync no check could see break.
 *
 * WHAT THIS FILE DOES (ported from pf-duel-workspace/games/mines/src/site-verifier.ts).
 *   1. PINS the SHA-256 of all four site files as constants (SITE_VERIFIER_PINS).
 *   2. Holds a VENDORED copy of those exact bytes under verifier-parity/, laid out as on the site so
 *      each relative import names the same file. The vendored bytes must hash to the pins or Step 5
 *      FAILs.
 *   3. EXECUTES the vendored derivePlinko — not a re-typing of it — on every captured bet, and Step 5
 *      requires its slot and L/R path to equal the ones src/rng.ts computes (and so, by Step 5, the
 *      slot the casino served), and its multiplier to equal the multiplier the casino served, apart
 *      from the DECLARED divergence below, which must reproduce exactly. Any other disagreement is a
 *      FAIL.
 *   scripts/check-site-verifier.mjs compares a live checkout of the site with the pins (exit 1 on
 *   any difference), so a site edit that was never re-vendored is caught at release time.
 *
 * NOT VENDORED: games/plinko/index.js (the component adapter — it resolves the bet-size bracket from
 * a lazily fetched threshold table and calls derivePlinko), Inputs.jsx / Viz.jsx (rendering) and
 * source.js (display text). The bracket the adapter would choose is therefore NOT exercised here:
 * every call passes bracketIndex 0, the adapter's own default when no bet size is entered. Every
 * captured bet was paid a bracket-0 multiplier (Step 8: 8,100/8,100 served multipliers match
 * scaling_edge[0]), so bracket 0 is the bracket each captured bet is compared in.
 *
 * HOW THE VENDORED ES MODULES ARE RUN. The suite is synchronous CommonJS and must run with zero
 * install (verify.js), and the site files are ES modules with extensionless relative imports that
 * Node's ESM resolver would refuse. So each file is evaluated with node:vm inside its own function
 * scope, after exactly two textual rewrites applied to the in-memory copy only, never to the hashed
 * file: its import lines — which must equal the DECLARED import set for that file byte for byte, any
 * other import FAILs because it would be code this check does not vendor — are removed and their
 * names bound as parameters to the already-evaluated vendored module, and the `export ` keyword is
 * dropped from each top-level declaration. No other character is touched, so every line of logic
 * that runs is a line whose bytes are pinned. scalingEdge.js's `loadThresholds` references `fetch`;
 * it is never called (no network), which the vm scope would surface as a ReferenceError if it were.
 *
 * RE-VENDORED 2026-09-25 from the site's origin/main @ bd4d59cd9a3e75146f2575c5218a3fb9a8b2692d (2026-09-19),
 * read with `git cat-file -p origin/main:<path>` (the local checkout was not switched or modified). The
 * bytes pinned before this date came from the local checkout's branch repotree-sync @ 2ad89bc, which is
 * NOT an ancestor of main; between the two, the vendored files of this game differ only in the source-URL
 * comment (github.com/ProvablyFair/… → github.com/ProvablyFair-org/…) — no line of logic changed.
 *
 * PROVENANCE OF THE PINNED BYTES (read 2026-09-24, read-only):
 *   repository  qa-workspace/duel/docusaurus (mikepforg/pf-audit-duel), branch repotree-sync,
 *               HEAD 2ad89bc774c4817abfe8ed0422af7b3e03e7c477; the checkout had 122 uncommitted
 *               changes, NONE of them in these four files (working tree == HEAD for each); all four
 *               last changed in 80046e3 (2026-05-08, "Add files via upload").
 *   The LIVE page (www.provablyfair.org/verify-bets) is a separate Next.js build; its deployed bundle is
 *   pinned and executed by src/live-site-verifier.ts (Step 5, live-site leg).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

export const SITE_VERIFIER_DIR = path.join(__dirname, '../verifier-parity');

/** Site-relative path → SHA-256 of the exact bytes. The vendored copies live at the same relative paths. */
export const SITE_VERIFIER_PINS: Readonly<Record<string, string>> = Object.freeze({
  'games/plinko/derive.js':      'dd8417482d2e18fef35894c7ac16e17a61a9eb4166817e3d8533d2160d9b754e',
  'games/plinko/paytables.js':   '7158d02dab13b632507b5c6e4149d5c01ad864a2f15a3e7bbe9d6d08a720a704',
  'games/plinko/scalingEdge.js': '6b833ed47c215aab1a5c499dcb22bf1dc31cfbc1d5b5dc17b53d41d7c4b6ef31',
  'lib/hmac-sha256.js':          'bc30bfe9ef202905ece93de33440d41851abf16e910f90c2a567774a2b79d889',
});

export const SITE_VERIFIER_PROVENANCE = Object.freeze({
  siteRoot: 'qa-workspace/duel/docusaurus/src/components/VerifyBets',
  repository: 'mikepforg/pf-audit-duel',
  ref: 'origin/main',
  head: 'bd4d59cd9a3e75146f2575c5218a3fb9a8b2692d',
  headDate: '2026-09-19',
  readVia: 'git cat-file -p origin/main:<path>',
  readOn: '2026-09-25',
  previouslyPinnedFrom: 'repotree-sync @ 2ad89bc774c4817abfe8ed0422af7b3e03e7c477 (read 2026-09-24)',
});

/**
 * Evaluation order and, per file, the ONLY import lines it may carry → the vendored file each binds.
 * Anything else is code this check does not vendor.
 */
export const SITE_MODULES: ReadonlyArray<{ file: string; imports: ReadonlyArray<{ line: string; from: string; names: string[] }> }> = Object.freeze([
  { file: 'lib/hmac-sha256.js', imports: [] },
  { file: 'games/plinko/paytables.js', imports: [] },
  {
    file: 'games/plinko/scalingEdge.js',
    imports: [{ line: "import { paytable, slotCount } from './paytables';", from: 'games/plinko/paytables.js', names: ['paytable', 'slotCount'] }],
  },
  {
    file: 'games/plinko/derive.js',
    imports: [
      { line: "import { hmacSha256Hex, hexToBytes } from '../../lib/hmac-sha256';", from: 'lib/hmac-sha256.js', names: ['hmacSha256Hex', 'hexToBytes'] },
      { line: "import { paytable, slotCount } from './paytables';", from: 'games/plinko/paytables.js', names: ['paytable', 'slotCount'] },
      { line: "import { multiplierFor } from './scalingEdge';", from: 'games/plinko/scalingEdge.js', names: ['multiplierFor'] },
    ],
  },
]);

/**
 * DECLARED MULTIPLIER DIVERGENCE (MANIFEST.md L5) — a finding against the ProvablyFair.org site
 * verifier, not against the operator. Measured 2026-09-24 by executing the vendored derivePlinko on
 * all 8,100 captured bets: the slot and the L/R path agree with src/rng.ts on 8,100/8,100, but the
 * MULTIPLIER the page returns differs from the multiplier Duel served on 224 bets. The cause is the
 * table: paytables.js equals plinkoConfig.json `payout_tables` on 351/351 cells, while Duel pays
 * `scaling_edge[rows][risk][0].multipliers` (Step 8: 8,100/8,100 served multipliers match
 * scaling_edge[0]); the two blocks differ on 118 of 351 cells by at most 1.49e-6. The captured bets
 * hit 53 of those cells; the largest gap on a captured bet is 1.1e-7.
 *
 * Step 5 re-executes the site on every run and FAILs unless the divergence is EXACTLY this: every
 * bet whose site multiplier differs from the served one must carry the payout_tables value of its
 * cell, that cell must be one where the two config blocks differ, the gap must be within
 * maxAbsDelta, and the bet count and the cell count must equal the declared ones. A site fix must
 * retire this declaration and L5 together.
 */
export const DECLARED_SITE_MULTIPLIER_DIVERGENCE = Object.freeze({
  siteTable: 'payout_tables',
  servedTable: 'scaling_edge[0].multipliers',
  betsAffected: 224,
  cellsHit: 53,
  maxAbsDelta: 1.1000000199601345e-7,
});

export interface SiteDerived { slot: number; path: string; multiplier: number; rawFloat: number; firstHmac: string }
export type SiteDerive = (p: { clientSeed: string; serverSeed: string; nonce: number; rows: number; risk: string; bracketIndex?: number }) => SiteDerived;

export interface SiteVerifierLoad {
  files: Array<{ file: string; pinned: string; actual: string | null; match: boolean }>;
  hashesMatch: boolean;
  /** Present only when every hash matches and every module evaluated. */
  derivePlinko: SiteDerive | null;
  error: string | null;
}

const sha256 = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

/** Drop `export ` from top-level declarations; nothing else. */
const stripExports = (src: string): string =>
  src.replace(/^export (function|const|let|class) /gm, '$1 ');

/** The names a module exports, read from its own `export <kind> NAME` declarations. */
const exportedNames = (src: string): string[] =>
  [...src.matchAll(/^export (?:function|const|let|class) ([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);

/**
 * Hash the vendored files against the pins and, only if every one matches, evaluate them.
 * Never throws: a failure is returned as `error` so Step 5 reports it as a FAIL.
 */
export function loadSiteVerifier(dir = SITE_VERIFIER_DIR): SiteVerifierLoad {
  const files = Object.entries(SITE_VERIFIER_PINS).map(([file, pinned]) => {
    const p = path.join(dir, file);
    const actual = fs.existsSync(p) ? sha256(fs.readFileSync(p)) : null;
    return { file, pinned, actual, match: actual === pinned };
  });
  const hashesMatch = files.every(f => f.match);
  if (!hashesMatch) {
    return { files, hashesMatch, derivePlinko: null, error: 'vendored site verifier does not match its pinned SHA-256' };
  }
  try {
    const evaluated = new Map<string, Record<string, unknown>>();
    for (const mod of SITE_MODULES) {
      const src = fs.readFileSync(path.join(dir, mod.file), 'utf8');
      const importLines = src.split('\n').filter(l => /^\s*import\b/.test(l));
      const declared = mod.imports.map(i => i.line);
      if (importLines.length !== declared.length || importLines.some((l, i) => l !== declared[i])) {
        return { files, hashesMatch, derivePlinko: null,
          error: `${mod.file} imports ${JSON.stringify(importLines)}; the vendored import set is ${JSON.stringify(declared)}` };
      }
      let body = src;
      for (const line of declared) body = body.replace(line, '');
      const params = mod.imports.flatMap(i => i.names);
      const args = mod.imports.flatMap(i => {
        const dep = evaluated.get(i.from);
        if (!dep) throw new Error(`${mod.file} imports ${i.from}, which has not been evaluated`);
        return i.names.map(n => {
          if (!(n in dep)) throw new Error(`${i.from} does not export ${n}`);
          return dep[n];
        });
      });
      const names = exportedNames(src);
      // runInThisContext, not runInNewContext: the pure-JS SHA-256 runs ~30x slower in a fresh
      // context (measured on the mines port, 2026-09-24), which would force a sample instead of
      // every bet. Each file is still wrapped in its own function so its top-level names stay private.
      const fn = vm.runInThisContext(
        `(function (${params.join(', ')}) {\n${stripExports(body)}\n;return { ${names.join(', ')} };\n})`,
        { filename: `verifier-parity/${mod.file}` },
      ) as (...a: unknown[]) => Record<string, unknown>;
      evaluated.set(mod.file, fn(...args));
    }
    const derive = evaluated.get('games/plinko/derive.js')?.derivePlinko;
    if (typeof derive !== 'function') {
      return { files, hashesMatch, derivePlinko: null, error: 'derive.js does not define derivePlinko' };
    }
    return { files, hashesMatch, derivePlinko: derive as SiteDerive, error: null };
  } catch (e) {
    return { files, hashesMatch, derivePlinko: null, error: `vendored site verifier failed to evaluate: ${(e as Error).message}` };
  }
}
