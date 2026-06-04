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
  details?: Record<string, unknown>
): StepResult {
  return { step, name, ecRefs, severity, pass: false, summary, failures, details };
}
