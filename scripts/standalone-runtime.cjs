// Bundled modules receive their original directory paths for evidence-file lookup.
const __path = require('node:path');
const __createRequire = require('node:module').createRequire;
const __cache = new Map();
function __load(id) {
  if (__cache.has(id)) return __cache.get(id).exports;
  if (!Object.hasOwn(__modules, id)) throw new Error(`Missing bundled module: ${id}`);
  const filename = __path.join(__dirname, id);
  const diskRequire = __createRequire(filename);
  const module = { exports: {} };
  __cache.set(id, module);
  const localRequire = spec => {
    if (!spec.startsWith('.')) return diskRequire(spec);
    const joined = __path.posix.normalize(__path.posix.join(__path.posix.dirname(id), spec));
    const target = [joined, joined + '.js', joined + '/index.js']
      .find(candidate => Object.hasOwn(__modules, candidate));
    return target ? __load(target) : diskRequire(spec);
  };
  __modules[id](module, module.exports, localRequire, filename, __path.dirname(filename));
  return module.exports;
}

// ── Worker-thread re-entry ────────────────────────────────────────────────────
// src/parallel.ts runs independent units of work (one lattice convolution, one epoch's
// drop replay) on worker threads. A worker is this very bundle, started again: there is
// no second file to point `new Worker()` at. `__pfStandaloneEntry` is how the bundled
// code learns its own path, and `__runWorkerEntry` re-routes a worker start to the named
// bundled module instead of running the entry point a second time. On the main thread it
// does nothing and the bundle runs exactly as before.
const __threads = require('node:worker_threads');
globalThis.__pfStandaloneEntry = __filename;
function __runWorkerEntry() {
  const data = __threads.workerData;
  if (__threads.isMainThread || !data || typeof data !== 'object' || !data.__pfWorkerModule) return false;
  __load(data.__pfWorkerModule).__pfWorkerMain(data);
  return true;
}

// The unit sources use Mocha's describe/it interface and synchronous timeout settings.
// Node's built-in runner supplies assertion reporting and a nonzero failure exit status.
function __installTestGlobals() {
  const test = require('node:test');
  const context = () => ({ timeout() {}, slow() {}, retries() {} });
  const wrap = fn => typeof fn === 'function' ? function () { return fn.call(context()); } : fn;
  for (const name of ['describe', 'it']) {
    const bind = fn => (title, callback) => fn(title, wrap(callback));
    const bound = bind(test[name]);
    for (const modifier of ['skip', 'only', 'todo']) bound[modifier] = bind(test[name][modifier]);
    globalThis[name] = bound;
  }
  for (const name of ['before', 'after', 'beforeEach', 'afterEach']) {
    globalThis[name] = callback => test[name](wrap(callback));
  }
}
