# Duel Plinko — Provably Fair Audit

**Auditor:** [ProvablyFair.org](https://www.provablyfair.org) · **Audit ID:** PF-2026-DL01 · **Release:** `v1.4.2` · **Capture:** 10 April 2026

**Result: PROVABLY FAIR — Full Pass.** All 8,100 captured bets reproduce from `(serverSeed, clientSeed, nonce)`: 8,100/8,100 slots, 0 mismatches. The verifier reports 23 scored steps: 22 PASS and one capture-origin flag on Step 4, with 0 hard fails and 0 verdict-affecting flags. The flag covers two capture retries whose missed nonces were reconstructed from revealed, commitment-matching server seeds; it is verdict-neutral and does not identify an operator defect.

**Scope:** The audited multiplier table is the operator-supplied `plinkoConfig.json`, pinned by SHA-256. Every captured bet ($0.01 and $10) sits in bracket 0 of its `scaling_edge` ladder, where the house edge is 0.1%: theoretical RTP is 99.900% across all 27 configurations (rows 8–16 × low, medium, high risk), proven analytically on that table. The same config scales the house edge up to 2.0% at higher stakes; the RTP figures apply to bracket 0 only, and bracket-boundary behaviour was not tested. Theoretical RTP is not a promise about an individual session's return.

## What was verified

| Check | Captured evidence |
|---|---|
| Slots | 8,100 of 8,100 recomputed with HMAC-SHA256 by code rebuilt from a written spec ([docs/ALGORITHM.md](docs/ALGORITHM.md)) by an implementer who never opened Duel's code; Duel's own Verify-tab code, run as a second check and not used as the source, agrees on bucket and L/R path on 8,100/8,100 |
| Seed records | 166 entries, 162 revealed seeds hash to their commitments; 166/166 next-seed promotions recomputed |
| Nonces | 162 epochs of 50, sequential; 2 capture-retry epochs reconstructed from revealed seeds (capture-origin FLAG, L2) |
| Payouts | 8,100/8,100 multipliers match `scaling_edge[0].multipliers`; `win_amount = amount_currency × payout_multiplier` on every bet |
| Theoretical RTP | 99.900% on all 27 configurations, from independently derived binomial probabilities |
| Cell coverage | 263 of 351 multiplier cells paid at least once; the other 88 rest on the pinned table |
| Simulation | Pass 1: 27,000,000 rounds from pinned seeds, replayed on every run; Pass 2: 162 revealed seeds × 10,000 nonces, Tests A, B and C |
| Player verifiers | Docs-site and live ProvablyFair.org verifiers pinned and executed on all 8,100 bets |
| Observed return | Phase A 99.303%, Phase B 92.313%, Phase C 74.993%; informational, not RTP evidence |

A matching hash shows consistency with a commitment; it is not independent timestamp attestation. That each commitment was shown before its epoch's bets rests on the capture's own records (each epoch's commitment recorded from the rotation response before its first bet), which the package assumes are faithful ([P1](MANIFEST.md#load-bearing-premises)). Coverage limits, the docs-site verifier finding (L5) and residual operator trust are in the [overview's limitations](MANIFEST.md#limitations-and-trust).

## Run the audit

Open a terminal in this package's directory. Use **Node 22.x**, as declared in [.nvmrc](.nvmrc) and [package.json](package.json).

```sh
npm ci
npm test
```

Expected: **44 unit tests pass; 22 PASS + 1 capture-origin FLAG (Step 4); zero hard failures; PROVABLY FAIR — Full Pass; REPRODUCED; exit 0.** `npm test` runs the standalone-build check, the unit tests, the step-registry and S5-matrix checks and the 23-step verifier. Step 19 replays all 27,000,000 Pass 1 rounds on worker threads: allow **20 minutes on 2 cores** and **6 minutes on 12**. Ordinary runs write only to `outputs/run/`; the committed artifacts are scored, never rewritten. The exit code is the verdict: `0` PROVABLY FAIR — Full Pass · `2` PROVABLY FAIR — Conditional Pass · `5` RTP FIGURE OVERSTATED (the RTP-CLAIM rule 1.2.0 found a published RTP figure above the game's real RTP; the draws pass) · `1` NOT PROVABLY FAIR, or a reproduction difference.

**RTP claim (RTP-CLAIM 1.2.0, switched on).** All 27 configurations (rows 8–16 × low / medium / high) are held to the 99.9% of house_edge "0.001" on scaling-edge bracket 0 in Duel's game settings (plinkoConfig.json). Scored on Step 19: PASS, 0 of 27 beyond the 0.1 pp band ([table](outputs/rtp-claim-table.json)); higher brackets are not tabled.

```sh
npm run test:full                 # optional: regenerates the simulation into outputs/run/, diffs it, then npm test
node scripts/release-manifest.mjs --check
```

See [reproduction details](MANIFEST.md#reproduce-the-audit) for the time budget, the tolerance gate, exit codes, the mutation battery and the deliberate artifact-refresh procedure.

## Verify a bet

Before you bet, save the commitment: copy the active server seed hash (`serverSeedHashed`) shown in Duel's Provably Fair panel and keep it. The server seed is revealed when you rotate your server seed. Then take `serverSeed`, `clientSeed` and `nonce` from the bet record and check that `SHA-256(hexDecode(serverSeed))` equals the commitment you saved. A PASS means the two hashes are equal: the revealed seed is consistent with that commitment. It does not show when the commitment was made; the assurance that the seed was fixed before your bet comes from your record saved before betting. A hash read from the bet record after the bet shows consistency only. Next, recompute the slot: for each row `cursor` from 0, `HMAC-SHA256(hexDecode(serverSeed), clientSeed:nonce:cursor)`, and an odd first-4-bytes value moves the ball right. Both checks, paste-able into a browser console, are in [Verify a bet](MANIFEST.md#verify-a-bet). The bundled table prices bracket-0 stakes; the config assigns a larger stake to a higher bracket, and which bracket the server applies above bracket 0 was not tested.

## Files and evidence

There are two documentation files: this README and [MANIFEST.md — consolidated audit overview](MANIFEST.md). The overview contains the game rules, algorithm, RTP calculation, verification results, evidence, limitations and release history.

- [Captured bets](data/plinko-master-8100bets.json) — SHA-256 `3cf9359d88220bc800bb32edfe04399f55b909302262928ee3a0582715635267`.
- [Multiplier config](plinkoConfig.json) — SHA-256 `78f0a39201a8c24fd1577143732e004f77e27d4d36efeedc6b3f7b93b2078fed`.
- [Verification results](outputs/verification-results.json), [RTP claim table](outputs/rtp-claim-table.json) and [release manifest](RELEASE-MANIFEST.json).
- [Audit report](https://audit.provablyfair.org/casino/duel/games/plinko/overview) · [Public repository](https://github.com/ProvablyFair-org/duel-plinko) · [MIT license](LICENSE).

The verifier confirms both input hashes before running any check; tampering with either file makes `npm test` fail at startup. Every release from v1.0.0 is recorded in the [release history](MANIFEST.md#release-history).
