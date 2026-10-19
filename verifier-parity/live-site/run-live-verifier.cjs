#!/usr/bin/env node
'use strict';
/**
 * Runs the LIVE ProvablyFair.org /verify-bets page's own verifier code on a batch of Plinko rounds.
 *
 *   node run-live-verifier.cjs <chunk-dir> [jobs.json]      → JSON on stdout (jobs from stdin when omitted)
 *
 * jobs: { casinoName: "Duel.com", rounds: [{ id, serverSeed, clientSeed, nonce, rows, risk }] }
 *
 * Ported from pf-duel-workspace/games/mines/verifier-parity/live-site/run-live-verifier.cjs (same
 * three chunks, same harness); only the call in (4) and the verifier's module closure differ.
 *
 * WHAT RUNS. Three files downloaded from https://www.provablyfair.org/_next/static/chunks/, byte for
 * byte, never edited: the site's Turbopack runtime (turbopack-828b80f561e7c968.js), the chunk that
 * carries the verify-bets page module 7721 with its crypto dependencies (34934e0e762aa37e.js), and
 * the chunk that carries the `process` shim that the crypto dependency requires (4f34301b2f166201.js).
 * They are evaluated with node:vm in one context, in page order, by the site's OWN runtime. Module
 * 7721 is then instantiated by that runtime exactly as the page would instantiate it.
 *
 * WHAT IS NOT THE SITE'S CODE (the whole harness surface, listed so it can be reviewed):
 *   1. browser globals the runtime reads while registering a chunk: `self`, `window`, `document`
 *      (currentScript.getAttribute → the chunk's own /_next/static/chunks/ URL), and the Web APIs
 *      the verifier calls — `crypto` (Node's WebCrypto, the same W3C API the browser provides; the
 *      Duel Plinko path signs every row with crypto.subtle HMAC-SHA-256), TextEncoder, TextDecoder.
 *   2. inert stand-ins for the modules those three chunks REFERENCE but do not carry (React, Radix
 *      UI, Next.js internals — the page's rendering). Each stand-in is registered under its module id
 *      through the runtime's own `TURBOPACK.push`. A stand-in returns itself for every property and
 *      call, so a stand-in reached by the verifier would yield a non-string and FAIL the result check
 *      below; the id list of stand-ins is reported, and the verifier's own dependency closure
 *      (VERIFIER_MODULES) must contain none of them.
 *   3. a one-shot observer on Function.prototype.bind inside the vm context: the page module's only
 *      handle on its verifier is `a_ = aw.VERIFY.bind(aw)`, made at module top level; the observer
 *      records the `this` of that one bind (an object with verifyHouseBetsGame AND verifyDuelsGame)
 *      and is removed straight after instantiation. It changes no argument and no return value.
 *   4. the call. For each round the runner makes the call the page's "Verify Result" button makes
 *      (handler `D` in module 7721): VERIFY({ casinoName, gameName: "plinko", serverSeed, clientSeed,
 *      nonce: Number(nonce), plinkoRisk, plinkoRows }) — the page also passes minesCount, kenoRisk,
 *      beefMode, diceMode and diceTarget, which verifyDuelsGame destructures away on the Plinko branch
 *      — and returns the four strings the page prints: `direction` ("Ball path: L R … → Slot k"),
 *      `buckets` ("Bucket k of n"), `multiplier` (the paytable cell, display-rounded, "0.30x") and
 *      `serverSeedHash`. Parsing them is the caller's job (src/live-site-verifier.ts).
 * Exit 0 with JSON results; exit 1 if the module will not load, the verifier is not captured, or a
 * stand-in sits in the verifier's closure.
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const RUNTIME_CHUNK = 'turbopack-828b80f561e7c968.js';
const CHUNKS = ['34934e0e762aa37e.js', '4f34301b2f166201.js'];
const PAGE_MODULE = 7721;
/** Modules the Duel Plinko derivation executes outside module 7721: crypto-browserify createHash
 *  (29719, for the printed serverSeedHash) and its buffer (47980) and process (17442 → 31113)
 *  dependencies. The row HMAC itself is crypto.subtle, a harness global (1). */
const VERIFIER_MODULES = [29719, 47980, 17442, 31113];

function fail(msg) { process.stderr.write(`live-site verifier: ${msg}\n`); process.exit(1); }

const [chunkDir, jobsPath] = process.argv.slice(2);
if (!chunkDir) fail('usage: run-live-verifier.cjs <chunk-dir> [jobs.json]');
const jobs = JSON.parse(fs.readFileSync(jobsPath || 0, 'utf8'));
if (!jobs || !Array.isArray(jobs.rounds) || typeof jobs.casinoName !== 'string') fail('jobs must be { casinoName, rounds: [...] }');

const ctx = { console, URL, TextEncoder, TextDecoder, crypto: globalThis.crypto, setTimeout, clearTimeout, queueMicrotask };
ctx.globalThis = ctx; ctx.self = ctx; ctx.window = ctx;
ctx.document = { currentScript: null, querySelectorAll: () => [], createElement: () => ({}), head: { appendChild() {} }, cookie: '' };
vm.createContext(ctx);

const idsIn = src => {
  const c = { document: undefined }; c.globalThis = c; vm.createContext(c); vm.runInContext(src, c);
  const ids = []; for (const arr of c.TURBOPACK) for (let i = 1; i < arr.length; i++) if (typeof arr[i] === 'number') ids.push(arr[i]);
  return ids;
};
const loaded = new Set(); const referenced = new Set();
const load = f => {
  const src = fs.readFileSync(path.join(chunkDir, f), 'utf8');
  ctx.document.currentScript = { getAttribute: () => `/_next/static/chunks/${f}` };
  vm.runInContext(src, ctx, { filename: f });
  if (f !== RUNTIME_CHUNK) {
    for (const id of idsIn(src)) loaded.add(id);
    for (const m of src.matchAll(/\be\.[ir]\((\d+)\)/g)) referenced.add(+m[1]);
  }
};
load(RUNTIME_CHUNK);
for (const c of CHUNKS) load(c);

const standIns = [...referenced].filter(id => !loaded.has(id)).sort((a, b) => a - b);
const inClosure = standIns.filter(id => VERIFIER_MODULES.includes(id));
if (inClosure.length) fail(`stand-in(s) ${inClosure.join(',')} are in the verifier's own closure`);
const missingVerifier = VERIFIER_MODULES.filter(id => !loaded.has(id));
if (missingVerifier.length) fail(`verifier module(s) ${missingVerifier.join(',')} are not in the vendored chunks`);
const STAND_IN = (() => {
  const P = new Proxy(function () {}, {
    get(_t, k) {
      if (k === Symbol.iterator) return function* () { for (;;) yield P; };
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then') return undefined;
      if (k === '__esModule') return true;
      return P;
    },
    apply() { return P; }, construct() { return P; }, set() { return true; }, defineProperty() { return true; },
  });
  return P;
})();
const standInEntry = ['static/chunks/__stand-ins.js'];
for (const id of standIns) standInEntry.push(id, (_e, m) => { m.exports = m.namespaceObject = STAND_IN; });
ctx.TURBOPACK.push(standInEntry);

let verifier = null;
const FnProto = vm.runInContext('Function.prototype', ctx);
const origBind = FnProto.bind;
FnProto.bind = function (thisArg, ...a) {
  if (thisArg && typeof thisArg.verifyHouseBetsGame === 'function' && typeof thisArg.verifyDuelsGame === 'function') verifier = thisArg;
  return origBind.call(this, thisArg, ...a);
};
let loadError = null;
process.on('unhandledRejection', e => { loadError = e; });
ctx.TURBOPACK.push(['static/chunks/__entry.js', { otherChunks: [], runtimeModuleIds: [PAGE_MODULE] }]);

setImmediate(async () => {
  FnProto.bind = origBind;
  if (loadError) fail(`page module ${PAGE_MODULE} failed to instantiate: ${loadError && loadError.message}`);
  if (!verifier) fail(`page module ${PAGE_MODULE} did not bind a verifier`);
  const out = [];
  const str = v => (typeof v === 'string' ? v : null);
  for (const r of jobs.rounds) {
    const res = await verifier.VERIFY({
      casinoName: jobs.casinoName, gameName: 'plinko',
      serverSeed: r.serverSeed, clientSeed: r.clientSeed, nonce: Number(r.nonce),
      plinkoRisk: r.risk, plinkoRows: r.rows,
    });
    out.push({
      id: r.id,
      direction: str(res && res.direction), buckets: str(res && res.buckets),
      multiplier: str(res && res.multiplier), serverSeedHash: str(res && res.serverSeedHash),
    });
  }
  process.stdout.write(JSON.stringify({ standIns, results: out }));
});
