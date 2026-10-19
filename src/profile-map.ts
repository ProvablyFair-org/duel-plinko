/**
 * Which ProvablyFair.org Plinko profile check each scored step implements.
 *
 * WHY THIS FILE EXISTS. The framework's game profile declares checks PLINKO-01 … PLINKO-39.
 * This suite scores 22 steps under its own numbering, which every chapter cites by number and
 * which therefore cannot be renumbered to match. Without a written mapping the only way to
 * relate the two was to read all 22 steps by hand and type the answer into the profile — where
 * it went stale the moment a step changed, silently, because nothing re-derived it. The mapping
 * is declared here, emitted into `outputs/verification-results.json` beside the step results,
 * and read back by `pf-audit matrix`, which prints the conformance matrix and exits 1 when a
 * HARD_FAIL check has nothing implementing it.
 *
 * THIS FILE LABELS; IT DOES NOT CHECK. Nothing here can make a step pass or fail. An id claimed
 * for a step the step does not implement is a false statement in a published artifact, so the
 * rule is the profile's own `asserts` text: claim the check only if the step's assertion
 * actually decides it.
 *
 * COVERAGE DESCRIBES THE PACKAGE, NOT THE STEP.
 *   full    — nothing the profile's `asserts` requires is unimplemented; where a check is split
 *             across two steps both say `full` and each note says which half it carries.
 *   partial — something the profile requires is implemented nowhere in this package, and the
 *             note says what. `partial` is a disclosure, never a softer word for `full`.
 * A check no step claims is absent from the matrix by construction: that is the point.
 */

export type Coverage = 'full' | 'partial';

export interface CheckClaim {
  id: string;
  coverage: Coverage;
  /** For `partial`: what the profile requires that this package does not do. */
  note?: string;
}

export interface StepClaims {
  claims: CheckClaim[];
  /** Required when `claims` is empty: why the step answers no profile check. */
  reason?: string;
}

export const PROFILE_GAME = 'plinko';
export const PROFILE_VERSION = '1.0.2';

/** Scored step number → the profile checks it implements. Every step 1..22 has an entry. */
export const STEP_CLAIMS: Record<number, StepClaims> = {
  1: { claims: [{ id: 'PLINKO-01', coverage: 'full' }] },
  2: { claims: [{ id: 'PLINKO-02', coverage: 'full' }] },
  3: { claims: [{ id: 'PLINKO-03', coverage: 'full' }] },
  4: {
    claims: [
      { id: 'PLINKO-03', coverage: 'full' },
      {
        id: 'PLINKO-04', coverage: 'full',
        note: 'a nonce the capture missed to an auditor-side retry is reconstructed from the '
          + 'revealed server seed whose SHA-256 matches the pre-bet commitment; the commit-reveal '
          + 'chain determines the outcome, but because the auditor did not witness it in the '
          + 'capture the step raises a capture-origin FLAG, not a PASS (disclosed as L2 in '
          + 'MANIFEST.md). A capture-origin FLAG is verdict-neutral: the verdict stays Full Pass. '
          + 'A gap that cannot be reconstructed this way — no revealed seed, or a seed that does '
          + 'not hash to the commitment — is a verdict-affecting FLAG. Rule adopted 2026-09-22 '
          + '(Fable QA): a reconstructed nonce is not graded as a PASS, and it is not held against '
          + 'the verdict either',
      },
    ],
  },
  5: {
    claims: [
      { id: 'PLINKO-07', coverage: 'full' },
      { id: 'PLINKO-08', coverage: 'full' },
    ],
  },
  6: {
    claims: [
      { id: 'PLINKO-06', coverage: 'full' },
      { id: 'PLINKO-36', coverage: 'full' },
    ],
  },
  7: {
    claims: [
      { id: 'PLINKO-10', coverage: 'full' },
      { id: 'PLINKO-11', coverage: 'full' },
    ],
  },
  8: {
    claims: [
      { id: 'PLINKO-10', coverage: 'full' },
      { id: 'PLINKO-13', coverage: 'full' },
    ],
  },
  9: { claims: [{ id: 'PLINKO-12', coverage: 'full' }] },
  10: {
    claims: [{
      id: 'PLINKO-17', coverage: 'full',
      note: 'zero_edge half — every effective_edge group is recomputed against the committed table '
        + 'and its table RTP is derived; measured on the captured stakes ($0.01 and $10), both groups '
        + '(edge 0 and 0.1) resolve to the same bracket-0 multipliers, so there the effective_edge=0 '
        + 'label selects no distinct-RTP table and a '
        + 'separate zero-edge mode is declared n/a in step 16',
    }],
  },
  11: { claims: [{ id: 'PLINKO-15', coverage: 'full' }] },
  12: { claims: [{ id: 'PLINKO-05', coverage: 'full' }] },
  13: { claims: [{ id: 'PLINKO-14', coverage: 'full' }] },
  14: { claims: [{ id: 'PLINKO-05', coverage: 'full' }] },
  15: { claims: [{ id: 'PLINKO-26', coverage: 'full' }] },
  16: {
    claims: [{
      id: 'PLINKO-17', coverage: 'full',
      note: 'scaling_edge half — every bracket of every config is recomputed at full coverage, its '
        + 'RTP derived and equated to its declared house_edge; WTF and a distinct zero-edge table '
        + 'are declared n/a (this game ships neither)',
    }, {
      id: 'PLINKO-39', coverage: 'full',
      note: 'all brackets of all 27 configs are audited: declared edge = 1−derived RTP, symmetric '
        + 'multipliers, the ladder tiles the stake axis with no gap/overlap and monotone '
        + 'non-decreasing edge, the per-config span is the declared [0.001, 0.02], and '
        + 'bottom/middle/top stakes each resolve to the bracket whose range contains them (a lookup '
        + 'in the pinned config; which bracket the server applies above bracket 0 was not tested, '
        + 'R-BRACKET)',
    }],
  },
  17: { claims: [{ id: 'PLINKO-18', coverage: 'full' }] },
  18: { claims: [{ id: 'PLINKO-06', coverage: 'full' }] },
  19: {
    claims: [
      { id: 'PLINKO-19', coverage: 'full' },
      {
        id: 'PLINKO-20', coverage: 'full',
        note: '27 configurations × 1,000,000 rounds on the pinned fresh seeds of src/sim-seeds.ts; chi-squared '
          + 'at the Bonferroni threshold (0.01/27) and serial independence (lag-1, runs) gated; RTP, standard '
          + 'error, chi-squared and its p-value re-derived in verify from the committed histograms. THE '
          + 'EXPERIMENT IS REPLAYED IN FULL on every run (since 2026-09-24): all 27,000,000 rounds are '
          + 'regenerated from the pinned seeds by src/pass1.ts playPass1Config — the per-configuration loop '
          + 'moved out of src/simulate.ts unchanged, so generator and replay are one function — fanned out over '
          + 'worker threads (src/parallel.ts, ported from LIQD Plinko; one configuration stays on one thread). '
          + 'The census must equal the artifact exactly (every slot count of every configuration), and so must '
          + 'simulatedRTP and all seven running-RTP points (IEEE sums and quotients in nonce order, no tolerance); '
          + 'every other derived figure it carries — rtpDiff, lag1R, lag1Z, runsP, expected counts, the pooled '
          + 'convergence trace, the mean RTPs and the failure counters — must equal the replay within the '
          + 'reproduction tolerance (1e-14 + 1e-12·max; counters exact). Measured: 27/27 '
          + 'configurations, 0 census mismatches, 691 derived figures compared, 691 bit-identical, 0 beyond '
          + 'tolerance. Until 2026-09-24 only the first 10,000 rounds of each configuration were replayed; '
          + 'PF_P1_REPLAY=off keeps that prefix replay for a LOCAL run only, capped at FLAG (the mutation '
          + 'battery uses it for mutations aimed at other steps). FAIL probed: M27b (the first configuration\'s '
          + 'two edge-slot counts swapped — invisible to every histogram check and to the old prefix replay — '
          + 'artifact re-pinned), M27 (one running-RTP point moved by one unit in the last place), M28 (pinned seed altered)',
      },
      { id: 'PLINKO-31', coverage: 'full' },
      { id: 'PLINKO-32', coverage: 'full' },
    ],
  },
  20: {
    claims: [{
      id: 'PLINKO-21', coverage: 'full',
      note: 'every revealed epoch (162, bound to the revealed-seed count) × 10,000 nonces is REPLAYED in verify '
        + 'on the boards of its own epoch (src/pass2-replay.ts; one HMAC scan per nonce gives the slot of every '
        + 'board), and the replay is bound to the capture: 8,100/8,100 captured bets re-read at their own nonce '
        + 'equal the served slot. TEST C is the profile\'s statistic: the payout sum of the 50 configurations the '
        + 'casino actually served at nonces 0–49 (the captured nonce range; nonce n ≥ 50 plays served position '
        + 'n mod 50) standardised by the EXACT per-board mean and variance (binomial slot law × the served '
        + 'bracket-0 multipliers); reference window = nonces 50–9,999. Duel\'s 8-dp multipliers are too fine a '
        + 'lattice for an exact convolution, so the null is Monte-Carlo calibration on 10,000 FRESH seeds derived '
        + 'by a fixed public rule (nullSeed) playing the same served sequence; p = (1 + #null ≤ z)/(R + 1). '
        + 'Pre-registered one-sided rule (the TEST_C_* constants in tests/steps/simulation.ts, WRITTEN 2026-09-24 '
        + 'BEFORE THE STATISTIC WAS FIRST COMPUTED, with the α values HouseBets and LIQD fixed for the same '
        + 'statistic; written after this capture\'s seeds were revealed, as for those packages): flag at '
        + 'p ≤ 0.01; flags aggregated by Poisson-binomial survival over the per-epoch null flag probability; '
        + 'survival < 0.001 → FAIL, < 0.01 → FLAG (marginal excess); BROAD (early AND reference window both '
        + 'p ≤ 0.001, reference null = bootstrap of 199 calibrated windows) → FAIL; pooled z < −3.090 → FAIL. '
        + 'Direction split and detection power are printed. Tests A and B of the committed artifact are now '
        + 'RE-DERIVED row by row from the replay (242 rows, 0 mismatches) instead of read. Measured: 1/162 epochs flagged (family survival 0.8037; the rule fails at 8), 0 broad, pooled z −0.554, early windows 98 below / 64 above expectation (the null expects 99.9 below); power at a 10% early-window shortfall 12.7% per epoch, 30.7% for the family if 25% of epochs were picked. '
        + 'Disclosed: in the 2 capture-retry epochs (L2) the early window 0–49 holds the replayed missed nonce and '
        + 'captured nonce 50 falls in the reference window. FAIL probed: M29b (early windows pay half → family '
        + 'and pooled gates), M29c (whole seed pays half → broad), M29d (a Test B p-value forged, artifact '
        + 're-pinned), M29e (replay reads the wrong nonce → binding); FLAG probed: M29f (eight epochs\' early '
        + 'windows pay half → marginal excess)',
    }, {
      id: 'PLINKO-38', coverage: 'full',
    }],
  },
  21: {
    claims: [{
      id: 'PLINKO-27', coverage: 'full',
      note: 'every pinned artifact is re-hashed, un-ignored by name and free of run metadata, and '
        + 'run products go to outputs/run/; and src/domains.ts now declares a value domain for '
        + 'every numeric leaf of every pinned JSON artifact — bounds derived from src/ '
        + '(sim-seeds.ts, loader.ts) and the hash-pinned config, never from the artifact under '
        + 'check — which this step enforces as a HARD_FAIL: an out-of-domain leaf or a leaf with '
        + 'no declared domain fails, so re-pinning a doctored scalar no longer passes',
    }],
  },

  22: { claims: [{ id: 'PLINKO-35', coverage: 'full' }] },
  23: { claims: [{ id: 'PLINKO-22', coverage: 'full' }] },
};

/**
 * Checks this casino's design makes inapplicable. The reason is the declaration: a check that
 * simply never appears is a gap, and one that says why it cannot apply is an answer.
 */
export const NOT_APPLICABLE: Array<{ id: string; reason: string }> = [
  {
    id: 'PLINKO-34',
    reason: 'the suite has no mode that narrows what a run attested — no sampled re-execution and '
      + 'no baseline re-emission — so there is no attestation scope to record and refuse',
  },
  {
    id: 'PLINKO-16',
    reason: 'no bet response in the capture carries a balance field, so there is no '
      + 'consecutive-bet delta to reconcile',
  },
];

/**
 * Checks a package artifact answers rather than a scored step. `none` means the artifact does
 * not exist — recorded so the gap is machine-readable instead of merely absent.
 */
export const PACKAGE_CHECKS: Array<{ id: string; artifact: string; coverage: Coverage | 'none'; note: string }> = [
  {
    id: 'PLINKO-37', artifact: 'scripts/build-standalone.mjs + scripts/check-standalone.mjs', coverage: 'full',
    note: 'verify.js and test.js are compiled from the checked-in TypeScript sources and '
      + 'standalone-manifest.json pins the SHA-256 of every input and output; check-standalone '
      + 'runs first in npm test and refuses a bundle built from anything but the committed sources',
  },
  {
    id: 'PLINKO-33', artifact: 'scripts/check-outputs.mjs', coverage: 'full',
    note: 'the declared step set is parsed from tests/steps/*.ts (source, not the artifact under '
      + 'check) and outputs/verification-results.json is required to carry ids 1..23 each exactly '
      + 'once under the name its module declares, with summary.passed/flags/hardFail reconciled '
      + 'against the steps array — so a duplicated, missing, renumbered or renamed step is caught. '
      + 'Runs in npm test before the verifier (the verifier exits 2 on the disclosed Conditional flag)',
  },
  {
    id: 'PLINKO-09',
    artifact: 'tests/plinko/PlinkoTests.ts (Operator source block) + src/rng.ts OPERATOR_SOURCE_CITES + src/operator-verifier.ts + Step 5',
    coverage: 'full',
    note: 'CORRECTED 2026-09-25: the earlier note said the operator\'s algorithm was referenced only as an external '
      + 'repository and a screenshot. Duel publishes it as source on its Verify tab (S10 already showed the whole '
      + 'panel); it is now vendored: evidence/verify-tab/duel-verify-tab-plinko-2026-09-25.js, copied verbatim by '
      + 'Paulo on 2026-09-25 (duel.com → Provably Fair → Verify → Expand → Copy), SHA-256 8b3366d1…, pinned with its '
      + 'runner in src/operator-verifier.ts. The asserts, each met: (1) "unit tests reproduce at least one captured bet '
      + 'from its revealed seed … against the operator\'s published algorithm" — the Operator source block in '
      + 'tests/plinko/PlinkoTests.ts EXECUTES that file unmodified on all 8,100 captured bets: its validatePlinkoResult '
      + 'bucket equals the served final_slot and src/rng.ts on 8,100/8,100, and the L/R path read from its own prefix '
      + 'sums equals src/rng.ts\'s; (2) "fixed vectors" — the same block requires it to return the 7 known-answer '
      + 'slots (one per config sampled); (3) "the adapter cites the operator source line it ports" — src/rng.ts '
      + 'OPERATOR_SOURCE_CITES names 8 lines of the pinned file (L29 hex-decoded key … L60 position += value % 2, L63 '
      + 'return) with the text each must carry, and checkOperatorCites FAILs any that does not: 8/8. Step 5 runs the '
      + 'same execution and citation check in the verifier. FAIL probed: M07g (a logic line of the operator file '
      + 'changed AND its pin recomputed → disagreement), M07h (a byte changed without re-pin → hash mismatch), M07i (a '
      + 'citation moved to a line that does not carry its text). Not established: that the Verify button, or Duel\'s '
      + 'server, runs exactly this code',
  },
  {
    id: 'PLINKO-23', artifact: 'MANIFEST.md#verification-results + scripts/check-exploit-matrix.mjs', coverage: 'full',
    note: 'MANIFEST.md (Verification results) carries the standardized matrix with the framework\'s eight named '
      + 'rows S5-1 … S5-8, each with one verdict (Pass / Not tested — disclosed) tied to a scored '
      + 'step or a disclosed capture limitation; input validation and cross-player isolation are '
      + 'honestly Not tested — disclosed (a single-account capture of valid bets). '
      + 'check-exploit-matrix.mjs parses the marked block and fails npm test unless all eight rows '
      + 'are present once with a valid verdict and a tie. The audit\'s original ten-category '
      + 'taxonomy is preserved as supplementary detail',
  },
  {
    id: 'PLINKO-24',
    artifact: 'verifier-parity/ + src/site-verifier.ts + src/live-site-verifier.ts + Step 5 (docusaurus and live-site legs) + scripts/check-site-verifier.mjs [--live]',
    coverage: 'full',
    note: 'TWO site verifiers are pinned and executed (ported from Duel Mines, 2026-09-24). (1) DOCUSAURUS: the '
      + 'site verifier the profile names — qa-workspace/duel/docusaurus VerifyBets games/plinko/derive.js and '
      + 'the three files it reaches (lib/hmac-sha256.js, games/plinko/paytables.js, games/plinko/scalingEdge.js) '
      + '— is HASH-MATCHED and EXECUTED: the package records all four SHA-256 (src/site-verifier.ts '
      + 'SITE_VERIFIER_PINS: derive.js dd841748…, re-vendored 2026-09-25 from the site\'s origin/main @ bd4d59c; the earlier repotree-sync @ 2ad89bc bytes of derive.js and paytables.js differed only in the source-URL comment) and holds byte-exact copies in verifier-parity/; Step 5 FAILs '
      + 'unless the copies hash to the pins, then runs the site\'s own derivePlinko on all 8,100 captured bets '
      + '(bound to EXPECTED_BETS) and FAILs on any slot or L/R path that differs from src/rng.ts '
      + 'computePathFromBuffer. Measured: 8,100/8,100 slot and path, 0 mismatches. FINDING (L5, verdict-neutral, '
      + 'against the ProvablyFair.org verifier, not the operator): the MULTIPLIER derive.js returns differs from '
      + 'the one Duel served on 224 of 8,100 bets (53 cells, largest gap 1.1e-7) because paytables.js is '
      + 'plinkoConfig.json payout_tables (351/351 cells) while Duel pays scaling_edge[0] (Step 8); the two differ '
      + 'on 118/351 cells by ≤ 1.49e-6. Step 5 requires the divergence to be EXACTLY the declared one '
      + '(DECLARED_SITE_MULTIPLIER_DIVERGENCE). scripts/check-site-verifier.mjs <site derive.js> walks the import '
      + 'graph and compares a site checkout with the pins; run 2026-09-25 against the site\'s '
      + 'origin/main @ bd4d59c (files read with git cat-file): 4/4 MATCH, exit 0. (2) LIVE SITE: '
      + 'https://www.provablyfair.org/verify-bets (Next.js build, source not available to this audit): the three '
      + 'chunks the Duel Plinko derivation needs are the ones pinned by Duel Mines (same bytes, same pins), '
      + 'vendored in verifier-parity/live-site/chunks/ and pinned with the Plinko runner in src/live-site-verifier.ts; '
      + 'Step 5 runs the page\'s OWN code with the call its Verify button makes on the same 8,100 bets and FAILs '
      + 'unless the printed slot (both forms), bucket count, L/R path and serverSeedHash equal the capture and '
      + 'src/rng.ts and the printed multiplier rounds from the served one. Measured: 8,100/8,100, 0 mismatches '
      + '(the live page\'s table is also payout_tables, 351/351 cells, but it prints 2 decimals or fewer, and no '
      + 'captured bet\'s printed value differs). node scripts/check-site-verifier.mjs --live GET 2026-09-24: 3/3 '
      + 'MATCH, exit 0. FAIL probed: M07b (a derive.js logic line changed AND re-pinned), M07c (a byte changed '
      + 'without re-pin), M07d (the live chunk\'s Duel Plinko line changed AND re-pinned), M07e (a chunk byte '
      + 'without re-pin), M07f (the declared divergence count no longer measured). NOT exercised: the site '
      + 'adapter index.js and its bet-size bracket lookup (every call passes bracket 0, the adapter default)',
  },
  {
    id: 'PLINKO-25', artifact: 'MANIFEST.md#verify-a-bet', coverage: 'full',
    note: 'MANIFEST "Verify a bet" carries the ordered player-verification path — the four fields to take from a '
      + 'bet record, where the seed is revealed on rotation, and the two paste-able browser checks '
      + '(commitment hash and slot recomputation), and the payout lookup; README.md points to it',
  },
  {
    id: 'PLINKO-28',
    artifact: 'tests/verify.ts + src/diff.ts + src/diff-simulation.ts + npm test / npm run test:full',
    coverage: 'full',
    note: 'npm test = standalone check → node test.js → check-outputs → check-exploit-matrix → node verify.js '
      + '(zero-install bundle), which prints 23 scored steps with the verdict PROVABLY FAIR — Full Pass and '
      + 'exits 0; it writes only to outputs/run/ (never a pinned artifact) and diffs the committed artifacts field '
      + 'by field at 1e-14 + 1e-12·max (integers and strings exact), recording the Node runtime in '
      + 'outputs/run/diff.json and exiting 1 beyond tolerance. REGENERATION DIFFED (added 2026-09-24): `npm run '
      + 'test:full` re-simulates into outputs/run/ with the generator itself (PF_SIM_OUT), src/diff-simulation.ts '
      + 'compares simulation-results.json field by field and rtp-convergence.html byte for byte '
      + '(outputs/run/diff-simulation.json, runtime recorded), and the following npm test runs with PF_REGEN=1 so '
      + 'the regenerated simulation is also in outputs/run/diff.json. Measured 2026-09-24 on Node 22.23.1: '
      + 'simulation-results.json REPRODUCED (1 field differs, 1.11e-16 at pass2_casino_seeds.'
      + 'test_b_cherry_pick_pvalue, within tolerance), rtp-convergence.html byte-identical. Step count 23 in '
      + 'README.md, MANIFEST.md and the suite; audit ID PF-2026-DL01 in both docs; engines 22.x and .nvmrc. '
      + 'FRESH-CLONE CHECK (emulated, 2026-09-24): the exact file set a commit of this working tree would carry '
      + '(git ls-files + untracked-not-ignored, no node_modules, no outputs/run) copied to a scratch directory; '
      + 'npm ci --offline (local npm cache, no network) exit 0; npm test exit 0 in 3 min 28 s on Node 22.23.1 — '
      + '34/34 unit tests, 23 steps, PROVABLY FAIR — Full Pass, REPRODUCED; the five committed outputs/ '
      + 'artifacts byte-unchanged afterwards. NOT an actual `git clone` of a pushed commit (nothing is '
      + 'committed), and not run on a second machine',
  },
  {
    id: 'PLINKO-29', artifact: 'tests/mutations.json + scripts/mutate.mjs', coverage: 'full',
    note: '53 step-named counterexamples in tests/mutations.json (49 until 14 October 2026, when the four '
      + 'exit-5 entries MC3a, MC3as, MC3b and MC3bs were added) run in a disposable copy under `npm run mutate`; all 23 '
      + 'scored steps have at least one mutation that kills them, forgeries re-pin the SHA-256 they '
      + 'invalidated, and the battery refuses to score itself unless the unmutated copy is green first '
      + '(full Pass-1 replay). Mutations aimed at steps other than 19 run with PF_P1_REPLAY=off (Step 19 '
      + 'capped at FLAG; each kill is decided by its own step marker). Latest runs, recorded in MANIFEST.md: '
      + 'the whole registry of 49 on 14 October 2026, 49/49 killed, 23/23 steps covered; then 10 entries '
      + 'including the four MC3 entries, 10/10 killed; RELEASE-MANIFEST.json records 53/53. Run 2026-09-24: 45/46 killed, 23/23 '
      + 'steps covered; the one miss, M27, was a real regression of this round (the full replay had put '
      + 'the running-RTP points under tolerance) — fixed to exact comparison and M27 re-run: see MANIFEST.md. '
      + 'There are no declared survivors',
  },
  {
    id: 'PLINKO-30', artifact: 'MANIFEST.md#evidence + MANIFEST.md#limitations-and-trust', coverage: 'full',
    note: 'MANIFEST Evidence numbers E01–E19 with their evidential role and now publishes the SHA-256 of '
      + 'every exhibit image (Step 22 allows exactly the hashes matching a real file in evidence/), and '
      + 'MANIFEST.md carries both a Declared Limitations register and a Load-Bearing Premises table',
  },
];

/** The block emitted alongside the step results. */
export function profileCoverageBlock(): Record<string, unknown> {
  return {
    game: PROFILE_GAME,
    profileVersion: PROFILE_VERSION,
    notApplicable: NOT_APPLICABLE,
    packageChecks: PACKAGE_CHECKS,
  };
}

/** The label fields for one scored step, to be merged into its emitted record. */
export function labelFor(step: number): Record<string, unknown> {
  const entry = STEP_CLAIMS[step];
  if (!entry) return { profileIds: [], profileChecks: [], profileNote: 'no mapping declared for this step' };
  return entry.claims.length
    ? { profileIds: entry.claims.map(c => c.id), profileChecks: entry.claims }
    : { profileIds: [], profileChecks: [], profileNote: entry.reason ?? 'no reason given' };
}
