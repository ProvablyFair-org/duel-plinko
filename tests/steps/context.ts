import type { Bet, SeedEntry, Dataset, StepResult } from '../../src/types';
import { PlinkoConfig } from '../../src/config';

export interface DeterminismEntry {
  id: number;
  phase: string;
  rows: number;
  risk: string;
  nonce: number;
  computed_slot: number;
  actual_slot: number;
  match: boolean;
}

export interface ChiEntry {
  config: string;
  n: number;
  chi2: number;
  df: number;
  pValue: number;
  pass: boolean;
  observed: number[];
  expected: number[];
}

export interface VerifyContext {
  bets: Bet[];
  seeds: SeedEntry[];
  cfg: PlinkoConfig;
  byHash: Map<string, Bet[]>;
  revealedMap: Map<string, SeedEntry>;
  phaseA: Bet[];
  phaseB: Bet[];
  phaseC: Bet[];
  phaseD: Bet[];
  expectedHash: string;
  outputsDir: string;
  dataset: Dataset;
  determinismLog: DeterminismEntry[];
  chiSquaredLog: ChiEntry[];
}

export interface InfoItem {
  label:  string;
  detail: string;
}

export function pass(
  step: number,
  name: string,
  ecRefs: string[],
  summary: string,
  details?: Record<string, unknown>
): StepResult {
  return { step, name, ecRefs, severity: 'PASS', pass: true, summary, failures: [], details };
}

export function info(
  step: number,
  name: string,
  ecRefs: string[],
  summary: string,
  details?: Record<string, unknown>
): StepResult {
  return { step, name, ecRefs, severity: 'INFO', pass: true, summary, failures: [], details };
}

export function fail(
  step: number,
  name: string,
  ecRefs: string[],
  severity: StepResult['severity'],
  summary: string,
  failures: string[],
  details?: Record<string, unknown>,
  origin?: 'capture' | 'operator'
): StepResult {
  return { step, name, ecRefs, severity, pass: false, summary, failures, details, origin };
}

/**
 * The console tag for a scored step. Until 2026-09-28 every step printed `[PASS]` or `[FAIL]`, so
 * the capture-origin FLAG on Step 4 (a reconstructed nonce, verdict-neutral) printed as
 * `[FAIL] Step 4` on a Full Pass run (Mike's review, finding F14). A FLAG now prints as a FLAG and
 * says whose it is: `capture` is the auditor's own capture limitation and never affects the
 * verdict; `operator` is verdict-affecting (Conditional Pass). HARD_FAIL still prints `[FAIL]`.
 * Console only — the emitted artifact carries severity and origin as before.
 */
export function tag(r: StepResult): string {
  if (r.pass) return 'PASS';
  // INFO: an informational step's deviation (profile policy INFORMATIONAL — the live-sample fit,
  // Mike 2026-09-29): reported, never counted as a flag, never affects the verdict.
  if (r.severity === 'INFO') return 'INFO';
  if (r.severity === 'FLAG') return r.origin === 'capture' ? 'FLAG:capture' : 'FLAG:operator';
  return 'FAIL';
}
