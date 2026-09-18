# Duel Plinko — Verifier

Independent verifier for the ProvablyFair.org audit of **Duel.com Plinko**.

- **Audit report:** https://audit.provablyfair.org/casino/duel/games/plinko/overview
- **Audit ID:** PF-2026-DL01
- **Audited:** April 2026
- **Algorithm:** HMAC-SHA256 (one call per row, server seed hex-decoded as key)

## What's in this repo

This is the verification codebase. It re-derives every audited round from the captured dataset and the published algorithm. The full audit report — methodology, evidence, findings, recommendations — lives on the docusaurus page linked above.

## Reproduce

Runtime: **Node 22.x** (pinned in `package.json` `engines` and `.nvmrc`). The committed artifacts were produced on that line, and the last bits of a derived statistic are runtime-dependent — see the gate below.

```sh
git clone git@github.com:ProvablyFair-org/duel-plinko.git
cd duel-plinko
npm install
npm test
```

`npm test` runs: unit tests + verification. Expected: all green.
The pinned simulation artifact is **checked, not re-run** on the default path — that is what keeps `npm test` fast and leaves the artifact of record byte-identical. `npm run simulate` regenerates it from the pinned seeds in `SIM_SEEDS`, and no pinned artifact carries run metadata, so a regeneration reproduces every integer, string and count exactly. What it will not reproduce is the last bit of a few floating-point p-values: regenerated on a second machine, six differ by 1–12 units in the last place and everything else is identical, all of it inside 1e-12. That is double arithmetic across CPUs, not a difference in the result, which is why the gate is the tolerance comparison in `outputs/run/diff.json` rather than a byte-for-byte hash of derived statistics.

Individual scripts:

```sh
npm run simulate   # 27M-round two-pass simulation
npm run verify     # 21-step verification of the captured dataset
```

### The gate

`npm run verify` writes **nothing** into `outputs/`. This run's results, its determinism log, its
chi-squared table and `diff.json` go to `outputs/run/` — gitignored, a run record rather than
audit evidence — so a re-run cannot replace the evidence it scores and a disagreement between two
runs is recorded rather than resolved in favour of whichever ran last. Refreshing the committed
copy is the separate, deliberate `PF_EMIT=1 npm run verify`.

`diff.json` compares this run against the committed artifacts field by field and records the
runtime it ran on. The comparison is at tolerance — **1e-14 absolute + 1e-12 relative**, and two
distinct integers never agree — so a p-value that moved by a unit in the last place is recorded as
`withinTolerance` and not scored, while anything outside that bound is a different result. This is
the measured case, not a hypothetical: on 18 September 2026 a rerun of the pinned-seed simulation
moved one cherry-pick p-value from `0.7730031061099987` to `0.7730031061099988` and left every
other leaf of the artifact identical. The SHA-256 pins in `src/artifact-pins.ts` are unchanged and
remain the identity of the committed bytes; a pin is never rewritten to make a regeneration agree
with it.

Exit codes are the verdict, so nothing automated can read a Conditional Pass as clean:

| Code | Meaning |
|------|---------|
| `0` | `PROVABLY FAIR — Full Pass`, and this run reproduces the committed artifacts |
| `1` | at least one HARD_FAIL, **or** a reproduction difference beyond tolerance |
| `2` | at least one FLAG — `PROVABLY FAIR — Conditional Pass` |

## Dataset

- **File:** `data/plinko-master-8100bets.json`
- **SHA-256:** `3cf9359d88220bc800bb32edfe04399f55b909302262928ee3a0582715635267`
- **Bets:** 8,100 across four capture phases

## Multiplier config

- **File:** `plinkoConfig.json`
- **SHA-256:** `78f0a39201a8c24fd1577143732e004f77e27d4d36efeedc6b3f7b93b2078fed`

The verifier confirms both the dataset hash and the `plinkoConfig.json` hash before running any checks. Tampering with either file causes `npm test` to fail at startup.

## Release history

| Release | What changed | Verdict |
|---------|--------------|---------|
| `v1.0.0` | The original audit, June 2026. | PROVABLY FAIR — Full Pass |
| `v1.1.0` | Hardening pass, re-certified under Framework 1.0. | unchanged |
| `v1.1.1` | Errata: the pinned simulation artifact had been re-serialised outside `simulate.ts`, so its bytes could not be reproduced by the generator that is supposed to produce them. Restored with the package's own writer. No figure changed. | unchanged |
| `v1.2.0` | Release hygiene, below. **No figure, step result or verdict moved.** | unchanged |

### v1.2.0 — errata

Nothing in the audit's findings changed. What changed is that several things the package
*claimed* are now things it *does*:

- **The reproduction gate exists.** §Reproduce above described the gate as "the tolerance
  comparison in `outputs/run/diff.json`". That file, the comparator and the run directory did not
  exist; the sentence described a check nothing performed. `src/diff.ts` implements it, `verify`
  writes the diff, and a difference beyond tolerance now exits 1.
- **`verify` no longer rewrites the artifact it scores.** It wrote
  `outputs/verification-results.json` in place on every run, so a run that disagreed with the
  committed evidence destroyed the evidence of the disagreement. This run goes to `outputs/run/`;
  the committed copy is refreshed only by `PF_EMIT=1 npm run verify`.
- **The verifier's exit code carries the verdict.** It exited 0 on `NOT PROVABLY FAIR`, so
  anything automated read a failed audit as a clean one. FAIL now exits 1 and FLAG exits 2.
- **Run metadata is out of the pinned artifacts.** `chi-squared-results.json` and
  `determinism-log.json` each carried a `generatedAt`, which makes a pinned file impossible to
  reproduce even when every figure in it is identical. Removed at the writer and re-pinned in
  `src/artifact-pins.ts`; the figures inside are unchanged, verified leaf by leaf.
- **The convergence chart is self-contained.** `outputs/rtp-convergence.html` loaded Chart.js
  from a public CDN, so a pinned artifact rendered only for a reader who was online, and what
  they saw depended on a third party. It is inline SVG now, and it opens offline. Two defects in
  the replaced markup are fixed rather than carried: the ±1 SE traces were labelled "+2 SE" and
  "-2 SE", and the ± and ✓ glyphs were double-escaped and reached readers as literal text.
- **`npm run verify` is a 21-step suite**, not the 20 §Reproduce used to state.
- Added `LICENSE` (the README already declared MIT), `engines.node` / `.nvmrc` pinning Node 22.x,
  and `RELEASE-MANIFEST.json`. Removed the empty `results/` and `results/merged/` directories,
  which nothing wrote to.

The interim commits dated 17 and 18 September 2026 on `main` are superseded by this release and
remain in history; nothing was reverted or force-pushed.

## License

MIT
