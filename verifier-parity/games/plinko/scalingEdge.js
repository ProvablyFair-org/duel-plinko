/**
 * Plinko scaling-edge bracket logic.
 *
 * Source of truth: duel-plinko/plinkoConfig.json `scaling_edge`.
 *
 * For every (rows, risk) pair Duel ships 191 brackets indexed by bet size.
 * Bracket 0 is the lowest house-edge bracket (0.1%) and covers
 *   0 ≤ bet < min_bet[1].
 * Brackets 1..190 ramp the house edge up to 2.0% in 0.01% steps.
 *
 * For every bracket i in every config:
 *   house_edge[i] = 0.001 + i * 0.0001
 *   multipliers[i][slot] = bracket0_multipliers[slot] × (1 - edge[i]) / (1 - 0.001)
 *
 * That equality holds exactly across all 27 configs × 191 brackets × all slots
 * in the live config dump (verified against duel-plinko/plinkoConfig.json).
 * It means the only data we have to ship is the 27 sequences of bracket
 * boundary thresholds — the multipliers are all derivable from the values
 * already in paytables.js (which is bracket-0 / lowest-edge).
 *
 * SHARED_BASELINE_EDGE is the bracket-0 edge used as the divisor in the
 * formula above. paytables.js also ships bracket-0 multipliers, so when
 * the user has not entered a bet (or their bet is in bracket 0) we use
 * those multipliers untouched and this whole module is a no-op.
 *
 * COLLAPSED_THRESHOLD_USD is the smallest min_bet[1] across all configs
 * (16 rows / high). Any bet below this falls in bracket 0 for every config,
 * so the verifier output matches the casino-side computation without any
 * scaling-edge involvement. This is the value used in the field's collapsed
 * label so a normal player never has to think about this feature.
 */

import { paytable, slotCount } from './paytables';

export const COLLAPSED_THRESHOLD_USD = 336;
const SHARED_BASELINE_EDGE = 0.001;
const EDGE_STEP = 0.0001;

let _thresholdsPromise = null;
let _thresholds = null;

/**
 * Lazy-load the bracket boundary table on first use. Called when the user
 * opens the scaling-edge panel — there's no reason to ship 46KB of bracket
 * data to the 99.999% of users who never look at this control.
 *
 * The fetched data is cached on the module so subsequent calls resolve
 * synchronously after the first load.
 *
 * Caller MUST pass the URL resolved through Docusaurus's useBaseUrl. We
 * can't call the hook here because this module is framework-agnostic and
 * imported into derive.js (which runs in the bulk-derive loop where hooks
 * aren't available). Inputs.jsx resolves the path and passes it in.
 */
export function loadThresholds(url) {
  if (!url) {
    return Promise.reject(new Error('loadThresholds requires a resolved URL — pass useBaseUrl(...) from a component'));
  }
  if (_thresholds) return Promise.resolve(_thresholds);
  if (_thresholdsPromise) return _thresholdsPromise;
  _thresholdsPromise = fetch(url)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status} fetching bracket data`);
      // Guard against the dev server / SPA fallback returning the index
      // HTML on a 200 (Vercel rewrites, Docusaurus 404 pages). Reading the
      // body as text first lets us produce a clearer error than the parser
      // would yield on `Unexpected token '<'`.
      return r.text().then(body => {
        const trimmed = body.trimStart();
        if (trimmed.startsWith('<')) {
          throw new Error('server returned HTML instead of JSON — file is likely missing at the requested path');
        }
        try {
          return JSON.parse(body);
        } catch (parseErr) {
          throw new Error('bracket data is not valid JSON');
        }
      });
    })
    .then(json => {
      if (!json || !json.thresholds) {
        throw new Error('bracket data is missing the "thresholds" field');
      }
      _thresholds = json.thresholds;
      return _thresholds;
    })
    .catch(err => {
      // Reset the promise so a future open can retry.
      _thresholdsPromise = null;
      throw err;
    });
  return _thresholdsPromise;
}

/** True once loadThresholds has resolved. */
export function thresholdsReady() {
  return _thresholds !== null;
}

/**
 * Find the bracket index for a given (rows, risk, bet). Returns 0 if bet
 * falls in bracket 0 (the default behaviour). Returns -1 if the threshold
 * data hasn't loaded yet — callers should treat that as "use bracket 0".
 *
 * Linear scan is fine: 191 entries * negligible cost, called on input change.
 * If this ever becomes hot we can swap for binary search.
 */
export function bracketFor(rows, risk, bet) {
  if (!_thresholds) return -1;
  const list = _thresholds[String(rows)]?.[risk];
  if (!list) return 0;
  if (!Number.isFinite(bet) || bet <= 0) return 0;
  // bracket i applies when min_bet[i] <= bet < min_bet[i+1].
  // The list is sorted ascending. Walk from the top down so we hit the
  // correct bracket without an off-by-one at the boundary.
  for (let i = list.length - 1; i >= 0; i--) {
    if (bet >= list[i]) return i;
  }
  return 0;
}

/**
 * House edge for a bracket index. Bracket 0 = 0.1%, bracket 190 = 2.0%.
 * Computed in closed form so we don't have to ship the edge sequence as data.
 */
export function houseEdgeForBracket(bracketIndex) {
  return SHARED_BASELINE_EDGE + bracketIndex * EDGE_STEP;
}

/**
 * Multipliers for (rows, risk, bracket). Returns the full slot array.
 *
 * For bracket 0 (or unloaded data) we return paytables.js values directly.
 * For higher brackets we scale them by (1 - edge) / (1 - baselineEdge).
 */
export function multipliersFor(rows, risk, bracketIndex) {
  const count = slotCount(rows);
  const base = [];
  for (let slot = 0; slot < count; slot++) {
    base.push(paytable(rows, risk, slot));
  }
  if (!bracketIndex || bracketIndex <= 0) return base;
  const edge = houseEdgeForBracket(bracketIndex);
  const scale = (1 - edge) / (1 - SHARED_BASELINE_EDGE);
  return base.map(m => m * scale);
}

/**
 * Single-slot multiplier — used by derivePlinko to compute the result.
 */
export function multiplierFor(rows, risk, bracketIndex, slot) {
  const base = paytable(rows, risk, slot);
  if (!bracketIndex || bracketIndex <= 0) return base;
  const edge = houseEdgeForBracket(bracketIndex);
  const scale = (1 - edge) / (1 - SHARED_BASELINE_EDGE);
  return base * scale;
}
