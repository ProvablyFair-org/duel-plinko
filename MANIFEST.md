# Duel Plinko — Consolidated Audit Overview

**Audit ID:** PF-2026-DL01 · **Auditor:** ProvablyFair.org · **Release:** `v1.4.1` · **Framework:** 1.1

Audited April 2026. Dataset of record captured on **10 April 2026**, from `2026-04-10T16:48:39.110Z` to `2026-04-10T19:22:55.922Z` on production `duel.com`. Publication date: 4 June 2026. Audit report: https://audit.provablyfair.org/casino/duel/games/plinko/overview. This overview consolidates the package documentation; the machine-readable release identity remains in [RELEASE-MANIFEST.json](RELEASE-MANIFEST.json).

## Conclusion and scope

**PROVABLY FAIR — Full Pass.** The Duel.com Plinko implementation clears 23 scored verification steps (covering EC-1 through EC-35): 22 PASS, and one capture-origin flag on the nonce audit (Step 4): two capture-side retries reconstructed from the revealed server seeds, disclosed as limitation L2 and verdict-neutral. Zero hard fails, zero verdict-affecting flags. All six hard-fail criteria passed.

Every one of the 8,100 captured bets reproduces from `(serverSeed, clientSeed, nonce)` with HMAC-SHA256: 0 slot mismatches. The RNG uses no hidden input; drand is not part of the Plinko RNG. The client seed is a genuine HMAC input, and bet amount is not an input to the RNG.

The platform pays from multiplier tables in the operator-supplied `plinkoConfig.json`. At the test amounts ($0.01 and $10) every bet falls in bracket 0 of the progressive `scaling_edge` structure, where the house edge is 0.1%. The theoretical RTP across all 27 configurations is 99.900%, proven analytically: independently derived binomial probabilities × the committed table (Step 17). The proof is conditional on this exact, pinned file. Live play verifies the 263 of 351 multiplier cells it reached; the other 88 rest on the pinned table.

**Informational finding — progressive house edge (not manipulation).** `plinkoConfig.json` defines 191 bet-size brackets per configuration. House edge scales from 0.001 (0.1%) at low stakes to 0.02 (2%) at high stakes. All test bets fell within bracket 0. The RNG itself is not affected. Above the stake where the maximum profit reaches $1.5m, the edge keeps rising while the maximum profit does not (see Progressive house edge). Reported for transparency.

## Contents

- [Dataset and capture](#dataset-and-capture)
- [Game and algorithm](#game-and-algorithm)
- [Payouts and RTP](#payouts-and-rtp)
- [Verification results](#verification-results)
- [Reproduce the audit](#reproduce-the-audit)
- [Verify a bet](#verify-a-bet)
- [Evidence](#evidence)
- [Limitations and trust](#limitations-and-trust)
- [Terms](#terms)
- [Release history](#release-history)

## Dataset and capture

ProvablyFair.org collected 8,100 live Plinko bets from Duel.com across four structured phases:

| Phase | Bets | Stake | Config | Purpose |
|-------|------|-------|--------|---------|
| A — Configuration coverage | 5,400 | $0.01/bet | All 27 configs (9 row counts × 3 risk levels) | Verify every config behaves correctly |
| B — High-variance sampling | 2,000 | $0.01/bet | 16 rows / high risk | Deep binomial distribution test on highest-variance config |
| C — Code-path equivalence | 200 | $10.00/bet | 16 rows / high risk | Confirm bet amount is not in the RNG |
| D — Client seed verification | 500 | $0.01/bet | All 27 configs (10 epochs × 50 bets, cycling through configs) | Confirm client seed is genuinely used in HMAC computation |

Total wagered: $2,079.00 ($54.00 Phase A + $20.00 Phase B + $2,000.00 Phase C + $5.00 Phase D). The dataset has 166 seed entries, and every one was recorded from a rotation response by `doRotation` in [capture/capture-auto.reference.js](capture/capture-auto.reference.js) (`context` `rotate-phase-A` to `rotate-phase-D`; the first entry's `serverSeed` was filled in later, see [Commit-reveal lifecycle](#commit-reveal-lifecycle)): one at each phase start, one after every 50 captured bets and one at each phase end. The 162 rotations that open a bet-bearing epoch have revealed server seeds; the 4 phase-end rotations open epochs with no bets. 3 phase-boundary entries are exempt from the reveal check (the end-of-phase rotation reveals the seed the phase ended on, not the one the next begins with). 166/166 next-seed promotions are recomputed. Seeds per phase: A 109, B 41, C 5, D 11.

Phase A used a balanced queue of 108 epochs × 50 bets = 5,400, exactly 200 bets per config, captured with IndexedDB storage (Step 11). Phase D used 10 distinct `pfaudit`-prefixed client seeds, 18–19 bets per config across its 10 epochs (E16). The client seed for every Phase A, B and C bet was generated at capture time by the capture harness's `Math.random` ([capture/capture-auto.reference.js](capture/capture-auto.reference.js)); see L1.

| Input | Identity |
|---|---|
| [data/plinko-master-8100bets.json](data/plinko-master-8100bets.json) | SHA-256 `3cf9359d88220bc800bb32edfe04399f55b909302262928ee3a0582715635267` |
| [plinkoConfig.json](plinkoConfig.json) | SHA-256 `78f0a39201a8c24fd1577143732e004f77e27d4d36efeedc6b3f7b93b2078fed` |

The config is the audited multiplier table, operator-supplied, pinned and verified at verifier startup. The verifier confirms both hashes before running any checks; tampering with either file causes `npm test` to fail at startup.

### Capture method and API

Bets were captured by a console-injected JavaScript script that sent its own API requests from the logged-in Duel.com Plinko page and stored the responses. That script wrote the dataset; its methodology is [capture/capture-auto.reference.js](capture/capture-auto.reference.js), a reference record, not a runnable tool, and the dataset's seed entries have the shape its `doRotation` writes. It stored 13 verification-relevant fields per bet: id, rows, risk_level, final_slot, payout_multiplier, amount_currency, win_amount, nonce, server_seed_hashed, client_seed, transaction_id, effective_edge, created_at. The phase start and completion cards E01–E06 were rendered with the browser Canvas API in a February 2026 session by an earlier revision of the tracker recorded in [capture/plinko-capture.reference.js](capture/plinko-capture.reference.js) (same `renderCard` card; the recorded revision also prints a Phase D counter, which E01–E06 lack); that tracker did not write the dataset.

The runnable console forms of both capture scripts place bets on duel.com, so they are kept in the private audit workshop and are not published. This package ships their two reference records under `capture/`, copied byte for byte from the public `duel-plinko` v1.2.0 on 1 October 2026. No step reads or runs either of them.

| File | What it is |
|---|---|
| [capture/capture-auto.reference.js](capture/capture-auto.reference.js) | The dataset capture script as a reference record, not runnable; the one this overview cites. The runnable form adds a header comment, a `window.plinko =` export and the control functions `go`, `pause`, `save`, `status` and `clear`; the rest, `doRotation` included, is the same line for line (a `diff` of the two in the workshop, not checkable from this package). The dataset's header carries `meta.schema` `duel-plinko-capture-v3`; the code that writes it is in the withheld `save()`, so that it is this script's schema cannot be checked from this package |
| [capture/plinko-capture.reference.js](capture/plinko-capture.reference.js) | A later revision of the February 2026 tracker that rendered E01–E06 (above), as a reference record, not runnable. It did not write the dataset |

| Call | Role |
|---|---|
| `POST /api/v2/games/plinko/bet` | Places a bet: `rows`, `risk_level` (1 = low, 2 = medium, 3 = high), `amount`, `currency` (105 = USDT), `instant: true`, `security_token`. The response echoes `rows` and `risk_level` (as the risk name); the dataset keeps both beside the request, and they agree on 8,100/8,100 bets |
| `GET /api/v2/client-seed` | Returns the active `serverSeedHashed`, `clientSeed` and `nonce`; read once, before the first rotation. The capture kept only its `next_server_seed_hash`, which is the first seed entry's `nextSeedPromotion.previousNextHash` (the pre-capture reading Step 2 anchors on) |
| `POST /api/v2/client-seed/rotate` | Body `{ "client_seed": "<new_client_seed>" }`. The browser generates the client seed; the server commits to a new server seed and echoes the submitted client seed (S11) |
| `GET /api/v2/user/transactions/{txId}` | Returns the plaintext `serverSeed` for the last bet's epoch; called after rotation |
| `POST /api/v2/user/security/token` | Short-lived security token required on every bet; observed expiry ~10 minutes, refreshed by the script once it was 5 minutes old (`ensureToken`) |

Every call carries the session cookie plus two browser-local headers from `localStorage`: `x-duel-device-identifier` (`security:uuid`) and `x-env-class` (`env_class`, typically `blue`). They identify the browser session, not the account. The token is stripped before the dataset is exported, so no active token appears in it.

**Per-epoch commitment record.** One explicit `GET /api/v2/client-seed` reading was taken, before the first rotation (`doRotation` reads it only while it holds no next-seed hash), and the dataset keeps only its `next_server_seed_hash`. Every epoch's commitment was nevertheless recorded before its first bet, from the rotation response: `POST /api/v2/client-seed/rotate` returns the new `server_seed_hashed` and `next_server_seed_hash`, and the capture stored them as the epoch's seed entry before it placed the epoch's first bet (`doRotation` in [capture/capture-auto.reference.js](capture/capture-auto.reference.js)). For all 162 bet-bearing epochs the seed entry's capture timestamp precedes the epoch's first recorded bet, by 1.1 to 11.3 seconds (measured for this release, not scored). These are the capture's own records: the order they show holds only as far as the capture is a faithful record of what Duel served, which the package assumes (P1). Step 3 verifies the hash is constant across every bet of each epoch, and Step 1 that the revealed seed hashes to it; both are consistency checks, not timing evidence. Future audits could also read the active seed with `GET /api/v2/client-seed` after each rotation, so each epoch has a second endpoint's pre-bet record of its commitment.

## Game and algorithm

A ball drops through a triangular field of pegs, bouncing left or right at each row before landing in a numbered slot. The player chooses bet amount, risk level (Low / Medium / High) and number of rows (8–16): 27 configurations. A ball traversing N rows lands in one of N+1 slots numbered 0 through N; the slot is the count of right-turns. Risk level affects only the multiplier table, not the ball path.

HMAC-SHA256 per row. For each row `cursor ∈ [0, rows−1]`:

```
key     = hexDecode(serverSeed)                          // 32 raw bytes (docs/ALGORITHM.md §2 Step 1)
message = UTF-8(clientSeed + ":" + nonce + ":" + cursor) // plain decimal nonce and cursor
digest  = HMAC-SHA256(key, message)                      // 32 bytes, one per row
u       = digest[0..3] as unsigned 32-bit big-endian     // §2 Step 2
bit     = u mod 2                                        // right = 1, left = 0
slot   += bit                                            // §2 Step 3
```

Final slot = sum of right-bounces across all rows (0 to `rows`). Payout = `bet × multiplier_table[risk][rows][slot]`.

**Key encoding.** The server seed is a 64-character hex string decoded to 32 raw bytes before use as the HMAC key. Using the hex string as UTF-8 (64 bytes) gives completely different results. The nonce is an integer, not zero-padded; the cursor is the zero-based row index. No other field, drand included, appears in the message.

**No modulo bias.** `u mod 2` on a uint32: 2^32 = 4,294,967,296 divides exactly by 2, so exactly 2,147,483,648 values give each direction. Step 5 computes this bound from the parameters the code reads (8 hex characters, modulus 2) and reports bias 0 against the profile's 2^-32 ceiling. No draw is rejected. Each row uses a unique cursor, so per-row outcomes are independent.

**drand.** `drand_round` and `drand_randomness` are not required for Plinko slot computation: all 8,100 slots reproduce from `(serverSeed, clientSeed, nonce, rows)` alone. drand is used in other Duel.com games.

**Where the RNG code comes from (PLINKO-09).** `src/rng.ts` is rebuilt from a written specification, [docs/ALGORITHM.md](docs/ALGORITHM.md) (E20), by an implementer who never opened Duel's code: the spec was written from Duel's public pages, the standard provably-fair construction, Duel's public plinko config and the 8,100 live bets, and its §8 lists every file read; the implementer read only that spec and a module-interface file. `tests/plinko/RngSpecTests.ts` runs the spec's own test vectors and properties against it. Duel's published Verify-tab code is run as a second check, not used as the source: Duel publishes its Plinko algorithm in the code panel of duel.com → Provably Fair → Verify (Plinko); screenshot S10 shows it expanded. Paulo copied it verbatim on 25 September 2026 (Expand → Copy) to `evidence/verify-tab/duel-verify-tab-plinko-2026-09-25.js` (SHA-256 `8b3366d1e91edb572cac288e0a853d2b560b2cf5c4468c6848439f957465c9ce`, 2,511 bytes; E19). It is pinned in `src/operator-verifier.ts` with its runner and **executed unmodified** by Step 5 on all 8,100 captured bets: its `validatePlinkoResult` bucket equals the served `final_slot` and `src/rng.ts` on 8,100/8,100, and the L/R path read from its own prefix sums (the same function called with rows = 1 … rows) equals `src/rng.ts`'s on 8,100/8,100. Not established: that the live Verify button, or Duel's server, runs exactly this code. From 25 September 2026 through v1.3.0, `src/rng.ts` was ported from that file and cited 8 of its lines; since v1.4.0 `src/rng.ts` is not derived from it. The theoretical RTP does not use `src/rng.ts`: Step 17 derives the slot probabilities with `binomProb()` in `src/stats.ts`, and Step 19 scores the 27,000,000 Pass 1 slots `src/rng.ts` produces against that binomial.

### Worked example

Bet ID 71599835 (Phase A, 8 rows, medium risk):

```
Server Seed: 3c6055436c9db25a2352a1eae6af8caf3d12ff79ab8d64eefcd78a0ab8886622
Committed:   eb26fd9d0e96cf40efae15956d682b01b7bdd4bfc675b24dc6c55181d21728ba
Client Seed: P9swCgSuvFkV9kNZ
Nonce:       0
```

| Row | HMAC message | hash\[0..3\] | uint32 | parity | Δ | position |
|-----|-------------|-------------|--------|--------|---|----------|
| 0 | P9swCgSuvFkV9kNZ:0:0 | 0x207D2FB1 | 545075121 | odd | +1 | 1 |
| 1 | P9swCgSuvFkV9kNZ:0:1 | 0x308C80BF | 814514367 | odd | +1 | 2 |
| 2 | P9swCgSuvFkV9kNZ:0:2 | 0x4C0BC4F9 | 1275839737 | odd | +1 | 3 |
| 3 | P9swCgSuvFkV9kNZ:0:3 | 0xCED6C6AA | 3470182058 | even | +0 | 3 |
| 4 | P9swCgSuvFkV9kNZ:0:4 | 0x65BC04A0 | 1706820768 | even | +0 | 3 |
| 5 | P9swCgSuvFkV9kNZ:0:5 | 0x5B068111 | 1527152913 | odd | +1 | 4 |
| 6 | P9swCgSuvFkV9kNZ:0:6 | 0x425FF7DB | 1113585627 | odd | +1 | 5 |
| 7 | P9swCgSuvFkV9kNZ:0:7 | 0x1FB5B86E | 532002926 | even | +0 | 5 |

Final slot 5; the API reported `final_slot = 5`. Multiplier (medium/8, slot 5) 0.70703318; payout 0.010000000000000000 × 0.70703318 = 0.0070703318, as the API reported `win_amount = 0.0070703318`.

A second example, bet ID 71644183 (Phase B, 16 rows, high risk): server seed `7b8c38d84c6d187c472c4e3f1e668222d64cfca099ca6127ad0e1cd198faf5b6`, committed `9ba5e4b2d361b53163c95f1d635df48e8c130811082e2c68a270255fb50cbc7d`, client seed `S8Wfb9k9Uyie6M9D`, nonce 0. The 16 first-4-byte values are `30859a26` `2a81ce4e` `4e51f6a2` `b65238a3` `33ad481f` `62580e72` `c1549686` `723a517d` `89c014c7` `7ac83a19` `dc95a479` `bb604d96` `1f202518` `e70327eb` `bdaaa511` `840fab57`; their parities give `final_slot = 9`, matching the API. The 16r/high slot 9 multiplier is `0.20186622×`, and the API paid `0.010000000000000000 × 0.20186622 = 0.0020186622`.

Every 64-hex value printed in this overview is checked by Step 22 against the pins the loader declares and against the dataset itself, so each one traces to the audited dataset or config, a declared pin or an exhibit image in `evidence/`.

### Commit-reveal lifecycle

An epoch is the run of bets under one server seed; the nonce counts up from 0 and resets at rotation. The 50-bet epoch is this capture's rotation interval, not a Duel rule. The capture made every rotation itself, with `POST /api/v2/client-seed/rotate`: at each phase start and end, and after every 50 captured bets (`BETS_PER_EPOCH = 50` in [capture/capture-auto.reference.js](capture/capture-auto.reference.js)). No epoch shows a rotation the capture did not make: all 162 carry one commitment and 50 captured bets (Steps 3 and 12), nonces 0–49, except the two capture-retry epochs of L2, where the server accepted a 51st bet, nonce 50, under the same commitment. Before an epoch the server publishes `serverSeedHashed = SHA-256(hexDecode(serverSeed))`; every bet response in the epoch carries it. The player sets the client seed. At each rotation the capture submitted a browser-generated client seed and stored the complete seed entry; at each rotation after a bet it fetched the plaintext server seed through the last bet's `transaction_id` (165 of the 166 seed entries carry that `revealedFrom`; the first rotation, at the start of Phase A, followed no bet). That first entry's `serverSeed` was null as captured; on 17 April 2026 (commit `b0158a3`, in the working repository that preceded the v1.0.0 release) it was filled with the seed revealed in the next entry (transaction 517122072), and the dataset pin was updated to its current value in the same commit. Step 2's epoch-0 anchor reads that copy. The auditor recomputes `SHA-256(hexDecode(revealedServerSeed))` against the recorded commitment. Duel's fairness modal and `/api/v2/client-seed` also show a "Next server seed (Hashed)"; Step 2 requires every promoted active hash to equal the pre-committed next hash, and anchors the chain before epoch 0 with the pre-capture next-seed reading. These equalities, like the hash match itself, are consistency checks: they show the seed records fit together, not when a hash was shown. That each commitment was outstanding before its epoch's bets rests on the capture's recorded observations, the rotation responses and the pre-capture reading ([per-epoch commitment record](#capture-method-and-api)).

## Payouts and RTP

### Slot probabilities

Each row is an independent 50/50 decision, so the slot follows B(rows, 0.5): `P(slot = k) = C(rows, k) × 0.5^rows`. This is exact for all row counts 8–16, and identical across risk levels. For 16 rows:

| Slot | P(slot) | Expected per 2,000 bets |
|------|---------|------------------------|
| 0, 16 | 0.001526% | 0.03 |
| 1, 15 | 0.024414% | 0.49 |
| 2, 14 | 0.183105% | 3.66 |
| 3, 13 | 0.854492% | 17.09 |
| 4, 12 | 2.777100% | 55.54 |
| 5, 11 | 6.665039% | 133.30 |
| 6, 10 | 12.219238% | 244.38 |
| 7, 9 | 17.456055% | 349.12 |
| 8 | 19.638062% | 392.76 |

Edge slots 0 and 16 have probability about 1 in 65,536 and will not appear in most captures of a few thousand bets. Step 17 also walks all 2^rows paths through each of the 9 boards (130,816 paths) and checks the landings against an integer Pascal recurrence, the closed form and the operator's table.

### Multiplier tables and settlement

`win_amount = amount_currency × payout_multiplier`. Multipliers are symmetric: slot k and slot rows − k carry the same multiplier. All three risk levels target the same RTP but differ in variance; risk is a variance preference, not an expected-value preference.

`plinkoConfig.json` carries two multiplier sources: `payout_tables` (compact, top-level) and `scaling_edge[rows][risk][bracket].multipliers` (per bracket). They differ by at most 1.49×10⁻⁶. Duel pays `scaling_edge[0].multipliers`: all 8,100 live `payout_multiplier` values match it (Step 8), and every multiplier string is on the 8-dp grid with `win_amount = amount_currency × payout_multiplier` at relative 1e-12 (Step 7). The same (risk, rows, slot) always returns the same multiplier regardless of bet amount, nonce or epoch.

16-row high risk, bracket 0:

| Slot | Multiplier |
|------|------------|
| 0, 16 | 1009.33110594 |
| 1, 15 | 131.21304378 |
| 2, 14 | 26.24260875 |
| 3, 13 | 9.08397996 |
| 4, 12 | 4.03732442 |
| 5, 11 | 2.01866221 |
| 6–10 | 0.20186622 |

The five centre slots carry the 0.20186622 floor, so no 16r/high outcome pays zero; the minimum return on that board is about 20% of the stake. 8 rows, bracket 0:

| Slot | Low | Medium | High |
|------|-----|--------|------|
| 0, 8 | 5.65180109 | 13.13061608 | 29.24517348 |
| 1, 7 | 2.11942541 | 3.03014217 | 4.03381703 |
| 2, 6 | 1.11017522 | 1.31306161 | 1.51268139 |
| 3, 5 | 1.00925020 | 0.70703318 | 0.30253628 |
| 4 | 0.50462510 | 0.40401896 | 0.20169085 |

Full tables for all 27 configurations are in `plinkoConfig.json` → `scaling_edge[rows][risk][0].multipliers`.

### Theoretical RTP

`RTP = Σ P(slot_k) × multiplier(slot_k)`, with `P(slot_k) = C(n, k) / 2^n`. Worked example, medium risk, 8 rows:

| Slot | P(slot) = C(8,k)/256 | Multiplier | P × M |
|------|----------------------|----------------|-------|
| 0 | 0.00390625 | 13.13061608 | 0.05129147 |
| 1 | 0.03125000 | 3.03014217 | 0.09469194 |
| 2 | 0.10937500 | 1.31306161 | 0.14361611 |
| 3 | 0.21875000 | 0.70703318 | 0.15466351 |
| 4 | 0.27343750 | 0.40401896 | 0.11047393 |
| 5–8 | (symmetric) | | |
| **Total** | **1.00000000** | | **0.99900000** |

The 99.900% theoretical RTP is established by a two-step chain verified in Step 17 (EC-33). First, the slot probabilities in `plinkoConfig.json` exactly equal the independent binomial for all 351 per-slot entries, computed by `binomProb()` in `src/stats.ts`, which never reads the config. Second, with those probabilities the RTP is `Σ binomProb(rows, k) × scalingEdgeMultiplier(rows, risk, k)`, a mathematical identity, giving 99.900% for all 27 configurations. The casino supplies the multiplier table; the RTP conclusion does not depend on any casino-supplied probability.

Per configuration, computed by `config.theoreticalRTP()` in `src/config.ts` (binomial probabilities × `scaling_edge[0].multipliers`, the table Duel pays; Step 8 records the same 27 values as `theoreticalRTPs`). The compact `payout_tables` differs from that table on 118 of 351 cells, by at most 1.49×10⁻⁶:

| Rows | Low | Medium | High |
|---|---|---|---|
| 8 | 0.999000001796875 | 0.9990000015625001 | 0.9990000005468751 |
| 9 | 0.9990000021875001 | 0.99900000234375 | 0.9990000005078125 |
| 10 | 0.9989999974804687 | 0.9990000021679687 | 0.9990000002734376 |
| 11 | 0.9989999994335936 | 0.9990000016503905 | 0.9990000005078125 |
| 12 | 0.9990000005859376 | 0.9990000007519532 | 0.9990000011816407 |
| 13 | 0.9989999999902343 | 0.9990000001660156 | 0.9990000011450194 |
| 14 | 0.998999999506836 | 0.999000001706543 | 0.9990000004406738 |
| 15 | 0.9990000005273438 | 0.9990000007232666 | 0.999000000333252 |
| 16 | 0.9989999989468383 | 0.9989999983651733 | 0.9989999995104982 |

Average 0.999000000531119 (99.9000%). Deviations from exactly 0.999 come from the finite precision of the stored multiplier strings; all configurations encode the same 0.1% house edge. On the `scaling_edge[0]` table that Duel pays, Step 10 derives 0.9990000005311189 for both `effective_edge` groups.

**RTP claim table, scored.** `outputs/rtp-claim-table.json` scores all 27 configurations (rows 8–16 × risk low / medium / high, scaling_edge bracket 0) against a flat 99.9% claim from the game settings, one of the RTP-CLAIM rule's six places (game page, fairness page, help page, bet panel, rules, game settings): house_edge "0.001" on scaling_edge bracket 0 of Duel's plinko config. The rule (RTP-CLAIM 1.2.0, Methodology v1.1) is switched on (decision D3, 14 October 2026): the outcome is scored on Step 19, the step carrying PLINKO-19, and a house-side miss would make the verdict RTP FIGURE OVERSTATED (exit 5), never NOT PROVABLY FAIR, because the draws themselves pass. Outcome: pass (true minimum and maximum 99.900000%; 0 of 27 beyond the 0.1 pp band).

### Progressive house edge (Step 16)

`scaling_edge` has 191 bet-size brackets per configuration (5,157 across the 27). Each bracket carries a minimum and maximum bet, a `house_edge` and a complete multiplier table, and the config assigns the bracket by `amount_currency`. Bracket 0 has `house_edge = "0.001"`; for 16r/high, the most restrictive configuration, it covers bets up to $335.946312864870400000, and other configurations have higher ceilings. Both test amounts fall in bracket 0 on every tested configuration. Step 16 checks every bracket: each declared `house_edge` equals 1 − its derived RTP, multipliers are symmetric, the ladder tiles the stake axis with monotone non-decreasing edge, and RTP falls from 99.9% at bracket 0 to 98.0% at the top bracket. A $500 bet on 16r/high is priced at 0.15% by the pinned config. The structure is static and encoded in the config; it is reported for transparency, not as manipulation.

**Where the edge rises.** In the pinned config, each tier adds 0.01% of edge. On 25 of the 27 configurations the top tier caps the maximum profit, stake × (top multiplier − 1), at $1.5m to the cent; on 9r/high and 8r/high the ladder ends below it. Past the stake where the maximum profit reaches $1.5m, each further 0.01% of edge adds between $0.15 (16r/high) and about $41 (8r/low) of stake, and the maximum profit stays at $1.5m. On 16r/low the pinned config sets the edge at 0.1% at $99,000, 1.01% at $100,000 and 1.93% at $101,000, for a maximum profit of about $1.5m in each case. The duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET) is byte-identical to the pinned file (E11), so the same thresholds apply to it. These are the brackets the config declares; every bet of the 10 April 2026 capture was in bracket 0, so no stake above it was tested live (R-BRACKET). Generated from the pinned config by `node scripts/scaling-edge-table.mjs`:

| Config | 0.1% up to | Max profit reaches $1.5m at | 2% tier |
|---|---|---|---|
| 16 low | $99,038 | $99,038 (0.10%) | $101,077 to $101,088 |
| 16 medium | $6,731 | $13,650 (0.21%) | $13,900 to $13,902 |
| 16 high | $336 | $1,493 (0.47%) | $1,516 to $1,516 |
| 15 low | $85,861 | $106,144 (0.13%) | $108,304 to $108,316 |
| 15 medium | $6,006 | $17,117 (0.29%) | $17,417 to $17,419 |
| 15 high | $404 | $2,415 (0.63%) | $2,448 to $2,449 |
| 14 low | $143,856 | $243,526 (0.17%) | $248,798 to $248,828 |
| 14 medium | $7,865 | $26,137 (0.34%) | $26,585 to $26,587 |
| 14 high | $469 | $3,572 (0.81%) | $3,615 to $3,616 |
| 13 low | $66,054 | $209,647 (0.33%) | $213,703 to $213,728 |
| 13 medium | $7,952 | $35,514 (0.46%) | $36,082 to $36,085 |
| 13 high | $623 | $5,795 (0.98%) | $5,855 to $5,856 |
| 12 low | $96,130 | $165,109 (0.18%) | $168,500 to $168,520 |
| 12 medium | $8,809 | $46,651 (0.55%) | $47,358 to $47,363 |
| 12 high | $764 | $8,907 (1.23%) | $8,977 to $8,977 |
| 11 low | $74,540 | $201,052 (0.28%) | $205,039 to $205,063 |
| 11 medium | $11,736 | $64,946 (0.58%) | $65,921 to $65,928 |
| 11 high | $863 | $12,698 (1.56%) | $12,754 to $12,756 |
| 10 low | $52,274 | $188,552 (0.38%) | $192,045 to $192,068 |
| 10 medium | $10,025 | $71,169 (0.75%) | $72,113 to $72,121 |
| 10 high | $1,105 | $20,203 (1.92%) | $20,218 to $20,220 |
| 9 low | $68,592 | $323,992 (0.49%) | $330,042 to $330,083 |
| 9 medium | $8,939 | $88,415 (1.05%) | $89,314 to $89,323 |
| 9 high | $1,696 | not reached | $32,567 to $32,725 |
| 8 low | $46,899 | $324,945 (0.73%) | $330,042 to $330,083 |
| 8 medium | $9,539 | $125,407 (1.39%) | $126,239 to $126,253 |
| 8 high | $2,061 | not reached | $40,000 to $40,196 |

### Zero Edge and `effective_edge` (Step 10)

The API returns `effective_edge` on each bet as `0.1` or `0`. Both groups recompute against the same committed table: `edge_0.1` 7,563 bets and `edge_0` 537 bets, 0 multiplier mismatches each. Per Duel.com engineering, the field is the post-rakeback edge marker: every bet settles with `0.1`, then an operator-side rewards queue flips it to `0` once the rakeback rebate is credited. The 7,563 bets carrying `0.1` reflect the auto-bet capture rate (~0.89 bets/s) outrunning that queue. A 20-bet re-fetch sample (5 per phase, all originally `0.1`) via `GET /api/v2/user/transactions/{txid}` returned `effective_edge = 0` for 20/20. On the captured stakes ($0.01 and $10, bracket 0; `edge_0` is 522 bets at $0.01 and 15 at $10) the field has no effect on the RNG, the slot or the bet-level payout, and the Zero Edge label is not a separate payout table.

### Simulation and observed returns

**Pass 1:** 27,000,000 rounds, 1,000,000 per configuration, from the seeds pinned in `src/sim-seeds.ts` (`SIM_SEEDS`). Average simulated RTP 99.9166% against the average theoretical 99.900%; 0/27 configurations fail chi-squared at the Bonferroni threshold (α/27 = 0.00037) and 0/27 at uncorrected α = 0.01; 0 serial-independence fails. Expected counts come from the independent binomial, not from the config. Per-configuration RTP, chi-squared and slot counts are in [outputs/simulation-results.json](outputs/simulation-results.json); [outputs/rtp-convergence.html](outputs/rtp-convergence.html) charts the cumulative average RTP.

**Pass 2 (cherry-pick detection, Step 20):** each of the 162 revealed server seeds is run over 10,000 nonces, 242 seed × row combinations. A cherry-picking operator would pre-generate seeds and deploy only those whose early nonces (0–49, the window this capture played under each seed) favour the house.

- **Test A** (full-range chi-squared vs binomial): 1 of 242 fails at α = 0.01; the expected false-positive count is ≈ 2.4.
- **Test B** (early bucket p < 0.05 and late bucket p ≥ 0.05): 10 of 242 flagged, below the threshold ceil(242 × 0.05) = 13. A multi-window check on five consecutive 50-nonce windows found 8 isolated-early deviations and 2 multi-window ones, against an H₀ expectation of 8.1 and 1.9. The early bucket has only 50 nonces (typically 2–4 pooled df), so Test B detects gross cherry-picking, not fine-grained selection.
- **Test C** (added 24 September 2026, PLINKO-21): computed in verify, not read from an artifact. For each of the 162 revealed epochs, the payout sum of the 50 configurations the casino actually served at nonces 0–49 is standardised by the exact per-board mean and variance and ranked against a null calibrated on 10,000 fresh seeds (`src/pass2-replay.ts`, derived by a fixed public rule) playing the same served sequence. The rule (flag at p ≤ 0.01, Poisson-binomial family survival < 0.001 FAIL / < 0.01 FLAG, broad (early and reference window both p ≤ 0.001) FAIL, pooled z < −3.090 FAIL) is the `TEST_C_*` constants in `tests/steps/simulation.ts`, **written on 24 September 2026 before the statistic was first computed, and after this capture's server seeds were revealed**.

| Test C metric | Value |
|--------|-------|
| Epochs scored | 162 |
| Flagged at p ≤ 0.01 | 1 (the rule fails at 8; family survival 0.8037) |
| Broad flags | 0 |
| Pooled early-window z | −0.554 |
| Early windows below / above expectation | 98 / 64; payouts are right-skewed, so an honest window pays below its mean more often than not: the calibrated null expects 99.9 of 162 below |
| Detection power, 10% early-window shortfall | 12.7% per epoch; 30.7% for the family if a quarter of epochs were picked |

Test C catches gross selection, not subtle selection: 50 rounds per epoch is a small window.

**Observed returns (informational only):** Phase A (5,400 bets, $54.00) 99.303%, Phase B (2,000 bets, $20.00) 92.313%, Phase C (200 bets, $2,000.00) 74.993%, Phase D (500 bets, $5.00) 104.636%. At n = 200 per config with multipliers up to 1009×, no sample-based RTP test has meaningful power. Phase C returned $1,499.8660 on $2,000.00; at N = 200 on 16r/high the theoretical-variance 95% CI half-width is approximately ±92% of the theoretical RTP (1.96 × √(43.91/200) = 0.918), so this is expected variance, not an anomaly. Live bets prove determinism, parity and payout correctness; they are not RTP evidence.

## Verification results

The audit evaluates the 8,100 bets captured on 10 April 2026 against the pinned config. Its 23 scored steps in `tests/verify.ts` report **22 PASS, one capture-origin FLAG and zero hard failures**; the verdict is `PROVABLY FAIR — Full Pass`. Results below are quoted from [outputs/verification-results.json](outputs/verification-results.json).

| Step | EC refs | Check | Result |
|---:|---|---|---|
| 1 | EC-1 | Seed Hash Integrity | PASS: 162/162 commitments verified; exactly 3 declared phase-boundary exemptions (A→B, B→C, C→D) |
| 2 | EC-2 | Next-Seed Promotion | PASS: 166/166 rotation transitions recomputed; chain anchored before epoch 0 by the pre-capture next-seed hash. Evidence begins at that reading |
| 3 | EC-26 | Hash Consistency Within Epoch | PASS: all 162 epochs carry one `server_seed_hashed`; 162 epochs to 162 distinct commitments |
| 4 | EC-2–5 | Nonce Audit | FLAG (capture-origin, verdict-neutral): nonces sequential; 2 capture-retry epochs reconstructed from revealed seeds (L2); 0 unverifiable |
| 5 | EC-6, 7 | Slot Recomputation & Bit-Extraction Bound | PASS: 8,100/8,100 recomputed, 0 skipped; bias 0; operator and ProvablyFair.org verifiers executed on every bet |
| 6 | EC-27 | Client Seed Influence (exact null) | PASS: under a wrong client seed the ordered path coincided 10 times and the slot 1,281 times, scored against the exact Poisson-binomial null at α 0.001; 6,819 of 8,100 slots changed; no epoch unchanged |
| 7 | EC-11, 18 | Payout Math | PASS: all 8,100 multipliers on the 8-dp grid; `win_amount = amount_currency × payout_multiplier` at relative 1e-12 |
| 8 | EC-28, 32 | Multiplier Table Provenance | PASS: every slot in range; 8,100/8,100 match `scaling_edge[0].multipliers`; 263/351 entries observed live |
| 9 | EC-15–17 | Phase C Code-Path Equivalence | PASS: 200/200 Phase C slots at $10 on 16r/high, the Phase B board; same table; proven deterministically |
| 10 | EC-23 | Zero Edge Audit | PASS: both `effective_edge` groups share one table, derived RTP ≈ 99.9000% |
| 11 | EC-30 | Config Completeness & Cell Coverage | PASS: all 27 configs ≥ 100 Phase A bets (min 200, total 5,400/5,400); 263 of 351 cells paid |
| 12 | EC-31 | Epoch Size & Count | PASS: all 162 commitments hold exactly 50 bets; count equals `EXPECTED_EPOCHS` |
| 13 | EC-10, 12–14 | Multiplier Table + Symmetry | PASS: symmetry across all 27 configs; 16r/high 0.2× floor; live multipliers within 1e-5 |
| 14 | EC-24 | Population & Phase Labels | PASS: 8,100 bets and 166 seeds labelled; population matches `src/loader.ts` |
| 15 | EC-25 | Dataset Hash | PASS: dataset SHA-256 equals its pin |
| 16 | EC-17, 32 | Scaling Edge Analysis | PASS: all 5,157 brackets; RTP 99.9% at bracket 0 to 98.0% at the top |
| 17 | EC-33 | Probability Independence | PASS: 351 probabilities equal the independent binomial; 99.9% RTP on all 27; 130,816 paths walked |
| 18 | EC-27 | Phase D — Client Seed Variation | PASS: 500/500 slots; 10 distinct client seeds; wrong-seed re-drop moved 434 of 500; all 10 seeds clock-derived and disclosed |
| 19 | EC-34 | Simulation Pass 1 | PASS: 27,000,000 rounds replayed from pinned seeds, census exact; 691 derived figures within tolerance; 0/27 fail at Bonferroni |
| 20 | EC-35 | Simulation Pass 2 | PASS: Test A 1 fail; Test B 10 of 242 (threshold 13); Test C 1/162 flagged, pooled z −0.554 |
| 21 | — | Artifact Integrity | PASS: 4 artifacts match their pins; 45,151 numeric leaves within value domains |
| 22 | EC-25 | Published-Pin Drift Scan | PASS: every 64-hex token in the published Markdown resolves to a declared pin, a dataset or config value, or the SHA-256 of an image in `evidence/` |
| 23 | — | Epoch-Window Slot Fit | PASS (informational): 9 board-size groups; Fisher combined p = 0.7475 |

**Hard-fail criteria** (any one = NOT PROVABLY FAIR): EC-1 seed hash mismatch, EC-4 nonce gap or repeat, EC-5 client seed changed mid-epoch, EC-7 slot recomputation mismatch, EC-26 hash changed mid-epoch, EC-27 client seed not used. None was triggered.

**The nonce flag (Step 4, L2).** In each of 2 epochs the server processed 51 bets (nonces 0–50) while the capture recorded 50: one response was lost (nonce 20 and nonce 32), the bet placed after it received the next nonce (21 and 33), and the epoch ran to nonce 50 because the capture counts 50 recorded bets. The missed outcomes are reconstructed from revealed server seeds whose SHA-256 matches the pre-bet commitment: epoch `6a4a4aff75cfdf36` nonce 20 and epoch `6f70b8229ebcd1c1` nonce 32, 16 rows, computed slot 8 in both. The auditor did not witness these two outcomes in the capture, so they are a capture-origin FLAG, not a PASS, and not counted against the verdict. The other 160 epochs carry clean nonces 0–49.

**Phase C.** All 200 $10 bets recompute and pay from the same `scaling_edge[0].multipliers` table as Phase B. No distributional test is scored at n = 200; equivalence rests on 200/200 exact matches.

**Live-bet statistics (informational).** Chi-squared on live bets (slots with expected count < 5 pooled, configs with n < 100 excluded): 26/27 configurations pass at α = 0.01. 9r/low (n = 219, χ² = 19.849, df = 5, p = 0.0013) falls below the uncorrected threshold but not Bonferroni (α/27 ≈ 0.00037); with 27 tests the chance of at least one p below 0.01 is about 23.8%. Selected rows from [outputs/chi-squared-results.json](outputs/chi-squared-results.json):

| Config | χ² | df | p-value | n |
|---|---|---|---|---|
| 16r/high | 19.465 | 12 | 0.0779 | 2,418 |
| 16r/medium | 6.334 | 8 | 0.6099 | 218 |
| 16r/low | 8.112 | 8 | 0.4226 | 218 |
| 9r/low | 19.849 | 5 | 0.0013 | 219 |
| 11r/high | 9.656 | 7 | 0.2089 | 219 |
| 8r/low | 10.942 | 6 | 0.0902 | 219 |

Serial independence on Phase B (2,000 same-config bets): lag-1 r₁ = −0.0056 against ±0.0671 (3/√n), z = −0.25; runs test z = 0.300, p = 0.7645. The original adversarial testing also recorded Phase C (n = 200): r = −0.039448689187494765 against ±0.21213203435596426, runs p = 0.7072033934778719. Phase A is excluded because it spans 27 configs in sequence. These live samples have limited power; the conclusive serial and distribution tests are simulation Pass 1.

### Fairness-integrity matrix (Framework S5-1 … S5-8)

S5: fairness-integrity matrix; game-integrity testing not commissioned.

`scripts/check-exploit-matrix.mjs` parses the block between the markers below and fails `npm test` unless all eight rows are present exactly once, each carrying one verdict (Pass / Flag / Hard Fail / Not tested — disclosed) tied to a step or a capture.

<!-- S5-MATRIX:START -->

| Framework ID | Category | Verdict | Tied to | Evidence |
|---|---|---|---|---|
| S5-1 | Replay protection | Pass | Step 4 (Nonce Audit) + Step 1 (Seed Hash Integrity) | server nonces sequential from 0 with no repeat across 162/162 epochs (in the 2 capture-retry epochs the bet placed after the lost response received the next nonce, 21 and 33, not a reused one, and the epoch ran to nonce 50; L2), and the settling server seed hashes to the commitment its epoch's bets carried (Step 1, a consistency check), a commitment the capture recorded at rotation before the epoch's first bet (capture records, assumed faithful; P1) — a bet cannot be replayed onto a re-chosen seed without breaking that match |
| S5-2 | Input validation | Not tested — disclosed | capture scope | the capture placed only well-formed bets at valid stakes; there is no rejected- or malformed-input corpus, so server-side input validation is not exercised here |
| S5-3 | Seed integrity under adversarial input | Pass | Step 6 (Client Seed Influence) + Step 5 (Slot Recomputation) | a wrong client seed changes the slot, and every outcome reproduces from (serverSeed, clientSeed, nonce) alone — no hidden input (no drand) enters the RNG |
| S5-4 | Cross-player isolation | Not tested — disclosed | capture scope | a single-account capture; there is no second player's stream to test for shared or leaking state |
| S5-5 | Payout field integrity | Pass | Step 7 (Payout Math) + Step 13 (Multiplier Table + Symmetry) | 8,100/8,100 live multipliers match the committed table and win_amount = amount × payout_multiplier at relative 1e-12 |
| S5-6 | Nonce sequence enforcement | Pass | Step 12 (Epoch Size & Count) + Step 4 (Nonce Audit) | the server assigns the nonce: it counts up from 0 under each commitment with no repeat, and a retried bet received the next nonce rather than a reused one (Step 4, L2); the capture's 50 bets per commitment and 162 commitments are asserted from src/loader.ts (not the dataset header), so neither a shrunk nor a merged nonce sequence passes |
| S5-7 | Parameter boundary enforcement | Pass | Step 9 (Phase C Code-Path Equivalence) + Step 16 (Scaling Edge Analysis) | $10 Phase C bets take the same RNG path as $0.01 bets, and in the pinned config the bracket ladder tiles the stake axis (a check of the config file); which bracket the server applies above bracket 0 was not tested (R-BRACKET) |
| S5-8 | Game-specific state | Pass | Step 19 (Simulation Pass 1) + Step 20 (Simulation Pass 2) | the slot distribution matches the independent binomial (0/27 configs fail at Bonferroni over 27M rounds) and shows no serial correlation |

<!-- S5-MATRIX:END -->

The audit's own ten-category taxonomy, S5-01 … S5-10, each mapping onto a framework row above:

| Test ID | Category | What Was Tested | Expected Behaviour | Result | Finding Summary |
|---|---|---|---|---|---|
| S5-01 | Commitment integrity | Server seed not committed before bets | SHA-256(serverSeed) matches the commitment the epoch's bets carried (consistency), and that commitment was recorded before the epoch's first bet (capture record, P1) | Pass | 162/162 seeds verified; hash stable within each epoch; seed entry recorded before the first bet in 162/162 epochs (capture timestamps, not scored) |
| S5-02 | Commitment integrity | Commitment linkage broken | nextServerSeedHash at rotation matches promoted serverSeedHashed | Pass | 166/166 next-seed promotions verified |
| S5-03 | Nonce integrity | Nonce replay or skip | Nonces sequential from 0 per epoch, no gaps or repeats | Pass | 162/162 epochs sequential; 2 capture-retry missed nonces reconstructed from the revealed seeds, not witnessed by the capture (Step 4 capture-origin FLAG, L2) |
| S5-04 | Player influence | Client seed not used in RNG | Wrong client seed produces different slot outcomes | Pass | 6,819/8,100 slots (84.2%) changed with wrong seed |
| S5-05 | RNG transparency | Slot outcome uses hidden input (drand or other) | Slot reproduced from (serverSeed, clientSeed, nonce) alone | Pass | 8,100/8,100 reproduced without drand; drand not in Plinko RNG |
| S5-06 | Payout integrity | Payout multiplier table swapped or manipulated | Live multipliers match plinkoConfig.json for all bets | Pass | 8,100/8,100 match scaling_edge[0].multipliers |
| S5-07 | Payout integrity | Payout math incorrect | win_amount = amount_currency × payout_multiplier | Pass | 8,100/8,100 at relative 1e-12 |
| S5-08 | Code-path equivalence | High-stake bets use different RNG path | $10 bets produce same slots/multipliers as $0.01 bets | Pass | 200/200 Phase C slots verified; same multiplier table |
| S5-09 | Distribution fairness | Slot distribution biased | Slot frequencies match binomial B(n, 0.5) | Pass | 26/27 live configs pass at α=0.01; 0/27 simulation fails |
| S5-10 | Serial independence | Serial correlation in outcomes | No autocorrelation or non-random run structure | Pass | Phase B r₁=−0.006, runs p=0.765; Phase C r₁=−0.039, runs p=0.707 |

### Player-verifier parity (PLINKO-24)

Two ProvablyFair.org verifiers a player can paste a Duel Plinko bet into are pinned by SHA-256 and **executed** on all 8,100 captured bets in Step 5:

| Verifier | Pinned bytes | Result |
|---|---|---|
| Docs-site `VerifyBets` (`qa-workspace/duel/docusaurus`, `mikepforg/pf-audit-duel`, `origin/main` @ `bd4d59c` (2026-09-19), read with `git cat-file` on 25 Sep 2026; the 24 Sep pins came from branch `repotree-sync` @ `2ad89bc`, whose `derive.js` and `paytables.js` differed only in the source-URL comment) | `games/plinko/derive.js` `dd8417482d2e18fef35894c7ac16e17a61a9eb4166817e3d8533d2160d9b754e`, `games/plinko/paytables.js` `7158d02dab13b632507b5c6e4149d5c01ad864a2f15a3e7bbe9d6d08a720a704`, `games/plinko/scalingEdge.js` `6b833ed47c215aab1a5c499dcb22bf1dc31cfbc1d5b5dc17b53d41d7c4b6ef31`, `lib/hmac-sha256.js` `bc30bfe9ef202905ece93de33440d41851abf16e910f90c2a567774a2b79d889` | slot and L/R path 8,100/8,100; multiplier: see L5 |
| Live `www.provablyfair.org/verify-bets` (Next.js build, fetched by GET 24 Sep 2026; source not available to this audit) | chunks `turbopack-828b80f561e7c968.js` `6e8629f444df945f8fecfdfe05e24f4fa6c63b6b1ecc8f39fc45e9c4f4ecc903`, `34934e0e762aa37e.js` `9fb319dec0d79f9bf5851ec8e0052b6b2125e603be03d12b78a0fe99eed817d1`, `4f34301b2f166201.js` `8111e3f3e9a137888558f69547a19b0238d1c50a339b4c51095f9481785df0f5` | slot, bucket count, L/R path, commitment hash and display-rounded multiplier 8,100/8,100 |

`node scripts/check-site-verifier.mjs <site derive.js>` compares a docs-site checkout with the pins; `node scripts/check-site-verifier.mjs --live` re-downloads the live page and chunks (GET) and compares hashes. Both were run on 24 September 2026: 4/4 and 3/3 MATCH. On that day the live page's Casino picker offered only Duel.com.

## Reproduce the audit

Runtime: **Node 22.x** (pinned in `package.json` `engines` and `.nvmrc`). The committed artifacts were produced on that line, and the last bits of a derived statistic are runtime-dependent; see the gate below.

```sh
npm ci
npm test
```

`npm test` runs `node scripts/check-standalone.mjs` (the compiled `verify.js` and `test.js` match the build manifest), `node test.js` (44 unit tests), `node scripts/check-outputs.mjs` (23 scored steps, ids 1..23 each once), `node scripts/check-exploit-matrix.mjs` (the S5 block above) and `node verify.js`. The console tags each step `[PASS]`, `[FAIL]` (hard fail), `[FLAG:capture]` (an auditor-side capture limitation, disclosed and verdict-neutral; Step 4 carries one for the two reconstructed capture-retry nonces) or `[FLAG:operator]` (verdict-affecting). A Full Pass run shows `[FLAG:capture] Step 4` and no `[FAIL]`.

**Time budget** (also in `RELEASE-MANIFEST.json` `runtimeBudget`). `npm test` scales with the core count, because Step 19 replays 27,000,000 rounds on worker threads (about 60% of the reported cores, `src/parallel.ts`; `PF_PARALLEL_WORKERS` overrides):

| Cores / threads | Machine | Node | Wall time | Source |
|---|---|---|---|---|
| 12 cores, 7 threads (default) | Apple M2 Max | 22.23.1 | 4 min 25 s | measured 2026-09-28, `time npm test` |
| 12 cores, 2 threads (`PF_PARALLEL_WORKERS=1`, the count a 2-core machine gets) | Apple M2 Max | 22.23.1 | 6 min 0 s | measured 2026-09-28 |
| 2 cores | reviewer's machine | — | 14 min | reported in the 2026-09-28 review |

Budget: allow **20 minutes on 2 cores** and **6 minutes on 12**. A run far outside that is worth investigating; a run inside it is not stuck.

| Command | Purpose |
|---|---|
| `npm run simulate` | 27M-round two-pass simulation; regenerates the artifact of record from `SIM_SEEDS` |
| `npm run verify` | 23-step verification of the captured dataset |
| `npm run test:full` | Regenerate the simulation into `outputs/run/`, diff it, then `npm test` |
| `npm run mutate` | Falsifiability gate: 52 counterexamples, each must be rejected (MC3a, MC3as, MC3bs with exit 1, MC3b with exit 5) |

Verify the two input identities independently with `shasum -a 256 data/plinko-master-8100bets.json plinkoConfig.json`.

### The simulation is deterministic, and says so

`RELEASE-MANIFEST.json` declares `simulation.seeding: "pinned"`. The Pass 1 experiment is re-derived from the `SIM_SEEDS` fixed in `src/sim-seeds.ts`, so `npm run simulate` reproduces the committed artifact rather than running a new experiment. On every run the verifier replays all 1,000,000 rounds of all 27 configurations (`src/pass1.ts`, the generator's own loop) and requires every slot count to come back exactly and every derived figure within the reproduction tolerance. (Until 24 September 2026 it replayed only the opening 10,000 rounds of each configuration.) Where a package draws fresh seeds at runtime the experiment cannot be byte-reproduced, and a hash of it proves only that the shipped bytes were not edited; this package does not need to attest its simulation that way.

The pinned simulation artifact is **replayed, not rewritten** on the default path: Step 19 regenerates all 27,000,000 Pass 1 rounds in memory and compares them with the committed artifact, which stays byte-identical. `npm run test:full` additionally writes a complete regeneration to `outputs/run/` and `src/diff-simulation.ts` compares it with `simulation-results.json` field by field (integers and strings exact, 1e-14 + 1e-12 otherwise) and `rtp-convergence.html` byte for byte, recording the Node runtime in `outputs/run/diff-simulation.json`. No pinned artifact carries run metadata, so a regeneration reproduces every integer, string and count exactly. What it will not reproduce is the last bit of a few floating-point p-values: regenerated on a second machine, six differ by 1–12 units in the last place and everything else is identical, all of it inside 1e-12. The replay counts `npm test` compares are machine-independent; how many came back bit-identical, and the largest in-tolerance gap, depend on the CPU and are written only to `outputs/run/replay-precision.json`.

### The gate

`npm run verify` writes **nothing** into `outputs/`. This run's results, its determinism log, its chi-squared table and `diff.json` go to `outputs/run/`, gitignored, so a re-run cannot replace the evidence it scores and a disagreement between two runs is recorded rather than resolved in favour of whichever ran last. Refreshing the committed copy is the separate, deliberate `PF_EMIT=1 npm run verify`.

`diff.json` compares this run against the committed artifacts field by field and records the runtime it ran on. The comparison is at tolerance, **1e-14 absolute + 1e-12 relative**, and two distinct integers never agree, so a p-value that moved by a unit in the last place is recorded as `withinTolerance` and not scored, while anything outside that bound is a different result. This is the measured case: on 18 September 2026 a rerun of the pinned-seed simulation moved one cherry-pick p-value from `0.7730031061099987` to `0.7730031061099988` and left every other leaf of the artifact identical. The SHA-256 pins in `src/artifact-pins.ts` are unchanged and remain the identity of the committed bytes; a pin is never rewritten to make a regeneration agree with it.

Exit codes are the verdict, so nothing automated can read a Conditional Pass as clean:

| Code | Meaning |
|------|---------|
| `0` | `PROVABLY FAIR — Full Pass`, and this run reproduces the committed artifacts |
| `1` | at least one HARD_FAIL, **or** a reproduction difference beyond tolerance |
| `2` | at least one FLAG — `PROVABLY FAIR — Conditional Pass` |
| `5` | `RTP FIGURE OVERSTATED`: no draw check failed, but the RTP-CLAIM rule (1.2.0, switched on) found settings beyond the 0.1 pp band on the house side of the published figure. It outranks a Conditional Pass; a hard fail (exit 1) outranks it |

**Falsifiability:** 52 counterexamples in `tests/mutations.json` (49 until 14 October 2026, then 53 until M07i was retired on 20 October 2026; release history v1.4.0), run by `npm run mutate` in a disposable copy. Every one of the 23 scored steps has at least one mutation that kills it; forgeries among them re-pin the SHA-256 they invalidated. Mutations aimed at a step other than 19 run with `PF_P1_REPLAY=off` (Step 19 capped at FLAG); the baseline and Step 19's mutations run the full replay. The release manifest records 52/52 killed, 23/23 scored steps covered, from the whole-registry run of 20 October 2026 (release history v1.4.0). Until 20 October 2026 the release manifest recorded 53/53 (the 49/49 whole-registry run below plus the four C3 entries, run on their own). Rerun on 5 October 2026: 49/49 killed, 23/23 scored steps covered. Rerun on 14 October 2026 on the tree carrying RTP-CLAIM 1.2.0 switched on: 49/49 killed, 23/23 scored steps covered. Second pass, 14–15 October 2026 (FIXPASS2 class C3, the exit-5 entries): see the release-history entry "14 October 2026 (second pass)"; the release manifest records that run.

**Deliberate artifact refresh.** After an intentional source edit, `npm ci --include=dev` and `npm run build` rebuild `verify.js` and `test.js` and their build manifest; `PF_EMIT=1 npm run verify` (`npm run report`) refreshes `outputs/verification-results.json`; `npm run release-manifest` rewrites `RELEASE-MANIFEST.json`, and `node scripts/release-manifest.mjs --check` confirms it. Step 22 counts the published Markdown files and the 64-hex tokens in them, so a documentation change that adds or removes either changes that step's detail line and needs this refresh; numerical results do not change.

## Verify a bet

Every drop resolves from four values: `serverSeedHashed` (the operator's commitment to the server seed), your `clientSeed` and `nonce` (fixed when the bet is placed), and the `serverSeed` itself. The raw `serverSeed` is withheld while it is in use and **revealed when you rotate your server seed**: rotating retires the active seed and publishes it, so every past bet placed under it becomes checkable while new bets move to the next commitment.

**0. Save the commitment before you bet.** Before your first bet under a seed, copy the active server seed hash (`serverSeedHashed`) shown in Duel's Provably Fair panel and keep the copy. After the reveal, take `serverSeed`, `clientSeed` and `nonce` from the bet/transaction record and run the two checks below in any browser console, no install needed. Check the revealed seed against the commitment you saved, not against a `serverSeedHashed` read from the bet record afterwards: the record shows which commitment the bet was served under, but a seed and hash pair produced after the bet would agree with each other just as well.

**1. The commitment held.** The revealed seed hashes to the commitment you saved before betting. Run `await verifyHash(serverSeed, savedServerSeedHashed)`:

```js
// docs/ALGORITHM.md §1.2: commitment = lowercase hex of SHA-256 over the 32 bytes the seed's 64 hex characters encode
async function verifyHash(serverSeed, savedServerSeedHashed) {  // savedServerSeedHashed = your copy from before the bet
  const seedBytes = Uint8Array.from({ length: serverSeed.length / 2 }, (_, i) => Number.parseInt(serverSeed.substr(2 * i, 2), 16));
  const sha = new Uint8Array(await crypto.subtle.digest('SHA-256', seedBytes));
  let computed = '';
  for (const byte of sha) computed += byte.toString(16).padStart(2, '0');
  console.log(computed === savedServerSeedHashed.toLowerCase() ? 'PASS' : `FAIL: got ${computed}`);
}
```

A `PASS` means the two hashes are equal: the revealed seed is consistent with the commitment you saved. The hash match does not show when the commitment was made. The assurance that the seed was fixed before your bet comes from your saved record: you kept that commitment before betting. A `PASS` against a hash taken from the bet record after the bet shows consistency only. The audit draws the same line: Step 1's 162/162 matches are consistency checks, and pre-bet timing rests on the capture's recorded rotation responses ([per-epoch commitment record](#capture-method-and-api); [P1](#load-bearing-premises)).

**2. The seeds force the slot.** Recompute the landing slot and confirm it matches the bet's recorded `final_slot`. Paste the function, then run `await computeSlot(serverSeed, clientSeed, nonce, rows)` with your values:

```js
// docs/ALGORITHM.md §2: one HMAC per row, bit = first 4 digest bytes (big-endian) mod 2, slot = sum of bits
async function computeSlot(serverSeed, clientSeed, nonce, rows) {  // rows = the board you played, 8 to 16
  const seedBytes = Uint8Array.from({ length: serverSeed.length / 2 }, (_, i) => Number.parseInt(serverSeed.substr(2 * i, 2), 16));
  const hmacKey = await crypto.subtle.importKey('raw', seedBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bits = [];
  for (let i = 0; i < rows; i++) {                                    // Step 1: row cursor i = 0 … rows − 1
    const message = new TextEncoder().encode(clientSeed + ':' + nonce + ':' + i);
    const digest = new DataView(await crypto.subtle.sign('HMAC', hmacKey, message));
    bits.push(digest.getUint32(0, false) % 2);                        // Step 2: u_i big-endian, bit_i = u_i mod 2
  }
  const slot = bits.reduce((sum, bit) => sum + bit, 0);               // Step 3: slot = number of 1 bits
  console.log('slot', slot, 'bits', bits.join(''));
  return slot;
}
```

The HMAC message is `clientSeed:nonce:cursor` (cursor is the zero-based row index), the server seed is hex-decoded to the key, and an odd first-4-bytes value moves the ball right. This is the same algorithm the suite runs against all 8,100 bets; `src/rng.ts` (`computeSlot`, `verifyHash`) implements it. The direction is confirmed by 8,100/8,100 recomputations, by Duel's own published code (E19: `position += (value % 2)`) and by the reference implementation E15.

**3. The payout.** Look up `scaling_edge[rows][risk][bracket].multipliers[slot]` in `plinkoConfig.json` for the bracket your stake falls in (bracket 0 for every captured bet; which table the server applies above bracket 0 was not tested, R-BRACKET); `win_amount = amount_currency × payout_multiplier`. The nonce counts up with each bet under the active seed; the 50-bet epochs in this dataset are the capture's rotation interval, not a Duel limit (in two epochs Duel accepted a 51st bet under the same seed, L2). Rotating reveals the seed and makes every bet placed under it checkable. The ProvablyFair.org player verifiers agree with this package on slot and path for every captured bet; the docs-site one shows a multiplier that differs from the one Duel paid on 224 bets (L5).

## Evidence

The primary evidence is the 10 April 2026 capture of 8,100 bets, its revealed seeds and the pinned config. Screenshots illustrate interface states; they do not replace the recorded responses.

| ID | File | Description |
|----|------|-------------|
| E01 | [evidence/E01-phase-a-start.png](evidence/E01-phase-a-start.png) | Phase A start: canvas card showing a seed commitment (serverSeedHashed, clientSeed) at nonce 0. Illustrative only: dated 27 February 2026, from a tracker session before the 10 April capture; the seed hash and client seed it shows appear nowhere in the audited dataset, so no recorded bet was placed under that seed and it is not pre-bet evidence for any recorded bet |
| E02 | [evidence/E02-phase-a-complete.png](evidence/E02-phase-a-complete.png) | Phase A complete: 5,400 bets collected, final seed hash, Phase A summary. Illustrative only: February 2026 tracker session (note below) |
| E03 | [evidence/E03-phase-b-start.png](evidence/E03-phase-b-start.png) | Phase B start: seed commitment for Phase B (16r/high, $0.01 bets). Illustrative only: dated 28 February 2026; the seed hash, client seed and last-bet id it shows appear nowhere in the audited dataset, so it is not pre-bet evidence for any recorded bet |
| E04 | [evidence/E04-phase-b-complete.png](evidence/E04-phase-b-complete.png) | Phase B complete: 2,000 bets at 16r/high collected. Illustrative only: February 2026 tracker session (note below) |
| E05 | [evidence/E05-phase-c-start.png](evidence/E05-phase-c-start.png) | Phase C start: seed commitment for Phase C (16r/high, $10 bets). Illustrative only: dated 28 February 2026; the seed hash, client seed and last-bet id it shows appear nowhere in the audited dataset, so it is not pre-bet evidence for any recorded bet |
| E06 | [evidence/E06-phase-c-complete.png](evidence/E06-phase-c-complete.png) | Phase C complete: 200 bets at $10 collected, Phase C summary. Illustrative only: February 2026 tracker session (note below) |
| E07 | [data/plinko-master-8100bets.json](data/plinko-master-8100bets.json) | Master dataset: 8,100 bets (A:5400, B:2000, C:200, D:500), 166 seed entries, 162 revealed, SHA-256 `3cf9359d88220bc800bb32edfe04399f55b909302262928ee3a0582715635267` |
| E08 | [outputs/verification-results.json](outputs/verification-results.json) | The 23 step results (22 PASS, 1 capture-origin flag), profile mappings and informational context |
| E09 | [outputs/determinism-log.json](outputs/determinism-log.json) | Determinism log: 8,100 verified, 0 mismatches, 0 skipped |
| E10 | [outputs/simulation-results.json](outputs/simulation-results.json) | Two-pass simulation: Pass 1 27,000,000 rounds × 27 configs; Pass 2 162 seeds × 10,000 nonces (242 seed×row combinations) |
| E11 | [plinkoConfig.json](plinkoConfig.json); [evidence/E11-plinko-config-2026-10-05.json](evidence/E11-plinko-config-2026-10-05.json) | Plinko configuration as served by Duel.com at `GET /api/v2/games/plinko/config`, kept with its `{success, data}` envelope; the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET) returned identical bytes: payout_tables, probabilities, scaling_edge (191 brackets per config, house_edge 0.001–0.02), rows {min:8, max:16}, risk_levels [low, medium, high]. That response body (HTTP 200, fetched 2026-10-05 at 12:15:57 UTC) is saved unedited as `evidence/E11-plinko-config-2026-10-05.json`: SHA-256 `78f0a39201a8c24fd1577143732e004f77e27d4d36efeedc6b3f7b93b2078fed`, 2,663,430 bytes, the same as `plinkoConfig.json`. Its request path, status, response headers and fetch time are in [evidence/E11-plinko-config-2026-10-05.json.meta.json](evidence/E11-plinko-config-2026-10-05.json.meta.json) (4,813 bytes), also unedited. Checked before committing: every string in the body is a decimal number except the three risk-level names and their three descriptions, no field holds an account, session or token value, the recorded response headers include no `Set-Cookie`, and nothing is redacted. The verifier pins and reads `plinkoConfig.json`; no step reads the dated copy and the release manifest does not hash it |
| E12 | [src/rng.ts](src/rng.ts) | HMAC-SHA256 RNG code rebuilt from the written spec E20 by an implementer who never opened Duel's code; Duel's published Verify-tab code (E19) is run against it as a second check, not used as its source (PLINKO-09): `computeSlot(serverSeed, clientSeed, nonce, rows)`, `verifyHash` |
| E13 | [tests/verify.ts](tests/verify.ts) | 23-step verification suite; runs against E07 using E11 for config |
| E14 | [src/simulate.ts](src/simulate.ts) | Two-pass Monte Carlo simulation |
| E15 | https://github.com/paulocentr/duelplinko — `src/plinko/PlinkoResultsGenerator.ts` | Duel.com Plinko reference implementation (prior audit). Direction convention `slot += int % 2` (odd = right). Not included in this deliverable; referenced for cross-check only |
| E16 | [data/plinko-master-8100bets.json](data/plinko-master-8100bets.json) (Phase D subset) | Phase D: 500 bets at $0.01, all 27 configs (18–19 bets each across 10 epochs), 10 distinct pfaudit-prefixed custom client seeds, 500/500 slot recomputation pass |
| E17 | [outputs/chi-squared-results.json](outputs/chi-squared-results.json) | Live-bet chi-squared: 26/27 configs pass at α=0.01, with per-config statistics, p-values, df and slot frequency tables |
| E18 | [outputs/rtp-convergence.html](outputs/rtp-convergence.html) | Self-contained RTP convergence chart, inline SVG since v1.2.0; cumulative average RTP across the simulated rounds against the theoretical 99.9% |
| E19 | [evidence/verify-tab/duel-verify-tab-plinko-2026-09-25.js](evidence/verify-tab/duel-verify-tab-plinko-2026-09-25.js) | Duel's own Plinko verification code: the code panel of duel.com → Provably Fair → Verify (Plinko) → Expand → Copy, copied verbatim by Paulo on 2026-09-25 and never edited. SHA-256 `8b3366d1e91edb572cac288e0a853d2b560b2cf5c4468c6848439f957465c9ce`, 2,511 bytes, 74 lines. Pinned in `src/operator-verifier.ts` with its runner `verifier-parity/operator/run-operator-verifier.cjs`, executed unmodified by Step 5 on all 8,100 captured bets (bucket and L/R path, 0 disagreements) as a second check on `src/rng.ts`, which is not derived from it (PLINKO-09). This, not E15, is the operator's published source |
| E20 | [docs/ALGORITHM.md](docs/ALGORITHM.md) | The written specification `src/rng.ts` is rebuilt from: a copy of `games/plinko/ALGORITHM.md` in the ProvablyFair.org audit framework with the spec author's workspace paths replaced by package paths or neutral wording (its header says so), written 20 October 2026 without opening Duel's code (its §8 lists every file read), each step sourced to Duel's public pages, the standard construction, Duel's public config or the 8,100 live bets; its §5 vectors are run by `tests/plinko/RngSpecTests.ts` |

| ID | File | Description |
|----|------|-------------|
| S01 | [evidence/S01-homepage.png](evidence/S01-homepage.png) | Duel.com homepage: Plinko game tile visible in Originals row |
| S02 | [evidence/S02-game-default.png](evidence/S02-game-default.png) | Plinko game interface: 12 rows, medium risk (default config) |
| S03 | [evidence/S03-game-16r-high.png](evidence/S03-game-16r-high.png) | Plinko game interface: 16 rows, high risk; 1k× edge slots, 0.2× center |
| S04 | [evidence/S04-multipliers-low.png](evidence/S04-multipliers-low.png) | Multiplier table: 16 rows, low risk; 16× edge, 0.5× center |
| S05 | [evidence/S05-multipliers-medium.png](evidence/S05-multipliers-medium.png) | Multiplier table: 16 rows, medium risk; 111× edge, 0.3× center |
| S06 | [evidence/S06-multipliers-high.png](evidence/S06-multipliers-high.png) | Multiplier table: 16 rows, high risk; 1k× edge, 0.2× center |
| S07 | [evidence/S07-licensing.png](evidence/S07-licensing.png) | Licensing footer: Immortal Snail LLC, Reg. L22982, Anjouan License ALSI-202411026-FI1 |
| S08 | [evidence/S08-fairness-overview.png](evidence/S08-fairness-overview.png) | Fairness page overview: "What is Provably Fair?" and "How it works" sections |
| S09 | [evidence/S09-fairness-verify.png](evidence/S09-fairness-verify.png) | Fairness verification tool: Plinko selected, showing Rows and Risk Level inputs |
| S10 | [evidence/S10-fairness-plinko-code.png](evidence/S10-fairness-plinko-code.png) | Fairness page Plinko source code: full `validatePlinkoResult` and `generateHMAC_SHA256` implementation (the same code, copied as text, is E19) |
| S11 | [evidence/S11-client-seed-rotation-response.png](evidence/S11-client-seed-rotation-response.png) | Seed rotation API response (`POST /api/v2/client-seed/rotate`): `client_seed` is the browser-generated value submitted by the player; the server does not assign it |

E01–E06 were recorded via the browser Canvas API during live play, with no post-processing. They are dated 27–28 February 2026, from a tracker session before the 10 April 2026 capture: none of the seed hashes, revealed seeds, client seeds or bet ids they show appears in the audited dataset (whose bet ids run from 71591629 to 71668441). They illustrate the capture tracker; they are not evidence for any recorded bet, and the timing of the commitments rests on the dataset's seed entries ([per-epoch commitment record](#capture-method-and-api)). The dataset SHA-256 can be recomputed with `shasum -a 256 data/plinko-master-8100bets.json` and is checked by Step 15.

**Exhibit image hashes (SHA-256).** Every exhibit image in `evidence/`, hashed from the bytes on disk. Recompute any row with `shasum -a 256 evidence/<file>`. This binds the published screenshots to specific bytes so a substituted image is detectable; Step 22 allows exactly the hashes that match a real file in `evidence/`.

| Exhibit | SHA-256 |
|---------|---------|
| E01-phase-a-start.png | `bc0025e7bcefdb4b85ff298aeb07f2746a75ec3185c079fccc1a78bed75c8a20` |
| E02-phase-a-complete.png | `92d79ba9d5d9b0bbedd9fa3a9b333137abdc7ee105cd5551e304dfd5c4f874f9` |
| E03-phase-b-start.png | `52a5228699b5257e7a11b7cfcfd1edea4e04820bae3ee87eea5ab9817a27935a` |
| E04-phase-b-complete.png | `9ac6aecc9e8c751be55836f2dd91b517568a6ef90cd1d946ee557e7199e9a1a3` |
| E05-phase-c-start.png | `2688e9a5b98f21255f78f1ed20079380537bc79eb7332f1c038f81648ac377a0` |
| E06-phase-c-complete.png | `823bfe9dafd49c97248b74d00f78ac1573456dd4fe868e1f5e70865716e8235b` |
| S01-homepage.png | `150da18fe698d2b8a456b63ed4a1f5126f49dd70a357fcc943c07579657ad93a` |
| S02-game-default.png | `b6103c456c696c0ae968e14196fc53480d58a9816c6a11cde79d1fbb8b06c18e` |
| S03-game-16r-high.png | `ed79c75e4495656772023d8fb495d1a1e8251088272096bbb8c9e20a405a5f55` |
| S04-multipliers-low.png | `5ae9851384607eea97b390f2fcfc86923cac2ef8f4c596873e5d277626f55d55` |
| S05-multipliers-medium.png | `7d3346dea3717ba4ab83a3dd600f719796cc8c1e9702d30e55c53070da31a6a8` |
| S06-multipliers-high.png | `8a1b0b8de59f663e24d4de9da33cf35d8371031eeda3d2c5b7db23eb35ffceee` |
| S07-licensing.png | `8d84d998502534b88f4ded793cb6c7145f05d6c844dfd0c624c9945d98905684` |
| S08-fairness-overview.png | `359fa7478e62e47a6462a435e00317feb24861991c64679ee5ed1e3270682f1a` |
| S09-fairness-verify.png | `1c2169554ee3c7b9dc536a7492eb58b7f61bf975fff44d9104604e4f2f8a6508` |
| S10-fairness-plinko-code.png | `789f8c195e65778c790819787b832d87fb648308cb8dea844bd4f78911c3cc5a` |
| S11-client-seed-rotation-response.png | `51ebd15e4cfb74b2e71aef679850320d24a0487a35f27a4bd801849caa5357b8` |
| client-seed-origin.png | `fec56a98f6cbf6d853bde6de8e16a5a63551dd6492e80a009e814020f93ccee4` |

**Client seed origin (S11).** The browser generates the client seed before any bet and submits it via `POST /api/v2/client-seed/rotate`. The server's response contains only the new `server_seed_hashed`, the `next_server_seed_hash`, the echoed `client_seed` and the reset `nonce`; the server does not generate or assign the client seed. `server_seed_hashed` is published at rotation, before the next epoch's client seed is set, and the player can rotate to any client seed at any time. Verdict: Full Pass.

## Limitations and trust

The Full Pass describes reproduction and consistency for the captured bets under the pinned config. It does not establish behaviour above bracket 0, across accounts, or the operator's seed entropy. A commitment makes substitution detectable; it does not prove unbiased seed selection, which Pass 2 screens with the power stated above. Hash matches and next-hash links are consistency checks; that each commitment was shown before its bets rests on the capture's recorded pre-bet observations, conditional on the capture's integrity (P1).

### Load-bearing premises

The premises the audit's conclusions actually rest on, and, for each, whether the captured data could have contradicted it. A premise the data could not have falsified is disclosed as such.

| # | Premise | Could the captured data contradict it? |
|---|---------|----------------------------------------|
| P1 | Each epoch's `serverSeedHashed` commits to the seed later revealed, and was shown before the epoch's bets. | **Partly.** *Consistency: yes.* The commitment step recomputes `SHA-256(serverSeed)` against the `serverSeedHashed` the epoch's bets carried for every revealed epoch, and a single mismatch hard-fails; Steps 2 and 3 check the next-hash promotions and that the hash is constant within each epoch. These are consistency checks: a seed and hash pair constructed after settlement would also pass them. *Timing: only through the capture's records.* Each epoch's commitment was recorded from the rotation response before its first bet (162/162 bet-bearing epochs by capture timestamp, measured for this release, not scored), and the first epoch's hash was already outstanding as "next" at the pre-capture reading. The data cannot show whether the capture recorded faithfully; the package assumes it did. |
| P2 | The result algorithm is HMAC-SHA256 over `clientSeed:nonce:cursor`, server seed hex-decoded as key, odd first-4-bytes moves right. | **Yes.** Every one of the 8,100 captured bets has its slot recomputed from its seeds; a wrong algorithm or convention would mismatch and fail Step 7/payout checks. It is also the operator's published algorithm: Duel's own Verify-tab code (E19) is executed on every bet by Step 5 and agrees on bucket and path. |
| P3 | `plinkoConfig.json` is the operator's real payout/probability configuration. | **Partly.** Payouts on landed cells are checked against it live; the 88 of 351 cells no captured bet reached (Step 11) rest on the pinned config plus the analytical/simulation checks, not on live evidence. The response to `GET /api/v2/games/plinko/config` in the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET) has the same bytes (E11). |
| P4 | The captured dataset is complete and unaltered since its hash was pinned at the current value (8,100 bets, contiguous nonces); the one edit in its repository history before that pin, the seeds[0] `serverSeed` fill, is disclosed under Commit-reveal lifecycle. | **Yes.** The dataset SHA-256 is pinned in `src/loader.ts`, and the nonce audit checks each epoch is sequential; a gap or edit is caught. |
| P5 | Pass 1 simulation is deterministic from the pinned `SIM_SEEDS`. | **Yes.** Step 19 replays all 27,000,000 rounds from the pinned seeds on every `npm test`: the census must match exactly and every derived figure within the reproduction tolerance (1e-14 + 1e-12·max). `npm run test:full` also regenerates the whole artifact into `outputs/run/` and diffs it field by field. |

### Declared limitations register

| ID | Limitation | Where it shows up |
|----|-----------|-------------------|
| L1 | Client-seed influence is demonstrated on the **disclosed Phase D seeds** only. Phase A–C client seeds were generated at capture time by the harness's `Math.random` (`capture/capture-auto.reference.js`) and are recorded per-bet but were not pre-committed as a disclosed generator. Every bet stays verifiable from its recorded seed. | PLINKO-06; Release history v1.3.0, client seeds disclosed. |
| L2 | Two capture-retry epochs each had a single missed nonce (a connection drop mid browser-capture). Each outcome is **reconstructed from the revealed server seed, whose SHA-256 matches the pre-bet commitment** — the commit-reveal chain determines the outcome — but the auditor did not witness it in the capture, so it is raised as a **capture-origin FLAG, not a PASS**. A capture-origin FLAG is **verdict-neutral**: the verdict stays Full Pass. Disclosed as **origin=capture**; noted, not hidden. | PLINKO-04; Step 4 (Nonce Audit), capture-origin FLAG (verdict-neutral). Rule adopted 2026-09-22: reconstructed ≠ PASS, and not against the verdict. |
| L3 | 88 of 351 multiplier cells were never landed in by a captured bet; their payout correctness rests on the pinned `plinkoConfig.json` and the analytical + simulation checks, not on live evidence. | PLINKO-11 (coverage), Step 11. |
| L4 | The Pass 1 reproduction gate compares the census (every slot count) **exactly** and derived floating-point statistics at **tolerance (1e-14 + 1e-12·max)**, not byte for byte, because a few p-values differ in their last bits across CPUs. | Reproduce the audit; Step 19; `outputs/run/diff.json`, `outputs/run/diff-simulation.json`. |
| L5 | **Finding against the ProvablyFair.org docs-site verifier, not the operator.** Its `paytables.js` is `plinkoConfig.json` `payout_tables` (351/351 cells), but Duel pays `scaling_edge[0].multipliers` (Step 8: 8,100/8,100). The two blocks differ on 118 of 351 cells by at most 1.49×10⁻⁶, so the multiplier the docs-site verifier shows differs from the one Duel paid on **224 of 8,100 captured bets** (53 cells, largest gap 1.1×10⁻⁷). Slot and path are unaffected (8,100/8,100). The live page carries the same table but prints two decimals or fewer, and none of the 8,100 printed values differs. Step 5 requires the divergence to be exactly this; a site fix must retire the declaration in `src/site-verifier.ts` and this row together. | PLINKO-24; Step 5; `src/site-verifier.ts` `DECLARED_SITE_MULTIPLIER_DIVERGENCE`. |

### Scope limitations and recommendations

These are inherent constraints of a black-box single-account audit, not findings against Duel.com.

- **R-MULTI, multi-account capture.** The audit ran from a single account. Commit-reveal is per user; it cannot rule out differential treatment across accounts. Future audits should capture from 2+ accounts in parallel, confirm per-account server seeds and check that no account receives a systematically biased table.
- **R-BRACKET, bracket boundary testing.** Only bracket-0 bets ($0.01 and $10.00) were tested. For 16r/high the bracket-0 ceiling is $335.946312864870400000. Whether the correct table is selected just below and above each threshold is not verified; future audits should straddle the ceiling.
- **Phase-boundary seed skips (resolved).** 3 phase-boundary seeds were skipped during collection; every bet is still verified (8,100/8,100) and all 166 next-seed promotions are recomputed.
- **50-bet epochs.** The checklist specifies 100-bet rotation intervals; this capture rotated the server seed itself after every 50 captured bets (`BETS_PER_EPOCH = 50` in `capture/capture-auto.reference.js`). The interval is a capture choice, not a platform constraint: Duel did not rotate a seed on its own in this capture, and in the two capture-retry epochs (L2) it accepted a 51st bet, nonce 50, under the same commitment. It does not change how any step verifies a bet; it sets the 50-nonce early window that Pass 2 Tests B and C score, whose power is stated with them.
- **Phase C size.** Phase C was a code-path check, not an RTP study; 200/200 exact matches establish the same code path and table at $10.
- **Artifacts.** The suite writes a custom JSON report rather than a Mochawesome one; no separate `payout-log.json` exists, because `outputs/determinism-log.json` gives the per-bet record and Step 7 the payout check; the simulation artifact is named `simulation-results.json` rather than the checklist's `simulation-summary.json`.

Recommendations to the operator, each grounded in a finding above:

- **REC-1 (Medium): end the scaling ladder where the maximum profit reaches $1.5m.** Above that stake each tier raises the edge without raising the maximum profit; in the pinned config, the edge on 16r/low goes from 0.1% at $99,038 to 1.93% at $101,000 for a maximum profit of about $1.5m either way.
- **REC-2 (Low): link the payout configuration from the game.** In the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET), `GET /api/v2/games/plinko/config` returned every table and bracket (E11); linking it from the fairness page lets a player check the theoretical RTP for their stake without reading network traffic.
- **REC-3 (Informational): no action on the capture-retry nonce pattern.** It is a client-side capture artifact (L2), not a server anomaly.

For players: record `serverSeedHashed` before betting and check it after the reveal, which comes when you rotate the seed; know the bracket-0 ceiling for your configuration; on 16r/high the 0.2× floor means no single bet loses the whole stake.

## Terms

**Provably fair:** a scheme in which the outcome can be verified after the fact from seeds committed before the game. **HMAC-SHA256:** keyed SHA-256; here one call per row. **Server seed:** a 64-character hex string, secret during betting and revealed on rotation; the HMAC key is its decoded bytes. **Server seed hash:** `SHA-256(hexDecode(serverSeed))`, published before bets. **Client seed:** set by the player; changing it changes every slot under the same server seed. **Nonce:** the bet's position under the active server seed, counting up from 0 until the seed is rotated. **Cursor:** the zero-based row index. **Epoch:** the bets placed under one (serverSeed, clientSeed) pair; this capture recorded 50 per epoch. **Slot:** the landing position, 0 to N on an N-row board. **RTP:** `sum(win_amount) / sum(bet_amount)`; this overview labels theoretical and observed. **Scaling edge:** the operator's progressive bracket system, house edge 0.001 to 0.02. **Chi-squared test:** observed slot counts against the binomial, with slots of expected count < 5 pooled; p-values come from the regularized incomplete gamma function in `src/stats.ts`, not the Wilson-Hilferty approximation. **Lag-1 autocorrelation / runs test:** serial-independence checks. **EC (edge case):** one of 35 numbered checks: RNG correctness (EC-1 to EC-7), statistical independence (EC-9 to EC-14), exploit resistance and code-path equivalence (EC-15 to EC-25), dataset integrity (EC-26 to EC-32), probability independence (EC-33) and simulation integrity including cherry-pick detection (EC-34, EC-35). **Hard fail:** a result that invalidates the provably fair claim regardless of others. **Capture-retry pattern:** the server processed a bet, the capture missed the response, and the retry received the next nonce.

## Release history

| Release | What changed | Verdict |
|---------|--------------|---------|
| `v1.0.0` | The original audit, June 2026. | PROVABLY FAIR — Full Pass |
| `v1.1.0` | Hardening pass, re-certified under Framework 1.0. | unchanged |
| `v1.1.1` | Errata: the pinned simulation artifact is serialised as `simulate.ts` writes it; it had been re-serialised outside the generator. No figure changed. | unchanged |
| `v1.2.0` | Reproduction gate, exit codes and artifact hygiene, below. No figure, step result or verdict changed. | unchanged |
| `v1.3.0` | Conformance pass against the Plinko game profile, below, re-certified under Framework 1.1. One new scored step, ten strengthened, and a falsifiability gate. The verdict did not change. | unchanged |
| `v1.4.0` | RNG code rebuilt from a written spec, below; Duel's Verify-tab code kept as a second check only. Final QA corrections of 21 October 2026, below. | unchanged |
| `v1.4.1` | Errata: adds `.gitattributes` (`* -text`) so a Windows git clone keeps every file byte-identical; no audit content changed. | unchanged |

### v1.4.0

- **RNG code rebuilt from a written spec (20 October 2026).** `src/rng.ts` is replaced by a module rebuilt from [docs/ALGORITHM.md](docs/ALGORITHM.md) (E20) by an implementer who read only that spec and a module-interface file and never opened Duel's code, its Verify-tab file or the earlier `src/rng.ts`. Until v1.3.0 it was ported from Duel's published Verify-tab code (E19) and cited 8 of its lines (`OPERATOR_SOURCE_CITES`); the port and the citation table are removed, with the citation check in Step 5 and the unit tests and mutation M07i, which broke a citation. Mutations M08 and M31 now target the same logic in the rebuilt module. Duel's Verify-tab code is still executed unmodified on all 8,100 bets by Step 5, as a second check, not as the source.
- **Three-way agreement, measured on integration.** The rebuilt module against the live bets: commitment 8,100/8,100, `final_slot` 8,100/8,100; against Duel's Verify-tab code: bucket 8,100/8,100, ordered L/R path 8,100/8,100; against the provablyfair.org live verifier: slot 8,100/8,100, L/R path 8,100/8,100.
- **Spec self-test.** `tests/plinko/RngSpecTests.ts` runs the spec's §5 vectors and properties against `src/rng.ts` (71 checks).
- **Player snippets rewritten from the specification.** The `verifyHash` and `computeSlot` console functions in [Verify a bet](#verify-a-bet) and the per-row pseudo-code in [Game and algorithm](#game-and-algorithm) now follow [docs/ALGORITHM.md](docs/ALGORITHM.md) §1.2 and §2 step by step (one HMAC per row, the first four digest bytes as a big-endian uint32, bit = u mod 2, slot = the number of 1 bits); `computeSlot` also prints the bits. Taken from this file and run under Node's Web Crypto, they give slot 5 (bits 11100110) and slot 9 for the two worked examples and the served `final_slot` on 8,100/8,100 bets, and `verifyHash` prints PASS for 162/162 revealed seeds. No step, figure or verdict changed.
- **Battery rerun (20 October 2026, Apple M2 Max, Node v22.23.1).** `npm run mutate`, 52 entries after M07i's retirement: 52/52 killed, 23/23 scored steps covered; the release manifest records 52/52. The verdict, the 22 PASS and one capture-origin FLAG, and the pinned simulation, determinism and chi-squared artifacts are unchanged; `outputs/verification-results.json` was re-emitted with `PF_EMIT=1 npm run verify` (the Step 5 summary and the PLINKO-09 note), `test.js` and `verify.js` rebuilt with `npm run build`.
- **Final QA corrections (21 October 2026).** No draw check, scored step status, figure or verdict changed. (1) Version labels: the header of this document and the README said "unreleased"; they now name `v1.4.0`. `RELEASE-MANIFEST.json` carried v1.3.0's signature under release v1.4.0 before v1.4.0 was signed; until the tag its `signature` was null and a `pending` line said v1.4.0 was not tagged or signed. (2) Capture files: [Capture method and API](#capture-method-and-api) linked the two runnable capture scripts, which are not in the published package because they place bets on duel.com and stay in the private workshop; it now lists only the two reference records that ship and says which statements about the runnable scripts cannot be checked from this package. (3) Mutation count: [Reproduce the audit](#reproduce-the-audit) and the PLINKO-29 note still said 53 counterexamples and that the release manifest records 53/53; `tests/mutations.json` holds 52 since M07i's retirement and the release manifest records 52/52, so both now say that. The PLINKO-30 note's exhibit range reads E01–E20. `outputs/verification-results.json` was re-emitted with `PF_EMIT=1 npm run verify` (the PLINKO-29 and PLINKO-30 notes), `test.js` and `verify.js` rebuilt with `npm run build`, and the release manifest refreshed with `npm run release-manifest`.
- **Release wording.** At tagging, the README, this overview and the release manifest stopped describing `v1.4.0` as a draft until tagged. The release manifest records `v1.4.0`, superseding `v1.3.0`, and the fingerprint of the ProvablyFair.org signing key (`signature`, `SHA256:gEujiJm2pRyq7lQsfYQfQ1r97H/J7GdaKHbOW8GtikY`), as tagged `v1.4.0`; it was refreshed with `npm run release-manifest`. No check, figure or verdict changed.

### v1.3.0

- **Falsifiability.** `npm run mutate` applies 49 counterexamples in a disposable copy, including forgeries that re-pin the hash they invalidate; each must be rejected by a named scored step. 49/49 killed, 23/23 scored steps covered. The second pass of 14 October 2026 (below) added four, for 53; the release manifest recorded 53/53 until 20 October 2026 (v1.4.0, above). The runner copies `outputs/rtp-claim-table.json` into the disposable copy, without which its baseline failed once the RTP claim table was added; the Step 10, 11 and 13 mutations expect the `[FLAG:operator]` tag those FLAG-severity steps print.
- **Step 22 (new).** Every 64-hex value in the published Markdown must resolve to a pin declared in `src/`, a value in the audited dataset or config, or an exhibit image in `evidence/`. The only other token it accepts is the all-zero placeholder, which the published Markdown does not contain.
- **Step 15** compares the dataset hash with the single pin in `src/loader.ts`, which the pre-flight guard also reads.
- **Step 19** re-derives RTP, standard error, chi-squared and p-values from the committed histograms, scores the run against theoretical RTP at 5 SE, and replays all 27,000,000 Pass 1 rounds from the pinned seeds: census exact, 691 derived figures within tolerance.
- **Step 20** replays every revealed epoch over 10,000 nonces, binds the replay to all 8,100 captured bets, re-derives Tests A and B, and adds Test C, scored on the payouts each epoch actually served, with its rule fixed before first computation and its power stated.
- **Step 5** executes the ProvablyFair.org docs-site and live verifiers, byte-pinned, on all 8,100 bets (L5), and computes the modulo bias of the direction draw from the extraction parameters: exactly 0.
- **Step 2** anchors the commitment chain at the pre-capture next-seed reading.
- **Step 6** scores the ordered path, not only the slot, against the exact Poisson-binomial null.
- **Step 17** walks all 130,816 paths across the nine boards against an integer Pascal recurrence, the closed form and the operator's table.
- **Population constants.** Epoch size and count, seed count, phase-boundary exemptions and the Phase D seed floor come from `src/loader.ts`; Step 12 is HARD_FAIL.
- **Coverage.** Step 11 lists the 88 of 351 multiplier cells no captured bet landed in.
- **Client seeds disclosed.** Phase D used `'pfaudit' + Date.now()` in base 36 (Step 18); Phase A–C seeds were generated by the capture harness (L1).
- **Step 4** reports the 2 capture-retry epochs as a capture-origin FLAG (L2), verdict-neutral.
- **RTP claim table** (RTP-CLAIM 1.2.0, scored on Step 19 since 14 October 2026): all 27 configurations at 99.900000%.
- **Documentation, October 2026.** Consolidated into README.md and this MANIFEST.md (mapping below). The player slot check uses Web Crypto and runs in a browser console. The seed-lifecycle text says the 50-bet epoch is the capture's rotation interval. The progressive house edge section adds the per-configuration thresholds and no longer says the scaling is not shown in the game UI. Recommendations revised. The seeds[0] fill is disclosed. E11 adds the dated copy of the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET), byte-identical to `plinkoConfig.json`; P3 and REC-2 cite it.
- **Stake-bracket claim narrowed (6 October 2026).** S5-7 said every stake is charged the scaling-edge bracket its amount lands in, but Step 16 reads only the pinned config and every captured bet is in bracket 0; it now says the config's ladder tiles the stake axis and that which bracket the server applies above bracket 0 was not tested (R-BRACKET). The progressive house edge section, Verify a bet, the README, the Step 16 summary and the PLINKO-39 note say the same, so the verification result was regenerated with `PF_EMIT=1 npm run verify`, `verify.js` rebuilt with `npm run build` and the release manifest refreshed; no verdict, step result or number changed.
- **Capture provenance, retry wording and zero-edge scope (6 October 2026).** The capture method named `capture/plinko-capture.reference.js` as the script behind the dataset; that is a later revision of the February 2026 tracker that rendered E01–E06. The dataset's seed entries have the shape `doRotation` in `capture/capture-auto.reference.js` writes, so the section now cites that script, gives its token refresh and drops two behaviours only the tracker has (checking the echoed rows and risk level, refreshing on HTTP 401). It also said the script intercepted `fetch` responses; both scripts send their own requests. The seed count said 4 of the 166 entries were pre-capture commitment entries, one per phase start, and that `GET /api/v2/client-seed` was read at each phase start: all 166 entries are rotation responses, and the one GET reading was taken before the first rotation. The per-bet field count reads 13, the number of fields listed. Step 4's per-epoch detail said the commit-reveal chain verifies the two reconstructed outcomes, and S5-03 said they were retroverified; both now say reconstructed and not witnessed, as Step 4's summary and L2 already did. The Zero Edge sentence, the Step 10 summary, the Step 16 zero-edge declaration and the PLINKO-17 note are scoped to the captured stakes ($0.01 and $10, bracket 0). The verification result was regenerated with `PF_EMIT=1 npm run verify`, `verify.js` rebuilt with `npm run build` and the release manifest refreshed; no verdict, step result or number changed.

### 14 October 2026 (second pass) — an RTP miss ends RTP FIGURE OVERSTATED (FIXPASS2 class C3)

No verdict, scored step status or figure changed. `outputs/verification-results.json` was re-emitted (the Step 16 summary line and its `modeCoverage.scaling_edge` text changed); `test.js` and `verify.js` rebuilt with `npm run build` (`npm run check:build` reproduces them).

- **Three claim checks no longer pre-empt the rule.** (1) The unit test "theoretical RTP is within ±0.1% of the stated 99.9% for all 27 configs" now checks each config's float derivation against the RTP table's exact row (within 1e-12); with one board paying light it used to fail `npm test` first (measured on the 14 October tree: AssertionError, 16r/high = 99.566348%). (2) Step 19 no longer fails a board whose table pays other than 1 − its bracket-0 edge (to 1e-6); `declaredRTP` stays in the derived rows. (3) Step 16 holds the declared edge to 1 − derived RTP for the brackets above bracket 0 only; bracket 0's edge is the claim, scored by RTP-CLAIM on Step 19. The brackets above bracket 0 are not in the RTP table, so a mismatch there still fails Step 16 (exit 1). **The one-board mutation does not reach exit 5 on this machine:** the pinned Pass 1 simulation carries each board's theoretical and simulated RTP, computed from the multipliers, so a lowered cell also needs `npm run simulate`, which is not run here. Measured in a copy on 14 October with the edge slots of 16 rows / high lowered to 900× (config re-pinned, RTP table and record regenerated): mocha passes, RTP-CLAIM reports RTP FIGURE OVERSTATED (true minimum 99.566348%, rows=16 risk=high), and the run ends exit 1 only through the stale Pass 1 fields of that board in Step 19 ("theoreticalRTP in the artifact differs from the committed multiplier table", the simulated RTP and the trace end) and the config pin drift in Step 22.
- **Exit-5 mutations.** `scripts/mutate.mjs` gained `regen` (in the disposable copy: the RTP table rewritten by `src/rtp-settings.ts` and re-pinned, then the committed record re-emitted with `PF_EMIT=1`), `expectExit` (an entry counts as killed only when the run also ends with that exit code) and runner `test` (mocha, then the verifier, as `npm test` runs them). `--only` takes several comma-separated substrings. New entries: MC3a (that one-board change, table and record regenerated; expected exit 1 with the stale-simulation marker, which pins down that nothing else ends the run), MC3b (the claim raised to 100.1 %; table and record regenerated; expected RTP FIGURE OVERSTATED, exit 5), and MC3as and MC3bs (the same changes without regenerating the table; expected exit 1: a committed RTP table that differs from the run, or from its pin, is a reproduction failure, miss or no miss).
- **Battery (Apple M2 Max, 12 cores, Node v22.23.1).** The whole registry, 49 entries, on 14 October 2026 before the C3 edits: 49/49 killed, 23/23 scored steps covered (above). After the C3 edits (14 October evening, `--only 'M22 ,M25 ,M26 ,M27 ,M27b ,M28 ,MC3'`) the entries naming Steps 16 and 19, the two steps the edits touched (19 is the RTP-claim step), and the four C3 entries: 10/10 killed; MC3a exit 1 with `theoreticalRTP in the artifact differs from the committed multiplier table` (the stale Pass 1 simulation, as declared), MC3b `VERDICT: RTP FIGURE OVERSTATED`, exit 5, MC3as and MC3bs exit 1 with the committed table reported as differing from the run. The one-board exit-5 path needs `npm run simulate` in the copy and was not run.

### 14 October 2026 — Methodology v1.1

No draw check, scored step status, figure or verdict changed. The dataset and the artifacts pinned in `src/artifact-pins.ts` are unchanged; the RTP-claim table, pinned in `src/rtp-settings.ts`, was rewritten and re-pinned (below).

- **Framework 1.1.** The audit is re-certified under ProvablyFair.org Framework 1.1 (decision D1); the release manifest's `framework` field and the release row above say 1.1.
- **RTP-CLAIM 1.2.0, switched on.** `src/rtp-claim.ts` is the framework's rule 1.2.0, byte-identical to `core/rtp-claim.ts` (SHA-256 `c9a9c1c4…5f131c`), and `src/rtp-claim-switch.ts` is set to true (decision D3). The outcome is scored on Step 19 (PLINKO-19): a house-side miss would be an operator-origin FLAG on that step and the verdict RTP FIGURE OVERSTATED, exit 5, never NOT PROVABLY FAIR. The claim source now names its place, the game settings (decision D2: "The edge in Duel's game settings counts"): house_edge "0.001" on scaling_edge bracket 0. Outcome: pass, as before. In `outputs/rtp-claim-table.json` only `ruleVersion` and the source wording changed.
- **Profile.** The Plinko profile version this suite cites was already 1.0.2 (decision D6 needed no change here); `outputs/verification-results.json` is unchanged.
- **S5 level.** The adversarial matrix states the S5 level received: the fairness-integrity matrix; game-integrity testing was not commissioned (decision D5).
- **Exit 5** (RTP FIGURE OVERSTATED) is added to the exit codes.
- `outputs/rtp-claim-table.json` was rewritten with `npm run rtp-claim:write` and re-pinned, `verify.js` and `test.js` rebuilt with `npm run build`, and the release manifest refreshed with `npm run release-manifest`. The mutation battery was rerun: 49/49 killed, 23/23 scored steps covered.

### v1.2.0

- **Reproduction gate.** `src/diff.ts` compares each run with the committed artifacts at 1e-14 + 1e-12; a difference beyond tolerance exits 1.
- **Committed artifacts are read-only by default.** `verify` writes to `outputs/run/`; the committed copy is refreshed only by `PF_EMIT=1 npm run verify`.
- **Exit codes carry the verdict:** 0 Full Pass, 1 hard fail or reproduction difference, 2 flag.
- **No run metadata in pinned artifacts.** `generatedAt` removed from `chi-squared-results.json` and `determinism-log.json`; re-pinned, figures unchanged leaf by leaf.
- **Self-contained convergence chart.** `outputs/rtp-convergence.html` is inline SVG and opens offline. Its ±1 SE traces, previously labelled ±2 SE, and its ± and ✓ glyphs are corrected.
- Added `LICENSE`, Node 22.x pinning (`engines.node`, `.nvmrc`) and `RELEASE-MANIFEST.json`.

### Where the former chapters went

| Former documentation | Consolidated location |
|---|---|
| `executive-summary.md`, `conclusion.md` | Conclusion and scope; README |
| `game-rules.md`, `system-architecture.md` | Game and algorithm; Dataset and capture (capture method and API); Payouts and RTP |
| `rng-algorithm-analysis.md`, `game-logic-verifiability.md` | Game and algorithm (worked examples, bias, operator source); Payouts and RTP |
| `live-parity-testing.md`, `edge-case-analysis.md` | Dataset and capture; Verification results |
| `exploit-testing.md`, `findings.md` | Verification results (S5 matrix, taxonomy, live statistics); Payouts and RTP; Limitations and trust |
| `payout-verification.md`, `rtp-analysis.md` | Payouts and RTP |
| `operator-trust-analysis.md` | Payouts and RTP (Zero Edge, progressive edge); Evidence (client seed origin); Limitations and trust |
| `recommendations.md` | Limitations and trust (scope limitations and recommendations) |
| `reproducibility.md`, README reproduce and player check | Reproduce the audit; Verify a bet |
| `evidence.md` | Evidence |
| `glossary.md` | Terms |
| `SUMMARY.md` | Contents; README |
| MANIFEST Player-verifier parity, Operator-code parity, Pass 2 statistic, premises and limitations | Verification results; Game and algorithm; Payouts and RTP; Limitations and trust |
