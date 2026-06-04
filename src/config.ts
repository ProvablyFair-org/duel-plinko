import type { PlinkoConfigData, RiskLevel, ScalingEdgeBracket } from './types';

export class PlinkoConfig {
  private cfg: PlinkoConfigData;

  constructor(data: PlinkoConfigData) {
    this.cfg = data;
  }

  /** Multiplier from payout_tables for (rows, risk, slot). Returns as number. */
  payoutTableMultiplier(rows: number, risk: RiskLevel, slot: number): number {
    return parseFloat(this.cfg.payout_tables[String(rows)][risk][slot]);
  }

  /** Multiplier from scaling_edge bracket 0 for (rows, risk, slot). Returns as number. */
  scalingEdgeMultiplier(rows: number, risk: RiskLevel, slot: number): number {
    return parseFloat(this.cfg.scaling_edge[String(rows)][risk][0].multipliers[slot]);
  }

  /** Slot probabilities for (rows, risk). */
  probabilities(rows: number, risk: RiskLevel): number[] {
    return this.cfg.probabilities[String(rows)][risk];
  }

  /** Scaling edge bracket 0 for (rows, risk). */
  bracket0(rows: number, risk: RiskLevel): ScalingEdgeBracket {
    return this.cfg.scaling_edge[String(rows)][risk][0];
  }

  /** All (rows, risk) config pairs. */
  allConfigs(): Array<{ rows: number; risk: RiskLevel }> {
    const risks: RiskLevel[] = ['low', 'medium', 'high'];
    const rowMin = this.cfg.rows.min;
    const rowMax = this.cfg.rows.max;
    const rowList: number[] = [];
    for (let r = rowMin; r <= rowMax; r++) rowList.push(r);
    return rowList.flatMap(r => risks.map(risk => ({ rows: r, risk })));
  }

  /** Number of slots for rows. */
  slotCount(rows: number): number {
    return rows + 1;
  }

  /** Theoretical RTP from independent binomial P(k) = C(rows,k) × 0.5^rows × scalingEdge bracket-0 multipliers.
   *  Does NOT use cfg.probabilities() — independent of casino-supplied data. */
  theoreticalRTP(rows: number, risk: RiskLevel): number {
    let rtp = 0;
    for (let k = 0; k <= rows; k++) {
      let coeff = 1;
      for (let i = 0; i < Math.min(k, rows - k); i++) {
        coeff = coeff * (rows - i) / (i + 1);
      }
      const p = coeff * Math.pow(0.5, rows);
      rtp += p * this.scalingEdgeMultiplier(rows, risk, k);
    }
    return rtp;
  }
}
