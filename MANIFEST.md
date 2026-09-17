# Manifest — Duel Plinko Audit

- **Audit ID:** PF-2026-DL01
- **Publication date:** 4 June 2026
- **Audit report:** https://audit.provablyfair.org/casino/duel/games/plinko/overview
- **Auditor:** ProvablyFair.org

## Algorithm

HMAC-SHA256 per row. For each row `cursor ∈ [0, rows−1]`:

```
key     = hexDecode(serverSeed)                      // 32 raw bytes
message = clientSeed + ":" + nonce + ":" + cursor    // ASCII string
hmac    = HMAC-SHA256(key, message)
bit     = parseInt(hmac[0..7], 16) % 2               // first 4 bytes → uint32 → mod 2
slot   += bit                                         // right = 1, left = 0
```

Final slot = sum of right-bounces across all rows (0 to `rows`). The multiplier table is loaded from `plinkoConfig.json` (operator-provided). Payout = `bet × multiplier_table[risk][rows][slot]`.

## Dataset

- **File:** `data/plinko-master-8100bets.json`
- **SHA-256:** `3cf9359d88220bc800bb32edfe04399f55b909302262928ee3a0582715635267`
- **Total bets:** 8,100
- **Seed entries:** 166 total · 162 revealed
- **Phases:**
  - A — 5,400 bets · $0.01/bet · all 27 configs (9 rows × 3 risks) — configuration coverage
  - B — 2,000 bets · $0.01/bet · 16 rows / high risk — high-variance sampling
  - C —   200 bets · $10.00/bet · 16 rows / high risk — bet-size invariance
  - D —   500 bets · $0.01/bet · 10 epochs cycling through all 27 configs — client seed verification
- **Total wagered:** $2,079.00

## Multiplier config

- **File:** `plinkoConfig.json`
- **SHA-256:** `78f0a39201a8c24fd1577143732e004f77e27d4d36efeedc6b3f7b93b2078fed`
- The audited multiplier table (operator-supplied). Pinned and verified at verifier startup; the analytic 99.9% RTP proof is conditional on this exact file.

## Verification

- **Verification steps:** 21 scored steps in `tests/verify.ts`
- **Unit tests:** Mocha (`tests/**/*Tests.ts`)
- **Simulation:** 27,000,000 rounds across 27 configs (two-pass: fresh seeds + casino seeds)
- **Expected `npm test` result:** all green, 0 failures

## Reproducibility

Cloning this repo at the publication commit and running `npm install && npm test` reproduces the entire audit pipeline. The dataset hash is verified at startup; the verifier recomputes every bet's slot from `(serverSeed, clientSeed, nonce)`; the simulation re-derives the theoretical RTP from independent binomial probabilities.
