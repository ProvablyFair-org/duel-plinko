/**
 * Duel Plinko — execution of INDEPENDENT units of work across worker threads.
 *
 * Ported from repositories/liqd/plinko/src/parallel.ts (the standalone runtime of this package
 * already carries the matching worker re-entry, scripts/standalone-runtime.cjs `__runWorkerEntry`).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Two recomputes dominate the verifier's wall clock and neither is a single dependency chain:
 *
 *   * the Pass-1 replay in Step 19 — all 27 configurations × 1,000,000 rounds regenerated from
 *     the pinned seeds (~324 million HMAC-SHA256 calls), 27 independent configurations; and
 *   * the Pass-2 replay in Step 20 — every revealed epoch's server seed over 10,000 nonces, plus
 *     the 10,000 pinned calibration seeds of the Test C null, each an independent scan.
 *
 * WHAT THIS MODULE MUST NOT DO — AND DOES NOT DO
 * ----------------------------------------------
 * It changes NO arithmetic. A unit of work is the SAME function, called with the SAME arguments,
 * in the same order INSIDE the unit; only the thread it runs on differs. Nothing that accumulates
 * a floating-point sum is split across threads — one configuration's payout total is accumulated
 * in nonce order by one thread — so every result is bit-identical to the serial run, not merely
 * equal within a tolerance. `PF_PARALLEL=0` forces the serial path.
 *
 * Results come back through a SharedArrayBuffer of float64 slots, because the callers are
 * synchronous. The calling thread claims jobs from the same queue the workers pull from, then
 * blocks on Atomics.wait until every job is marked done. A job whose worker threw, died, or never
 * started is recomputed on the calling thread afterwards, which both produces the right answer and
 * surfaces the real exception — the parallel path can only make the suite faster or slower, never
 * wrong.
 *
 * WHERE THE WORKERS COME FROM
 * ---------------------------
 *   * zero-install bundle (verify.js / test.js): a worker re-enters the bundle, which the runtime
 *     shim re-routes to `__pfWorkerMain` (as in LIQD);
 *   * ts-node (`npm run verify`, `npm run report`, the mutation battery): a worker is a two-line
 *     eval that registers ts-node (transpile-only) and requires THIS file. Added here, not in LIQD,
 *     so the 324-million-HMAC replay does not run on one core under ts-node.
 */

import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

/** A unit of work: fill `out` from `job`. Must be pure and must not touch shared state. */
export type ParallelKernel = (job: unknown, out: Float64Array) => void;

/** kind -> kernel, resolved LAZILY (the owning modules import this one). */
export function kernelFor(kind: string): ParallelKernel {
  switch (kind) {
    case 'pass1-config':
      return require('./pass1').pass1ConfigKernel as ParallelKernel;
    case 'plinko-paths':
      return require('./pass2-replay').plinkoPathsKernel as ParallelKernel;
    default:
      throw new Error(`parallel: unknown kernel kind ${JSON.stringify(kind)}`);
  }
}

/** Bundle module id of THIS file, as the standalone runtime keys it. */
const WORKER_MODULE = 'src/parallel.js';

const CTL_NEXT = 0;
const CTL_DONE = 1;
const CTL_WORDS = 2;
const ST_TODO = 0;
const ST_CLAIMED = 1;
const ST_DONE = 2;

/** No progress for this long ⇒ assume the remaining workers are gone and finish locally. */
const STALL_MS = 300_000;

interface WorkerBoot {
  __pfWorkerModule: string;
  kind: string;
  jobs: unknown[];
  slots: number[];
  offsets: number[];
  control: SharedArrayBuffer;
  status: SharedArrayBuffer;
  results: SharedArrayBuffer;
}

/** The standalone bundle's own path, published by scripts/standalone-runtime.cjs. */
function standaloneEntry(): string | undefined {
  return (globalThis as unknown as { __pfStandaloneEntry?: string }).__pfStandaloneEntry;
}

/** True when this process runs TypeScript sources through ts-node. */
function underTsNode(): boolean {
  return !standaloneEntry() && __filename.endsWith('.ts')
    && Object.prototype.hasOwnProperty.call(require.extensions, '.ts');
}

function parallelEnabled(): boolean {
  return process.env.PF_PARALLEL !== '0';
}

/**
 * How many EXTRA threads to ask for (LIQD's measured rule: ~60% of the reported cores; past that
 * the hybrid CPU's efficiency cores add CPU time, not throughput). `PF_PARALLEL_WORKERS` overrides.
 */
function workerCount(jobs: number): number {
  let cores = 1;
  try { cores = availableParallelism(); } catch { cores = 1; }
  let threads = Math.max(2, Math.round(cores * 0.6));
  const override = parseInt(process.env.PF_PARALLEL_WORKERS ?? '', 10);
  if (Number.isFinite(override) && override >= 0) threads = override + 1;
  return Math.max(0, Math.min(jobs - 1, threads - 1));
}

function spawnWorker(boot: WorkerBoot): Worker {
  const entry = standaloneEntry();
  // `execArgv: []` does NOT inherit the parent's node options (an inherited --inspect or
  // --cpu-prof has nothing to do with the arithmetic the worker runs).
  if (entry !== undefined) return new Worker(entry, { workerData: boot, execArgv: [] });
  const src = `require('ts-node').register({ transpileOnly: true });\n`
    + `require(${JSON.stringify(__filename)}).__pfWorkerMain(require('node:worker_threads').workerData);`;
  return new Worker(src, { eval: true, workerData: boot, execArgv: [] });
}

/**
 * Run `jobs` through the `kind` kernel. `slotsFor(job)` is how many float64 slots each job fills;
 * returns one view per job, in job order.
 */
export function runBatch(
  kind: string,
  jobs: unknown[],
  slotsFor: (job: unknown, i: number) => number,
  worthParallel: boolean,
): Float64Array[] {
  const kernel = kernelFor(kind);
  const slots = jobs.map((j, i) => slotsFor(j, i));
  const offsets: number[] = [];
  let total = 0;
  for (const s of slots) { offsets.push(total); total += s; }
  const view = (buf: Float64Array, i: number): Float64Array => buf.subarray(offsets[i], offsets[i] + slots[i]);

  const useWorkers = worthParallel && parallelEnabled() && jobs.length >= 2
    && (standaloneEntry() !== undefined || underTsNode()) && workerCount(jobs.length) >= 1;

  if (!useWorkers) {
    const results = new Float64Array(total);
    for (let i = 0; i < jobs.length; i++) kernel(jobs[i], view(results, i));
    return jobs.map((_, i) => view(results, i));
  }

  const control = new SharedArrayBuffer(CTL_WORDS * 4);
  const statusBuf = new SharedArrayBuffer(jobs.length * 4);
  const resultsBuf = new SharedArrayBuffer(total * 8);
  const ctl = new Int32Array(control);
  const status = new Int32Array(statusBuf);
  const results = new Float64Array(resultsBuf);
  const boot: WorkerBoot = {
    __pfWorkerModule: WORKER_MODULE, kind, jobs, slots, offsets,
    control, status: statusBuf, results: resultsBuf,
  };

  const workers: Worker[] = [];
  for (let i = 0, n = workerCount(jobs.length); i < n; i++) {
    try {
      const w = spawnWorker(boot);
      w.on('error', () => { /* recovered by the local recompute */ });
      w.unref();
      workers.push(w);
    } catch { break; }
  }

  for (;;) {
    const i = Atomics.add(ctl, CTL_NEXT, 1);
    if (i >= jobs.length) break;
    Atomics.store(status, i, ST_CLAIMED);
    kernel(jobs[i], view(results, i));
    Atomics.store(status, i, ST_DONE);
    Atomics.add(ctl, CTL_DONE, 1);
  }

  let seen = Atomics.load(ctl, CTL_DONE);
  let deadline = Date.now() + STALL_MS;
  while (seen < jobs.length && Date.now() < deadline) {
    Atomics.wait(ctl, CTL_DONE, seen, 250);
    const now = Atomics.load(ctl, CTL_DONE);
    if (now !== seen) { seen = now; deadline = Date.now() + STALL_MS; }
  }
  for (const w of workers) void w.terminate();

  for (let i = 0; i < jobs.length; i++) {
    if (Atomics.load(status, i) !== ST_DONE) {
      kernel(jobs[i], view(results, i));
      Atomics.store(status, i, ST_DONE);
    }
  }
  return jobs.map((_, i) => view(results, i));
}

/** Worker-thread entry point (standalone runtime re-entry, or the ts-node eval above). */
export function __pfWorkerMain(data: WorkerBoot): void {
  const ctl = new Int32Array(data.control);
  const status = new Int32Array(data.status);
  const results = new Float64Array(data.results);
  let kernel: ParallelKernel;
  try {
    kernel = kernelFor(data.kind);
  } catch {
    process.exit(0);
    return;
  }
  for (;;) {
    const i = Atomics.add(ctl, CTL_NEXT, 1);
    if (i >= data.jobs.length) break;
    Atomics.store(status, i, ST_CLAIMED);
    try {
      kernel(data.jobs[i], results.subarray(data.offsets[i], data.offsets[i] + data.slots[i]));
      Atomics.store(status, i, ST_DONE);
    } catch {
      Atomics.store(status, i, ST_TODO);
    }
    Atomics.add(ctl, CTL_DONE, 1);
    Atomics.notify(ctl, CTL_DONE);
  }
  process.exit(0);
}
