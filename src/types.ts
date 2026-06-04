// ── Dataset Types ─────────────────────────────────────────────────────────────

export interface BetRequest {
  amount: string;
  rows: number;
  risk: string;
  risk_level: number;
}

export interface BetResponse {
  id: number;
  final_slot: number;
  payout_multiplier: string;
  amount_currency: string;
  win_amount: string;
  effective_edge: number;
  rows: number;
  risk_level: string;
  nonce: number;
  server_seed_hashed: string;
  client_seed: string;
  transaction_id: number;
  created_at: string;
}

export interface Bet {
  at: string;
  phase: 'A' | 'B' | 'C' | 'D';
  request: BetRequest;
  response: BetResponse;
}

export interface NextSeedPromotion {
  previousNextHash: string;
  newActiveHash: string;
  newNextHash: string;
  match: boolean;
}

export interface SeedEntry {
  at: string;
  context: string;
  phase: 'A' | 'B' | 'C' | 'D';
  seed: {
    clientSeed: string;
    serverSeedHashed: string;
    nextServerSeedHash: string;
    serverSeed: string | null;
  };
  nonce: number;
  nextSeedPromotion?: NextSeedPromotion;
  revealedFrom?: { transactionId: number };
}

export interface DatasetMeta {
  schema: string;
  createdAt: string;
  completedAt: string;
}

export interface Dataset {
  meta: DatasetMeta;
  bets: Bet[];
  seeds: SeedEntry[];
}

// ── Config Types ──────────────────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ScalingEdgeBracket {
  id: number;
  config_id: number;
  min_bet: string;
  max_bet: string;
  house_edge: string;
  probabilities: number[];
  multipliers: string[];
}

export interface PlinkoConfigData {
  rows: { min: number; max: number };
  risk_levels: Record<RiskLevel, { id: number; name: string; description: string }>;
  payout_tables: Record<string, Record<RiskLevel, string[]>>;
  probabilities: Record<string, Record<RiskLevel, number[]>>;
  scaling_edge: Record<string, Record<RiskLevel, ScalingEdgeBracket[]>>;
}

export interface PlinkoConfigFile {
  success: boolean;
  data: PlinkoConfigData;
}

// ── Verification Result Types ─────────────────────────────────────────────────

export type Severity = 'HARD_FAIL' | 'FLAG' | 'INFO' | 'PASS';

export interface StepResult {
  step: number;
  name: string;
  ecRefs: string[];
  severity: Severity;
  pass: boolean;
  summary: string;
  failures: string[];
  details?: Record<string, unknown>;
}

export interface InfoItem {
  label: string;
  detail: string;
}
