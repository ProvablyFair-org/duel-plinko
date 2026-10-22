/**
 * Duel Plinko — VALUE DOMAINS for every numeric leaf of the pinned JSON artifacts of record
 * (`outputs/simulation-results.json`, `outputs/chi-squared-results.json`,
 * `outputs/determinism-log.json`).
 *
 * WHY THIS MODULE EXISTS. Step 21 re-hashes each pinned artifact, which proves the committed
 * bytes are the ones on disk — it does not prove the numbers inside them are physically
 * possible. A forger who re-pins the file after doctoring a scalar walks straight through the
 * hash: set a count to -1, an RTP to a billion, or a p-value to 2, re-run the manifest, and
 * every hash and reconciliation check still agrees, because they check internal consistency,
 * not physical possibility. This module adds the missing half — every numeric leaf must lie in
 * the domain it PHYSICALLY admits — and Step 21 fails HARD when one does not.
 *
 *   EVERY BOUND IS DERIVED FROM src/ (sim-seeds.ts, loader.ts) OR THE HASH-PINNED
 *   plinkoConfig.json, NEVER FROM THE ARTIFACT BEING CHECKED. A bound the artifact supplies is
 *   a bound a forger sets.
 *
 * Reject only the IMPOSSIBLE, never the surprising. The mirror defect costs as much:
 * a genuine million-round result rejected for landing on expectation, or an honest running-mean
 * RTP above 100% rejected for exceeding 1. So these domains encode PHYSICAL POSSIBILITY, not
 * plausibility, and nothing here rejects a value for being round, extreme, or equal to its own
 * expectation. The traps in this artifact set — every one an honest committed value:
 *
 *   simulatedRTP = 1.00735…            an RTP legitimately ABOVE 1 — bounded by the PAYTABLE
 *   rtpSnapshots[].rtp = 120.51        a short-window running mean, as a PERCENT, well above 100
 *   rtpDiff = -0.00439…                a signed difference, legitimately negative
 *   lag1R = -0.00188…                  a correlation in [-1, 1], often negative
 *   lag1Z = -1.88…                     a z-score — a signed, unbounded real
 *
 * `tests/plinko/domainTests.ts` asserts BOTH directions against the committed artifacts: every
 * numeric leaf satisfies its domain, AND every numeric leaf PATH is covered by an explicit rule.
 * There is no silent fallback — adding a numeric field to an artifact without declaring what it
 * physically admits fails the unit suite.
 */

import fs from 'fs';
import path from 'path';
import type { PlinkoConfigFile } from './types';
import { ROUNDS_PER_CONFIG } from './sim-seeds';
import { EXPECTED_BETS, EXPECTED_SEEDS, EXPECTED_EPOCHS, EXPECTED_EPOCH_SIZE } from './loader';

export interface Domain {
  readonly label: string;
  readonly ok: (v: number) => boolean;
}
const D = (label: string, ok: (v: number) => boolean): Domain => ({ label, ok });

export const FINITE = D('a finite number', v => Number.isFinite(v));
export const NONNEG_REAL = D('a non-negative real', v => Number.isFinite(v) && v >= 0);
export const NONNEG_INT = D('a non-negative integer', v => Number.isInteger(v) && v >= 0);
export const PROBABILITY = D('a probability in [0,1]', v => Number.isFinite(v) && v >= 0 && v <= 1);
export const CORRELATION = D('a correlation in [-1,1]', v => Number.isFinite(v) && v >= -1 && v <= 1);
export const CHI_SQUARED = D('a non-negative chi-squared statistic', v => Number.isFinite(v) && v >= 0);

const intAtMost = (max: number, what: string): Domain =>
  D(`an integer in [0, ${max}] (${what})`, v => Number.isInteger(v) && v >= 0 && v <= max);
const intBetween = (lo: number, hi: number, what: string): Domain =>
  D(`an integer in [${lo}, ${hi}] (${what})`, v => Number.isInteger(v) && v >= lo && v <= hi);
const realBetween = (lo: number, hi: number, what: string): Domain =>
  D(`a real in [${lo}, ${hi}] (${what})`, v => Number.isFinite(v) && v >= lo && v <= hi);

const CONFIG_PATH = path.join(__dirname, '..', 'plinkoConfig.json');

/** Largest multiplier the hash-pinned paytable admits (payout_tables and every scaling_edge
 *  bracket) — the physical ceiling on any single payout, hence on any payout average. Read from
 *  plinkoConfig.json, never from the artifact. */
function maxMultiplier(): number {
  const cfg = (JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as PlinkoConfigFile).data;
  let mx = 0;
  for (const byRisk of Object.values(cfg.payout_tables))
    for (const arr of Object.values(byRisk))
      for (const m of arr) { const x = parseFloat(m); if (x > mx) mx = x; }
  for (const byRisk of Object.values(cfg.scaling_edge))
    for (const brackets of Object.values(byRisk))
      for (const b of brackets)
        for (const m of b.multipliers) { const x = parseFloat(m); if (x > mx) mx = x; }
  return mx;
}

/** Number of standard configurations (rows 8..16 × 3 risks) the pinned table declares. */
function standardConfigCount(): number {
  const cfg = (JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as PlinkoConfigFile).data;
  let n = 0;
  for (const byRisk of Object.values(cfg.payout_tables)) n += Object.keys(byRisk).length;
  return n;
}

export interface Rule {
  readonly path: RegExp;
  readonly domain: Domain;
}
export interface DomainViolation {
  readonly path: string;
  readonly value: number;
  readonly expected: string;
}

export function collapsePath(p: string): string {
  return p.replace(/\[\d+\]/g, '[]');
}

export function numericLeaves(doc: unknown, p = '', out: [string, number][] = []): [string, number][] {
  if (typeof doc === 'number') { out.push([collapsePath(p), doc]); return out; }
  if (doc === null || typeof doc !== 'object') return out;
  if (Array.isArray(doc)) {
    doc.forEach((v, i) => numericLeaves(v, `${p}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) numericLeaves(v, `${p}.${k}`, out);
  return out;
}

export function validateDomains(doc: unknown, rules: Rule[]): { violations: DomainViolation[]; uncovered: string[]; checked: number } {
  const violations: DomainViolation[] = [];
  const uncovered: string[] = [];
  const leaves = numericLeaves(doc);
  for (const [p, v] of leaves) {
    const rule = rules.find(r => r.path.test(p));
    if (!rule) { if (!uncovered.includes(p)) uncovered.push(p); continue; }
    if (!rule.domain.ok(v)) violations.push({ path: p, value: v, expected: rule.domain.label });
  }
  return { violations, uncovered, checked: leaves.length };
}

export function describeDomainFailures(artifact: string, r: { violations: DomainViolation[]; uncovered: string[] }): string[] {
  const out: string[] = [];
  for (const v of r.violations.slice(0, 4)) out.push(`${artifact}${v.path} = ${v.value} is not ${v.expected}`);
  if (r.violations.length > 4) out.push(`${artifact}: +${r.violations.length - 4} more impossible value(s)`);
  for (const p of r.uncovered.slice(0, 4)) out.push(`${artifact}${p} has no declared value domain (add one in src/domains.ts)`);
  if (r.uncovered.length > 4) out.push(`${artifact}: +${r.uncovered.length - 4} more undeclared field(s)`);
  return out;
}

/**
 * Every numeric leaf of every pinned JSON artifact, with the domain it physically admits.
 * Ordering matters: the FIRST matching rule wins, so narrower patterns come first.
 */
export function domainRules(): Record<string, Rule[]> {
  const mMax = maxMultiplier();
  const configs = standardConfigCount();
  const RTP_FRAC = realBetween(0, mMax, 'attainable payout average as a fraction of the pinned paytable');
  const RTP_PCT = realBetween(0, mMax * 100, 'attainable payout average as a percent of the pinned paytable');
  const ROWS = intBetween(8, 16, 'declared board sizes');
  const SLOT = intBetween(0, 16, 'slot index on a board of at most 16 rows');
  const CFG_COUNT = intAtMost(configs, 'standard configurations the pinned table declares');
  const ROUND_COUNT = intAtMost(ROUNDS_PER_CONFIG, 'rounds within one pinned Pass-1 configuration');
  const TOTAL_ROUNDS = intAtMost(ROUNDS_PER_CONFIG * configs, 'rounds across the whole Pass-1 experiment');
  const SEEDROW = intAtMost(EXPECTED_SEEDS * configs, 'seed × board combinations in the audited population');
  const SEED_COUNT = intAtMost(EXPECTED_EPOCHS, 'revealed epochs the capture plan covers');
  const BET_COUNT = intAtMost(EXPECTED_BETS, 'audited bet population');
  const NONCE = intAtMost(EXPECTED_EPOCH_SIZE, 'nonce within the epoch the seed rotation serves');

  return {
    'simulation-results.json': [
      // ── Pass 1 (fresh pinned seeds) ───────────────────────────────────────────
      { path: /^\.pass1_fresh_seeds\.(avgSimulatedRTP|avgTheoreticalRTP)$/, domain: RTP_FRAC },
      { path: /^\.pass1_fresh_seeds\.(chi2FailsAtAlpha01|chi2FailsBonferroni|configs|serialIndependenceFails)$/, domain: CFG_COUNT },
      { path: /^\.pass1_fresh_seeds\.roundsPerConfig$/, domain: ROUND_COUNT },
      { path: /^\.pass1_fresh_seeds\.totalRounds$/, domain: TOTAL_ROUNDS },
      { path: /^\.pass1_fresh_seeds\.convergence\[\]\.meanRTP$/, domain: RTP_PCT },
      { path: /^\.pass1_fresh_seeds\.convergence\[\]\.roundCount$/, domain: ROUND_COUNT },
      { path: /^\.pass1_fresh_seeds\.convergence\[\]\.stdDev$/, domain: NONNEG_REAL },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.chi2$/, domain: CHI_SQUARED },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.df$/, domain: NONNEG_INT },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.expectedCounts\[\]$/, domain: realBetween(0, ROUNDS_PER_CONFIG, 'expected count within one Pass-1 configuration') },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.lag1R$/, domain: CORRELATION },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.lag1Z$/, domain: FINITE },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.(pValue|runsP)$/, domain: PROBABILITY },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.rounds$/, domain: ROUND_COUNT },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.rows$/, domain: ROWS },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.rtpDiff$/, domain: FINITE },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.rtpSnapshots\[\]\.roundCount$/, domain: ROUND_COUNT },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.rtpSnapshots\[\]\.rtp$/, domain: RTP_PCT },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.(simulatedRTP|theoreticalRTP)$/, domain: RTP_FRAC },
      { path: /^\.pass1_fresh_seeds\.results\[\]\.slotCounts\[\]$/, domain: ROUND_COUNT },

      // ── Pass 2 (revealed casino seeds) ────────────────────────────────────────
      { path: /^\.pass2_casino_seeds\.epoch_length$/, domain: NONCE },
      { path: /^\.pass2_casino_seeds\.nonces_per_seed$/, domain: NONNEG_INT },
      { path: /^\.pass2_casino_seeds\.results\[\]\.(early_chi2|full_range_chi2|late_chi2)$/, domain: CHI_SQUARED },
      { path: /^\.pass2_casino_seeds\.results\[\]\.(early_df|full_range_df|late_df)$/, domain: NONNEG_INT },
      { path: /^\.pass2_casino_seeds\.results\[\]\.(early_p|full_range_p|late_p)$/, domain: PROBABILITY },
      { path: /^\.pass2_casino_seeds\.results\[\]\.rows$/, domain: ROWS },
      { path: /^\.pass2_casino_seeds\.seed_row_combinations$/, domain: SEEDROW },
      { path: /^\.pass2_casino_seeds\.seeds_tested$/, domain: SEED_COUNT },
      { path: /^\.pass2_casino_seeds\.(test_a_binomial_pvalue|test_b_cherry_pick_pvalue)$/, domain: PROBABILITY },
      { path: /^\.pass2_casino_seeds\.(test_a_chi2_fails_at_alpha01|test_b_cherry_pick_flags)$/, domain: SEEDROW },
    ],

    'chi-squared-results.json': [
      { path: /^\.alpha$/, domain: PROBABILITY },
      { path: /^\.(configsPassed|configsTested)$/, domain: CFG_COUNT },
      { path: /^\.results\[\]\.chi2$/, domain: CHI_SQUARED },
      { path: /^\.results\[\]\.df$/, domain: NONNEG_INT },
      { path: /^\.results\[\]\.expected\[\]$/, domain: NONNEG_REAL },
      { path: /^\.results\[\]\.n$/, domain: NONNEG_INT },
      { path: /^\.results\[\]\.observed\[\]$/, domain: NONNEG_INT },
      { path: /^\.results\[\]\.pValue$/, domain: PROBABILITY },
    ],

    'determinism-log.json': [
      { path: /^\.log\[\]\.(actual_slot|computed_slot)$/, domain: SLOT },
      { path: /^\.log\[\]\.id$/, domain: NONNEG_INT },
      { path: /^\.log\[\]\.nonce$/, domain: NONCE },
      { path: /^\.log\[\]\.rows$/, domain: ROWS },
      { path: /^\.(verified|mismatches|skipped|totalBets)$/, domain: BET_COUNT },
    ],
  };
}
