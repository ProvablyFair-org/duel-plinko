/**
 * RTP-CLAIM wiring — Duel Plinko: the per-setting exact RTP table and the claim it is held to.
 *
 * The rule is src/rtp-claim.ts, a byte-identical copy of the framework's core/rtp-claim.ts (its
 * SHA-256 is compared by conformance C-13), version 1.2.0 (Methodology v1.1, agreed 2026-10-14;
 * 1.0.0 agreed on Slack 2026-09-29). The enforcement switch RTP_CLAIM_RULE_ENFORCED is the
 * package's own src/rtp-claim-switch.ts, set to true (decision D3): the outcome is scored on the
 * step carrying PLINKO-19, and a house-side miss makes the verdict RTP FIGURE OVERSTATED (exit 5),
 * never NOT PROVABLY FAIR. The claim names one of the rule's six places: the game settings.
 *
 * SETTINGS. Every (rows, risk) configuration: rows 8–16 × low / medium / high = 27, priced by the
 * scaling_edge bracket 0 table (house_edge 0.001, stakes up to its max_bet) — the bracket the audit
 * scores (src/config.ts scalingEdgeMultiplier). Higher stake brackets (191 per configuration, edge
 * up to 0.02) are outside this setting space and are disclosed, not scored here.
 * EXACT RTP. Σ_k C(rows, k)/2^rows × multiplier[k], the multiplier the exact decimal string of the
 * pinned plinkoConfig.json (1e-8 lattice). Binomial law as Step 17 anchors it.
 * CLAIM. Flat 0.1 % house edge = RTP 999/1000, a stated edge in the game settings (decision D2):
 * scaling_edge bracket 0 house_edge "0.001" in Duel's plinko config (plinkoConfig.json, pinned
 * src/loader.ts:10; E11 as fetched 2026-10-05; declaration paytable.claimedHouseEdge).
 *
 *   npm run rtp-claim:write    rewrite outputs/rtp-claim-table.json and print its SHA-256 to pin
 */
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { RtpClaim, RtpClaimAccumulator, RtpClaimResult, rtpClaimTable, rtpClaimGate, RtpClaimGate, parseRational } from './rtp-claim';

export const RTP_CLAIM: RtpClaim = {
  kind: 'flat',
  rtp: '0.999',
  source: 'game settings: house_edge "0.001" on scaling_edge bracket 0 of Duel\'s plinko config (plinkoConfig.json; E11 as fetched 2026-10-05; declaration paytable.claimedHouseEdge 0.001)',
};

/** The scored step that carries PLINKO-19 (src/profile-map.ts). */
export const RTP_CLAIM_STEP = 19;

export const RTP_CLAIM_TABLE = path.join(__dirname, '..', 'outputs', 'rtp-claim-table.json');
/** SHA-256 of the committed table — re-pin with the run that rewrote it (npm run rtp-claim:write). */
export const RTP_CLAIM_TABLE_SHA256 = 'eca16ed27d4cb5bf9c457b48b98fe8a73d71278eeac3a7cbb66250aca08b47cf';

const binom = (n: number, k: number): bigint => {
  let r = 1n;
  for (let i = 0; i < k; i++) r = (r * BigInt(n - i)) / BigInt(i + 1);
  return r;
};

export function computeRtpClaim(): RtpClaimResult {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plinkoConfig.json'), 'utf-8')).data;
  const acc = new RtpClaimAccumulator(RTP_CLAIM);
  for (let rows = cfg.rows.min; rows <= cfg.rows.max; rows++) {
    for (const risk of ['low', 'medium', 'high']) {
      const b0 = cfg.scaling_edge[String(rows)][risk][0];
      if (b0.house_edge !== '0.001') throw new Error(`bracket 0 of ${rows}/${risk} is not the 0.001 bracket`);
      const mults: string[] = b0.multipliers;
      if (mults.length !== rows + 1) throw new Error(`${rows}/${risk}: ${mults.length} multipliers for ${rows + 1} slots`);
      // Σ_k C(rows,k)·m_k / 2^rows, exact over the common denominator 10^8·2^rows.
      let num = 0n, den = 1n;
      mults.forEach((m, k) => {
        const r = parseRational(m);
        num = num * r.d + binom(rows, k) * r.n * den;
        den = den * r.d;
      });
      acc.add(`rows=${rows} risk=${risk}`, num, den * (1n << BigInt(rows)));
    }
  }
  return acc.result();
}

export function rtpClaimTableText(r: RtpClaimResult): string {
  return rtpClaimTable(r, {
    package: 'duel/plinko', game: 'plinko',
    settingSpace: 'rows 8–16 × risk low / medium / high (27 configurations) at scaling_edge bracket 0',
    rtpMethod: 'exact rational: Σ_k C(rows,k)/2^rows × the bracket-0 multiplier string (1e-8 lattice)',
  });
}

export function runRtpClaimGate(): RtpClaimGate {
  const r = computeRtpClaim();
  return rtpClaimGate(r, rtpClaimTableText(r), RTP_CLAIM_TABLE, RTP_CLAIM_TABLE_SHA256);
}

if (require.main === module) {
  const text = rtpClaimTableText(computeRtpClaim());
  fs.writeFileSync(RTP_CLAIM_TABLE, text);
  console.log(`wrote outputs/rtp-claim-table.json sha256 ${createHash('sha256').update(text).digest('hex')}`);
}
