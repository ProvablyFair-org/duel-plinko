# Duel.com Plinko: clean-room algorithm specification

> Package copy of the ProvablyFair.org audit framework's `games/plinko/ALGORITHM.md`.
> It differs from that file only where the file named locations or tracking items
> in the spec author's workspace: those now read as paths inside this package or as
> neutral wording. No rule, number, vector or source note was changed.

Written 20 Oct 2026 for the ProvablyFair.org audit of Duel.com Plinko.

This document is the only input an implementer needs to rebuild Duel Plinko's
outcome derivation and settlement. It was written without opening any Duel
source code, any port of it, or any copy of Duel's in-site verifier code (see
§8 for the files and pages read). Every step names where it came from:

- **PAGE**: Duel's public pages, quoted with location and date.
- **STANDARD**: the standard provably-fair construction used across the
  industry (commit to SHA-256 of a server seed; HMAC-SHA256 keyed by the server
  seed over `clientSeed:nonce:cursor`; bytes to integer).
- **DATA**: fixed by testing the standard candidates against the 8,100 live
  bets in `data/plinko-master-8100bets.json`
  (captured 10 Apr 2026). The data chose; Duel's code did not.
- **CONFIG**: Duel's public plinko config, `GET /api/v2/games/plinko/config`,
  captured 5 Oct 2026 as
  `evidence/E11-plinko-config-2026-10-05.json`
  (fetch metadata in the `.meta.json` beside it).

The public pages name the inputs only. Almost all of §2 was settled by DATA.

---

## 1. Inputs and commitment

### 1.1 Inputs

| Input | Form | Source |
|---|---|---|
| `serverSeed` | 64 lowercase hex characters (32 bytes); secret until the seed pair is rotated | PAGE: "Server seed - a random string provided by us" (S08; live page 20 Oct 2026). Form: DATA (all 166 revealed seed records are 64 hex chars) |
| `clientSeed` | text string chosen or accepted by the player | PAGE: "Client seed - a random string provided by you" (S08). DATA: default seeds are 16 chars of `A–Z a–z 0–9`; Phase D player-set seeds look like `pfauditmnta73k8` |
| `nonce` | non-negative integer, 0 on the first bet after a rotation, +1 per bet | PAGE: "Nonce - a number that increases with each bet" (S08); `"nonce": 0` in the rotation response (S11). DATA: 160 of 162 epochs carry nonces exactly 0–49; two carry 0–50 with one nonce absent (20 and 32), i.e. one bet each not captured |
| `rows` | integer 8…16 | PAGE: "Number of Rows" slider, 16 shown (S03, S04). CONFIG: `rows.min = 8`, `rows.max = 16` |
| `risk` | `low` / `medium` / `high` | PAGE: Risk "Low / Medium / High" (S03, S04). CONFIG: `risk_levels` ids 1, 2, 3 |
| `amount` | stake, decimal | DATA (`request.amount`: `0.01` or `10`) |

### 1.2 Commitment

PAGE (duel.com/provably-fair, Overview tab; S08, and rendered 20 Oct 2026 with
GET and no login):

> "We then send you the hex-encoded SHA-256 hash of our server seed before you
> place your bets, to prove we won't change our minds."
>
> "After the game, we reveal the unhashed Server Seed. You can verify that: The
> server seed matches the original hash. The combined seeds generated the exact
> result you played."

The page does not say which bytes are hashed. Spec:

```
commitment = lowercase_hex( SHA-256( hex_decode(serverSeed) ) )
```

i.e. hash the **32 raw bytes** that the 64 hex characters encode, not the 64
ASCII characters.

- SOURCE: PAGE (SHA-256, hex output) + DATA for the input encoding.
- Candidates tried: SHA-256 over the ASCII hex string → **0 / 162** bet
  commitments resolve; over the hex-decoded 32 bytes → **162 / 162**, covering
  **8,100 / 8,100** bets.
- Verification: every bet's `server_seed_hashed` must equal `commitment` of a
  revealed seed. **Pair seeds to bets by hashing, not by record position**: a
  rotation record in the capture carries the revealed *previous* seed next to
  the *new* active hash (only record 0 reveals the seed of its own active hash;
  record k reveals the seed for record k−1's active hash on 162 of 165
  transitions, the other records repeat a reveal).
- Forward chain: each rotation record's `nextServerSeedHash` equals the next
  record's active `serverSeedHashed` on 165 / 165 transitions. S11 shows the
  same two fields (`server_seed_hashed`, `next_server_seed_hash`) in Duel's
  rotation response.

---

## 2. Outcome derivation

PAGE gives only the inputs:

> "Then we combine all of these values to generate a random result for each
> round: Fair result = Server seed + Client seed + Nonce" (S08; same text on the
> live page 20 Oct 2026)

The outcome of a drop is `slot`, an integer 0…`rows` (the bucket index counted
from the left of the board in the CONFIG tables). The ball makes one binary
decision per row; `slot` is the number of decisions equal to 1.

### Step 1: one HMAC per row

```
key = hex_decode(serverSeed)                                   # 32 bytes
for i in 0, 1, …, rows − 1:                                    # i = row cursor
    message_i = UTF-8( clientSeed + ":" + decimal(nonce) + ":" + decimal(i) )
    digest_i  = HMAC-SHA256(key, message_i)                     # 32 bytes
```

Example message: `mzYqdNQIyYadXPtz:0:0`, then `mzYqdNQIyYadXPtz:0:1`, …

- `decimal(x)` is plain base 10: no padding, no sign, no separators.
- The cursor starts at **0** and there is **one HMAC per row** (rows = 16 → 16
  HMACs). Only the first 4 bytes of each digest are used.
- SOURCE: STANDARD (HMAC-SHA256, server seed as key, `clientSeed:nonce:cursor`
  as message) + DATA for key form, message format, cursor base and
  digest-per-row.

### Step 2: bit per row

```
u_i   = digest_i[0..3] read as an unsigned 32-bit BIG-ENDIAN integer
bit_i = u_i mod 2                     # = lowest bit of digest_i[3]
```

- No rejection sampling is needed: 2^32 is even, so `u mod 2` is exactly
  unbiased (P(1) = 2^31 / 2^32 = 1/2). This is the bias bound PLINKO-08 asks
  for: bias 0.
- SOURCE: DATA.

### Step 3: slot

```
slot = bit_0 + bit_1 + … + bit_{rows−1}          # 0 ≤ slot ≤ rows
```

`slot` is the zero-based index into the multiplier list for (`rows`, `risk`)
in §3. `slot = 0` means every bit is 0.

- SOURCE: DATA (`final_slot`), with the CONFIG as a consistency check: the
  served multiplier equals `multipliers[slot]` on 8,100 / 8,100 (§3), and the
  CONFIG `probabilities[rows][risk][k]` equal `C(rows, k) / 2^rows` exactly for
  all 351 cells, which is the distribution this construction produces.
- The data records only the slot, not the path. Which bit means "left" or
  "right" on screen, and the order of the rows, do not change `slot` and are not
  determined (O2).

### Candidates tried (all on the full 8,100 bets unless marked)

| Construction | Match |
|---|---|
| **key = hex-decoded seed; one HMAC per row, msg `c:n:i`, i = 0…rows−1; bit = u32 BE (first 4 bytes) mod 2; slot = sum** | **8,100 / 8,100** |
| same, slot = rows − sum (mirrored) | 1,158 |
| same, bit = u32 little-endian mod 2 | 1,199 |
| same, bit = first byte ≥ 128 (≡ 4-byte float ≥ 0.5) | 1,229 |
| same, bit = last digest byte mod 2 (whole digest parity) | 1,292 |
| same, bit = (u32 mod 10001) mod 2 (Dice-style roll parity) | 1,264 |
| same, key = 64-char ASCII hex string | 1,298 |
| same, cursor i = 1…rows | 3,953 (the bits for i = 1…rows−1 are shared, hence above chance) |
| one byte stream from msg `c:n:cursor` (cursor 0,1,…), consecutive 4-byte chunks per row, bit = u32 BE mod 2 / float ≥ 0.5 / u32 LE mod 2, either orientation | ≤ 1,395 |
| single HMAC msg `c:n` (and `c:n:0`, `c-n`, `n:c`, `cn`), either key form: first u32 or 52-bit float through the binomial CDF; popcount of the low/high `rows` bits of u32 or the whole digest; u32 mod 2^rows through the CDF | ≤ 1,369 |
| first 300 bets only: 1,260 combinations of {HMAC-SHA256, HMAC-SHA512, key/message swapped, plain SHA-256/512 of `s:c:n[:i]`, `scn`, `s-c-n`} × {byte, bit, hex-nibble, 4-byte float, 52-bit float extractions, per-digest and streamed} | winner 300 / 300; the next best 161 / 300 |

Chance level for a wrong construction is roughly 1,300 / 8,100 (the probability
that two independent binomial draws on the same board coincide).

---

## 3. Win condition and payout

Plinko has no win/lose decision: every drop pays `amount × multiplier`, and
the multiplier depends on `rows`, `risk`, `slot` and the stake tier.

### 3.1 Multiplier lookup

```
tiers = CONFIG.data.scaling_edge[str(rows)][risk]      # 191 entries per (rows, risk)
tier  = the entry with  Decimal(min_bet) ≤ amount < Decimal(max_bet)
multiplier = tier.multipliers[slot]                     # decimal string, 8 decimal places
```

- SOURCE: CONFIG (table) + DATA. The served `payout_multiplier` string equals
  `scaling_edge[rows][risk][tier].multipliers[slot]` on **8,100 / 8,100** bets.
  All 8,100 bets fall in tier 0 (`house_edge "0.001"`, `min_bet 0`), including
  the 200 Phase C bets at stake 10 (tier 0 for 16/high has
  `max_bet 335.946312864870400000`).
- Use `scaling_edge`, **not** the top-level `payout_tables`: `payout_tables`
  matches only **7,272 / 8,100**. It differs from tier 0 in 118 of 351 cells,
  by at most 0.00000149 (e.g. 16/high slot 0: `1009.33110512` vs tier-0
  `1009.33110594`, which is what was paid).
- Tier edges run from 0.001 to 0.02 across the 191 tiers. Every tier table in
  the CONFIG is left/right symmetric (5,157 / 5,157). Tier-0 RTP,
  `Σ C(rows,k)/2^rows × m_k`, lies between 0.9989999975 and 0.9990000023
  across the 27 configs (exact rational sum of the 8-dp multipliers).
- PAGE: the game page labels the game "Zero Edge" (S03, S04). The edge in the
  table actually paid on every captured bet is 0.1 %. The board shows rounded
  labels ("1k", "131", "26x", "0.2x" on 16/high, S03; "16x" … "0.5x" on
  16/low, S04), consistent with the tier-0 table.

### 3.2 Payout

```
win_amount = amount × multiplier            # exact decimal product, no rounding
```

- With a 2-dp stake and an 8-dp multiplier the product is exact at ≤ 10
  decimals. DATA: exact decimal product equals the served `win_amount`
  numerically on **8,100 / 8,100** (served strings drop trailing zeros:
  `0.005046251` for 0.0050462510). Compare numerically, not as strings.
- No rounding or truncation rule is exercised by the data (O4).
- SOURCE: STANDARD (stake × multiplier) + DATA.

### 3.3 Fields an implementation must not read

`final_slot`, `payout_multiplier`, `win_amount` and `effective_edge` are the
operator's claims, to be checked. The derivation reads only `serverSeed`,
`clientSeed`, `nonce`, `rows`, `risk`, `amount` and the CONFIG.

---

## 4. Source per step (summary)

| Step | Source | Evidence |
|---|---|---|
| Inputs: server seed, client seed, nonce | PAGE | S08 / live overview page, 20 Oct 2026 |
| Rows 8–16, risk low/medium/high | PAGE + CONFIG | S03, S04; E11 `rows`, `risk_levels` |
| Commitment = SHA-256, hex output | PAGE | S08 "hex-encoded SHA-256 hash of our server seed" |
| Hash input = hex-decoded 32 bytes | DATA | 162/162 commitments (ASCII form 0/162) |
| HMAC-SHA256, key = hex-decoded server seed | STANDARD + DATA | 8,100/8,100 (ASCII key 1,298) |
| One HMAC per row, message `clientSeed:nonce:i`, i = 0…rows−1 | STANDARD + DATA | 8,100/8,100 (i from 1: 3,953; streamed chunks ≤ 1,395) |
| bit = first 4 bytes, big-endian u32, mod 2 | DATA | 8,100/8,100 (5 other bit rules ≤ 1,292) |
| slot = number of 1-bits | DATA (+ CONFIG binomial probabilities) | 8,100/8,100; mirrored 1,158 |
| multiplier = CONFIG scaling_edge[rows][risk][tier].multipliers[slot] | CONFIG + DATA | 8,100/8,100 (payout_tables 7,272); tier 0 only |
| win_amount = amount × multiplier, exact | STANDARD + DATA | 8,100/8,100 |

---

## 5. Test vectors (from the dataset)

Each vector is copied from `plinko-master-8100bets.json`; the server seed is
the revealed seed whose SHA-256 (of the decoded bytes) equals the bet's
`server_seed_hashed`. `u32` is the first four bytes of `digest_i`, big-endian.
All five fall in tier 0 (`house_edge 0.001`).

**V1: bet 71616568** (Phase A, 8 rows, low, nonce 0)
```
serverSeed  b092c51c7b51b3a3ba4e387dfec1c9381103603d161a6a7553f7af4aeda85afe
commitment  00f28fa3606fcc7734b24ed4a3a694b719f28850c22c09bcd41e137602e4934f
clientSeed  mzYqdNQIyYadXPtz   nonce 0   rows 8   risk low   amount 0.01
digest_0 (msg "mzYqdNQIyYadXPtz:0:0")
            4803f49fa779e5c671ce2524bbe04c11034626d85fe9449c7683415b38480a19
u32 i=0..7  1208218783 1831192550 3550515791 3798420359 362664949 2066711318 4282547452 64191362
bits        1 0 1 1 1 0 0 0   → slot 4
multiplier  0.50462510         win_amount 0.0050462510 (served "0.005046251")
```

**V2: bet 71648388** (Phase B, 16 rows, high, the highest multiplier in Phase B)
```
serverSeed  3dde68589b9ab1511122d6debffb0258c95297430bfc8e186a71c5bc75117565
commitment  74481b1c82e0f46b8b0a98d639aa5170d5d174364e74e1de34ee15766b5870b6
clientSeed  iWWhWwBvVIA2kVuy   nonce 19   rows 16   risk high   amount 0.01
digest_0 (msg "iWWhWwBvVIA2kVuy:19:0")
            a376d113f0c4531fdefd2d480f4e5b0cec96492810f02fb2a056361d88a74fb8
u32 i=0..15 2742472979 3171529583 3496961629 2483695908 943258331 1685673677 2045430745 1813647369
            1420783483 2029789869 2724053949 1950308245 661958641 3207574751 1421442009 1143409021
bits        1 1 1 0 1 1 1 1 1 1 1 1 1 1 1 1   → slot 15
multiplier  131.21304378       win_amount 1.3121304378
```

**V3: bet 71663205** (Phase C, stake 10, 16 rows, high)
```
serverSeed  0e135f783cdad6a66406431391a4a03bf32c647d57a642b6a097c6bdd3a9f50a
commitment  3b7dc18e27c4539a681ca43b452efca593d5afff608066c5787cc65127ea9a2f
clientSeed  qea1EWzIkyI305S0   nonce 45   rows 16   risk high   amount 10
digest_0 (msg "qea1EWzIkyI305S0:45:0")
            bbfefa9ca97ada9c741dec567dc5b0c197f16c090074aefe738a227c29659852
u32 i=0..15 3154049692 3278990932 44990447 1187219136 237728132 2073096196 4235419598 3982105512
            246695367 2942818124 253749286 3096407030 457221794 4129591772 902742531 1338334078
bits        0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0   → slot 3
multiplier  9.08397996         win_amount 90.83979960 (served "90.8397996")
```

**V4: bet 71663323** (Phase D, player-set client seed, 12 rows, low)
```
serverSeed  b2b86a583484b0589d1d033201e28f166c68447a9d3a47e0cf48dc9c98cbe821
commitment  debfede46cc0af86346d04057d2ee79879b97099807f62874f132f4f023b4b12
clientSeed  pfauditmnta73k8   nonce 12   rows 12   risk low   amount 0.01
digest_0 (msg "pfauditmnta73k8:12:0")
            fc51959ea355b602e3a25dd19581f2bcd0d70d6e85786e2b1fea6786af3a92a4
u32 i=0..11 4233205150 3300415547 556610075 3824352718 3687121655 3720121882 2758423338 2187888329
            3599665473 1391571607 1927821513 2421143690
bits        0 1 1 0 1 0 0 1 1 1 1 0   → slot 7
multiplier  1.00929999         win_amount 0.0100929999
```

**V5: bet 71594269** (Phase A, 10 rows, medium; served `effective_edge` 0, see O3)
```
serverSeed  db449f96787bd94cc2b347cd8cac1048f300ebcc2f649ca7efb7e9980559b42c
commitment  c88889ae43c8166214e28e2a507512aa90272d1cad93b6b24e2205f3dd6da2ba
clientSeed  p0ycgadmrO8Tuh6x   nonce 16   rows 10   risk medium   amount 0.01
digest_0 (msg "p0ycgadmrO8Tuh6x:16:0")
            242655271aa9956f7ebed362739c871654b1355e70d997f1ca129eda1caaa0ce
u32 i=0..9  606491943 3812509833 296721300 3732610432 826525807 1870318947 3112344645 2529724738
            2275667136 3049930505
bits        1 1 0 0 1 1 1 0 0 1   → slot 6
multiplier  0.60602844         win_amount 0.0060602844
```

In all five, slot, multiplier and win_amount equal the served `final_slot`,
`payout_multiplier` and `win_amount`.

---

## 6. Open points the public sources do not settle

- **O1: the public page names no algorithm.** "Fair result = Server seed +
  Client seed + Nonce" does not say HMAC, the key form, the separator, the row
  cursor or the bit rule. Everything in §2 rests on STANDARD + DATA. No
  independent check against Duel's Verify page was made: its result panel
  (S09, empty) was not exercised, and the plinko code screenshot was not
  opened (§8).
- **O2: path orientation and row order.** The capture records only
  `final_slot`. Whether bit 1 means a bounce to the right, and whether cursor
  i = 0 is the top row, do not affect the slot and are not determined. A
  verifier that draws the path must state its own convention.
- **O3: `effective_edge`.** The served field is 0.1 on 7,563 bets and 0 on 537
  bets, scattered across all phases, configs and nonces, with no relation to
  the slot found. On all 537 the paid multiplier is still the tier-0
  (`house_edge 0.001`) table entry. The field does not enter settlement in
  this spec; what it reports is not settled.
- **O4: stake tiers and rounding.** Only tier 0 (0.1 %) was exercised. The
  boundary rule (`min_bet ≤ amount < max_bet`) is assumed; the currency basis
  of `amount` for tier selection (USD value or token amount) is not settled.
  Higher tiers would produce products that may need rounding; the rule is not
  witnessed.
- **O5: config timing.** The CONFIG was captured 5 Oct 2026, the bets on
  10 Apr 2026. It matches all 8,100 bets, but the config live on 10 Apr was
  not captured. The meaning of the top-level `payout_tables` (which differs
  from tier 0 in 118 cells and was not what was paid) is not settled.
- **O6: client-seed encoding beyond ASCII.** UTF-8 is the assumption; all
  captured client seeds are ASCII.
- **O7: missing nonces.** Two epochs (hashes `6a4a4aff75cf…`, `6f70b8229ebc…`)
  carry nonces 0–50 with 20 and 32 absent respectively: a bet per epoch was
  placed but not captured. The derivation is unaffected; the cause is a
  capture matter, not part of this spec.
- **O8: "Zero Edge" label vs 0.1 % table.** The UI says "Zero Edge" (S03, S04);
  every captured bet was paid from the 0.1 % tier. Stated here as a fact for
  the report, not settled by this spec.

---

## 7. Reproduction of this spec

The spec was implemented, independently of any audit package, in a throwaway
script (`spec_check.py`, outside the repo) and run on every bet:

```
commitment SHA256(hexdecode(serverSeed)) resolves 162/162 bet hashes, covering 8100/8100 bets (ASCII-hex form: 0/162)
slot = sum over rows i=0..rows-1 of bit(HMAC(key=bytes, 'c:n:i')), bit=u32be_parity: 8100/8100  (mirrored: 1158/8100)
slot = sum over rows i=0..rows-1 of bit(HMAC(key=bytes, 'c:n:i')), bit=u32le_parity: 1199/8100  (mirrored: 1286/8100)
slot = sum over rows i=0..rows-1 of bit(HMAC(key=bytes, 'c:n:i')), bit=byte0>=128: 1229/8100  (mirrored: 1337/8100)
slot = sum over rows i=0..rows-1 of bit(HMAC(key=bytes, 'c:n:i')), bit=float4>=0.5: 1229/8100  (mirrored: 1337/8100)
slot = sum over rows i=0..rows-1 of bit(HMAC(key=bytes, 'c:n:i')), bit=digest_parity: 1292/8100  (mirrored: 1275/8100)
slot = sum over rows i=0..rows-1 of bit(HMAC(key=bytes, 'c:n:i')), bit=u32mod10001_parity: 1264/8100  (mirrored: 1245/8100)
slot = sum over rows i=0..rows-1 of bit(HMAC(key=ascii, 'c:n:i')), bit=u32be_parity: 1298/8100  (mirrored: 1264/8100)
slot = sum over rows i=0..rows-1 of bit(HMAC(key=bytes, 'c:n:i+1')), bit=u32be_parity: 3953/8100  (mirrored: 908/8100)
multiplier string == E11 scaling_edge[rows][risk][tier by amount].multipliers[slot]: 8100/8100; == E11 payout_tables[rows][risk][slot]: 7272/8100
tiers used (house_edge, tier index): {('0.001', 0): 8100}
win_amount == amount x multiplier (exact decimal, numeric compare): 8100/8100
served effective_edge vs 100*tier house_edge: {(0.1, 0.1): 7563, (0, 0.1): 537}
config probabilities equal C(rows,k)/2^rows exactly: 351 / 351
tier-0 RTP range over 27 configs: min 0.9989999975 max 0.9990000023
symmetric tier tables: 5157 / 5157
```

Earlier candidate sweeps (single-digest and streamed constructions, §2 table)
were run with separate throwaway scripts in the same directory; their best
non-winning scores are quoted in the table.

---

## 8. Files and pages read while writing this spec

Read: `evidence/` S03, S04, S08, S09 (Verify tab
screenshot: form fields only; its code panel shows only the input-value lines
`const clientSeed = ''` … `const rows = 8`, no logic), S11 (PNG);
`E11-plinko-config-2026-10-05.json` and its `.meta.json`;
`data/plinko-master-8100bets.json`;
the audit framework's `games/plinko/profile.json`;
the audit framework's `games/dice/ALGORITHM.md` (model of shape);
live pages `https://duel.com/provably-fair` (Overview tab text) and
`https://duel.com/plinko` (page text: no rules or fairness prose), rendered
20 Oct 2026 with GET and no login (a plain HTTP GET of both returns only the
JavaScript shell).

Not opened: `S10-fairness-plinko-code.png` (by its name it shows Duel's plinko
verification code), any `verify-tab`, `verifier-parity`, `src/`, `tests/`,
`scripts/`, `capture/`, `verify.js`, `test.js`, `MANIFEST.md`, `README.md` or
`plinkoConfig.json` of any Duel package, any saved Duel JS bundle, or Duel's
live Verify tab.
