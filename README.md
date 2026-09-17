# Duel Plinko — Verifier

Independent verifier for the ProvablyFair.org audit of **Duel.com Plinko**.

- **Audit report:** https://audit.provablyfair.org/casino/duel/games/plinko/overview
- **Audit ID:** PF-2026-DL01
- **Audited:** April 2026
- **Algorithm:** HMAC-SHA256 (one call per row, server seed hex-decoded as key)

## What's in this repo

This is the verification codebase. It re-derives every audited round from the captured dataset and the published algorithm. The full audit report — methodology, evidence, findings, recommendations — lives on the docusaurus page linked above.

## Reproduce

```sh
git clone git@github.com:ProvablyFair-org/duel-plinko.git
cd duel-plinko
npm install
npm test
```

`npm test` runs: unit tests + verification. Expected: all green.
The pinned simulation artifact is **checked, not re-run** on the default path — that is what keeps `npm test` fast and leaves the artifact of record byte-identical. Use `npm run simulate` to regenerate it from the pinned seeds; the regenerated file records fresh run metadata, so it will not match the committed hash pin byte-for-byte.

Individual scripts:

```sh
npm run simulate   # 27M-round two-pass simulation
npm run verify     # 20-step verification of the captured dataset
```

## Dataset

- **File:** `data/plinko-master-8100bets.json`
- **SHA-256:** `3cf9359d88220bc800bb32edfe04399f55b909302262928ee3a0582715635267`
- **Bets:** 8,100 across four capture phases

## Multiplier config

- **File:** `plinkoConfig.json`
- **SHA-256:** `78f0a39201a8c24fd1577143732e004f77e27d4d36efeedc6b3f7b93b2078fed`

The verifier confirms both the dataset hash and the `plinkoConfig.json` hash before running any checks. Tampering with either file causes `npm test` to fail at startup.

## License

MIT
