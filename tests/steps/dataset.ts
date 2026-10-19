/**
 * Steps 10–16: Dataset Integrity
 * EC-10, EC-12, EC-13, EC-14, EC-17, EC-23, EC-24, EC-25, EC-30, EC-31, EC-32
 */

import type { StepResult, RiskLevel } from '../../src/types';
import {
  loadMasterBuffer,
  EXPECTED_BETS, EXPECTED_SEEDS, EXPECTED_PHASE_BETS,
  EXPECTED_EPOCH_SIZE, EXPECTED_EPOCHS, EXPECTED_DATASET_SHA256,
} from '../../src/loader';
import { binomProb } from '../../src/stats';
import { sha256Buffer } from '../../src/rng';
import { pass, fail, VerifyContext, tag } from './context';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seeds, cfg, byHash, phaseA, phaseB, phaseC, expectedHash } = ctx;
  const results: StepResult[] = [];

  // ── Step 10: Zero Edge Audit (EC-23) ──────────────────────────────────────────
  // The dataset carries two effective_edge labels — 0 (the "zero edge" mode) and 0.1. A label
  // is not a paytable: this recomputes EVERY bet in each group against the committed multiplier
  // table and DERIVES the theoretical RTP of the table that group's bets actually use, so the
  // record states what the zero-edge mode pays rather than trusting its name. Measured here, on
  // the captured stakes ($0.01 and $10, all bracket 0), both groups resolve to the SAME bracket-0 multipliers (RTP 99.9%) — the effective_edge label
  // does not select a distinct-RTP table — which is why PLINKO-17's "zero_edge as a separate
  // mode" is declared n/a in Step 16: there is no second table to give a phase of its own.
  {
    const edgeGroups = new Map<number, typeof bets>();
    for (const bet of bets) {
      const e = bet.response.effective_edge;
      if (!edgeGroups.has(e)) edgeGroups.set(e, []);
      edgeGroups.get(e)!.push(bet);
    }

    const failures: string[] = [];
    const details: Record<string, unknown> = { edgeGroups: {} };
    const TOLERANCE = 1e-5;

    for (const [edge, groupBets] of edgeGroups) {
      let mismatches = 0;
      const configSet = new Set<string>();
      for (const bet of groupBets) {
        const { rows, risk } = bet.request;
        const { final_slot, payout_multiplier } = bet.response;
        const se = cfg.scalingEdgeMultiplier(rows, risk as RiskLevel, final_slot);
        if (Math.abs(parseFloat(payout_multiplier) - se) > TOLERANCE) mismatches++;
        configSet.add(`${rows}|${risk}`);
      }
      // Derived RTP of the table these bets use: the independent-binomial RTP of each config
      // present, averaged over the group's configs. It is DERIVED from the committed table, not
      // read from any field on the bet.
      let rtpSum = 0;
      for (const c of configSet) {
        const [r, k] = c.split('|');
        rtpSum += cfg.theoreticalRTP(Number(r), k as RiskLevel);
      }
      const derivedRTP = configSet.size > 0 ? rtpSum / configSet.size : 0;
      (details['edgeGroups'] as Record<string, unknown>)[`edge_${edge}`] = {
        count: groupBets.length,
        multiplierMismatches: mismatches,
        configsPresent: configSet.size,
        derivedTableRTP: derivedRTP,
        table: 'scaling_edge bracket 0 (== payout_tables)',
      };
      if (mismatches > 0) {
        failures.push(`effective_edge=${edge}: ${mismatches}/${groupBets.length} multiplier mismatches`);
      }
    }

    const rtps = Object.values(details['edgeGroups'] as Record<string, { derivedTableRTP: number }>)
      .map(g => g.derivedTableRTP);
    const sameTable = rtps.length > 0 && Math.max(...rtps) - Math.min(...rtps) < 1e-9;

    const r = failures.length === 0
      ? pass(10, 'Zero Edge Audit', ['EC-23'],
          `All effective_edge groups (${[...edgeGroups.keys()].join(', ')}) recompute against the same committed multiplier table; `
          + `each group's derived table RTP ≈ ${(rtps[0] * 100).toFixed(4)}% and ${sameTable ? 'the groups share one table — on the captured stakes ($0.01 and $10, bracket 0) the effective_edge label does not change the RTP' : 'the groups differ — see details'}`,
          details)
      : fail(10, 'Zero Edge Audit', ['EC-23'], 'FLAG',
          'Different multiplier tables per effective_edge group', failures, details);
    results.push(r);
    console.log(`  [${tag(r)}] Step 10 — ${r.name}`);
  }

  // ── Step 11: Config Completeness (EC-30) ──────────────────────────────────────
  {
    const MIN_PER_CONFIG = 100;
    const failures: string[] = [];
    const configCounts: Record<string, number> = {};

    for (const bet of phaseA) {
      const key = `${bet.request.rows}r/${bet.request.risk}`;
      configCounts[key] = (configCounts[key] ?? 0) + 1;
    }

    for (const { rows, risk } of cfg.allConfigs()) {
      const key = `${rows}r/${risk}`;
      const count = configCounts[key] ?? 0;
      if (count < MIN_PER_CONFIG) {
        failures.push(`Config ${key}: ${count} bets (minimum ${MIN_PER_CONFIG} required)`);
      }
    }

    const totalPhaseA = Object.values(configCounts).reduce((a, b) => a + b, 0);
    const minSample = Math.min(...Object.values(configCounts));

    // ── Cell coverage: what the live sample did NOT exercise ────────────────────
    // A configuration having enough bets says nothing about which of its CELLS were paid. The
    // outer slots of a sixteen-row board are reached once in 65,536 drops, so a capture of this
    // size never pays them — and those are the cells carrying the largest multipliers, which is
    // to say the ones an operator would alter. The step recorded "27 configs, all above the
    // floor" and stopped there, leaving a reader to assume the table had been exercised.
    //
    // Every unpaid cell is enumerated here with the share of theoretical RTP it carries, so the
    // limit of the live evidence is a measured number in the artifact rather than something the
    // reader has to infer. Those cells are not unverified — Step 13 checks them structurally
    // against the committed table and Step 17 derives their probabilities independently — but
    // no PLAYER was paid from them during this capture, and that distinction belongs in the
    // record.
    const observedCells = new Set<string>();
    for (const bet of bets) {
      observedCells.add(`${bet.request.rows}|${bet.request.risk}|${bet.response.final_slot}`);
    }

    let totalCells = 0;
    let unpaidCells = 0;
    let rtpMassTotal = 0;
    let rtpMassUnpaid = 0;
    const unpaidByConfig: Record<string, { slots: number[]; rtpShare: number }> = {};

    for (const { rows, risk } of cfg.allConfigs()) {
      const key = `${rows}r/${risk}`;
      const slots: number[] = [];
      let configMass = 0;
      let configUnpaidMass = 0;
      for (let k = 0; k <= rows; k++) {
        totalCells++;
        const mass = binomProb(rows, k) * cfg.scalingEdgeMultiplier(rows, risk as RiskLevel, k);
        configMass += mass;
        if (!observedCells.has(`${rows}|${risk}|${k}`)) {
          unpaidCells++;
          slots.push(k);
          configUnpaidMass += mass;
        }
      }
      rtpMassTotal += configMass;
      rtpMassUnpaid += configUnpaidMass;
      if (slots.length > 0) {
        unpaidByConfig[key] = { slots, rtpShare: configUnpaidMass / configMass };
      }
    }

    const details12 = {
      configCounts,
      totalPhaseA,
      totalCorrect: totalPhaseA === 5400,
      imbalancedConfigs: Object.values(configCounts).filter(c => c !== 200).length,
      minSample,
      note: 'Phase A uses balanced queue: 108 epochs x 50 bets = 5400, exactly 200 bets per config. IndexedDB capture eliminates localStorage quota issues.',
      cellCoverage: {
        population: 'all captured bets, every phase',
        totalCells,
        cellsPaid: totalCells - unpaidCells,
        cellsNeverPaid: unpaidCells,
        rtpShareNeverPaid: rtpMassTotal > 0 ? rtpMassUnpaid / rtpMassTotal : 0,
        neverPaidByConfig: unpaidByConfig,
        note: 'A never-paid cell is one no captured bet landed in. It is still checked against the '
          + 'committed multiplier table (Step 13) and its probability is still derived independently '
          + '(Step 17); what it lacks is a live payout confirming the operator honours it.',
      },
    };

    const r = failures.length === 0
      ? pass(11, 'Config Completeness & Cell Coverage', ['EC-30'],
          `All 27 configs have >= ${MIN_PER_CONFIG} Phase A bets (min ${minSample}, total ${totalPhaseA}/5400). `
          + `Cell coverage over the whole capture: ${totalCells - unpaidCells} of ${totalCells} multiplier cells were `
          + `paid at least once; the rest are enumerated in details with the share of theoretical RTP they carry.`,
          details12)
      : fail(11, 'Config Completeness & Cell Coverage', ['EC-30'], 'FLAG',
          `${failures.length} configs below minimum ${MIN_PER_CONFIG} bets`,
          failures, details12);
    results.push(r);
    console.log(`  [${tag(r)}] Step 11 — ${r.name}`);
  }

  // ── Step 12: Epoch Size & Count (EC-31) ───────────────────────────────────────
  // SIZE AND COUNT FAIL DIFFERENTLY, SO BOTH ARE ASSERTED, AND BOTH AGAINST src/loader.ts.
  // The size used to be a literal sitting inside this step — an audit constant maintained in
  // one place and compared in another, which is how the two drift apart — and the COUNT was
  // never compared to anything at all: drop half the commitments and every surviving epoch is
  // still exactly 50 bets, so the step reported "all 81 epochs have exactly 50 bets" and passed.
  // The profile scores this HARD_FAIL; it was scored here at FLAG, which let a wrong population
  // through with a warning.
  {
    const failures: string[] = [];

    for (const [hash, epochBets] of byHash) {
      const size = epochBets.length;
      if (size !== EXPECTED_EPOCH_SIZE) {
        failures.push(`Epoch ${hash.substring(0, 16)}: ${size} bets (src/loader.ts EXPECTED_EPOCH_SIZE = ${EXPECTED_EPOCH_SIZE})`);
      }
    }
    if (byHash.size !== EXPECTED_EPOCHS) {
      failures.push(`${byHash.size} commitments in the dataset, ${EXPECTED_EPOCHS} declared in src/loader.ts EXPECTED_EPOCHS`);
    }
    if (EXPECTED_EPOCHS * EXPECTED_EPOCH_SIZE !== EXPECTED_BETS) {
      failures.push(
        `the capture plan is internally inconsistent: EXPECTED_EPOCHS × EXPECTED_EPOCH_SIZE = `
        + `${EXPECTED_EPOCHS * EXPECTED_EPOCH_SIZE}, EXPECTED_BETS = ${EXPECTED_BETS}`
      );
    }

    const details = {
      epochs: byHash.size,
      expectedEpochs: EXPECTED_EPOCHS,
      epochSize: EXPECTED_EPOCH_SIZE,
      betsImplied: EXPECTED_EPOCHS * EXPECTED_EPOCH_SIZE,
      expectedBets: EXPECTED_BETS,
      issues: failures.length,
    };

    const r = failures.length === 0
      ? pass(12, 'Epoch Size & Count', ['EC-31'],
          `All ${byHash.size} commitments hold exactly ${EXPECTED_EPOCH_SIZE} bets, and the number of commitments equals `
          + `src/loader.ts EXPECTED_EPOCHS — the two multiply to EXPECTED_BETS, so neither a shrunken capture nor a merged `
          + `epoch passes by agreeing with itself`,
          details)
      : fail(12, 'Epoch Size & Count', ['EC-31'], 'HARD_FAIL',
          `${failures.length} epoch size/count violations against the capture plan in src/loader.ts`, failures,
          details);
    results.push(r);
    console.log(`  [${tag(r)}] Step 12 — ${r.name}`);
  }

  // ── Step 13: Multiplier Table + Symmetry (EC-10, EC-12, EC-13, EC-14) ─────────
  {
    const TOLERANCE = 1e-5;
    const failures: string[] = [];

    for (const { rows, risk } of cfg.allConfigs()) {
      const configBets = bets.filter(b => b.request.rows === rows && b.request.risk === risk);
      for (const bet of configBets) {
        const observed = parseFloat(bet.response.payout_multiplier);
        const se = cfg.scalingEdgeMultiplier(rows, risk as RiskLevel, bet.response.final_slot);
        if (Math.abs(observed - se) > TOLERANCE) {
          failures.push(`EC-12: ${rows}r/${risk} slot=${bet.response.final_slot}: diff=${Math.abs(observed - se).toExponential(2)}`);
        }
      }

      const slot0 = cfg.scalingEdgeMultiplier(rows, risk as RiskLevel, 0);
      const slotN = cfg.scalingEdgeMultiplier(rows, risk as RiskLevel, rows);
      if (Math.abs(slot0 - slotN) > TOLERANCE) {
        failures.push(`EC-10: ${rows}r/${risk}: slot0=${slot0} ≠ slotN=${slotN}`);
      }

      for (let k = 0; k <= rows; k++) {
        const mk = cfg.scalingEdgeMultiplier(rows, risk as RiskLevel, k);
        const mk_mirror = cfg.scalingEdgeMultiplier(rows, risk as RiskLevel, rows - k);
        if (Math.abs(mk - mk_mirror) > TOLERANCE) {
          failures.push(`EC-14: ${rows}r/${risk} slot ${k} vs ${rows - k}: ${mk} ≠ ${mk_mirror}`);
        }
      }

      if (rows === 16 && risk === 'high') {
        const center = cfg.scalingEdgeMultiplier(16, 'high', 8);
        if (center < 0.2) {
          failures.push(`EC-13: 16r/high center slot multiplier=${center} < 0.2 (0.2× floor violated)`);
        }
      }
    }

    const r = failures.length === 0
      ? pass(13, 'Multiplier Table + Symmetry', ['EC-10', 'EC-12', 'EC-13', 'EC-14'],
          `Given the committed plinkoConfig.json multiplier table, slot symmetry holds across all 27 configs and the 16r/high 0.2× floor is satisfied. Live bets confirm their observed multipliers against the same table (tol 1e-5); unobserved rare-slot entries are validated structurally via the symmetry identity over the full committed table.`)
      : fail(13, 'Multiplier Table + Symmetry', ['EC-10', 'EC-12', 'EC-13', 'EC-14'], 'FLAG',
          `${failures.length} multiplier/symmetry issues`, failures.slice(0, 20),
          { total: failures.length });
    results.push(r);
    console.log(`  [${tag(r)}] Step 13 — ${r.name}`);
  }

  // ── Step 14: Phase Labels (EC-24) ─────────────────────────────────────────────
  {
    const VALID_PHASES = new Set(['A', 'B', 'C', 'D']);
    const failures: string[] = [];

    for (const bet of bets) {
      if (!VALID_PHASES.has(bet.phase)) {
        failures.push(`bet ${bet.response.id}: invalid phase '${bet.phase}'`);
      }
    }
    for (const seed of seeds) {
      if (!VALID_PHASES.has(seed.phase)) {
        failures.push(`seed ${seed.seed.serverSeedHashed.substring(0, 16)}: invalid phase '${seed.phase}'`);
      }
    }

    const phaseD = bets.filter(b => b.phase === 'D');
    const phaseCounts = { A: phaseA.length, B: phaseB.length, C: phaseC.length, D: phaseD.length };
    const seedPhaseCounts: Record<string, number> = {};
    for (const s of seeds) {
      seedPhaseCounts[s.phase] = (seedPhaseCounts[s.phase] ?? 0) + 1;
    }

    // Labels alone are not a population. Every count above is read from inside the file
    // being scored, so a uniform shrink keeps every label valid and every ratio intact.
    // Compare against the code constants the dataset does not control, and HARD_FAIL.
    const popIssues: string[] = [];
    if (bets.length !== EXPECTED_BETS) popIssues.push(`bets ${bets.length} != ${EXPECTED_BETS}`);
    if (seeds.length !== EXPECTED_SEEDS) popIssues.push(`seed records ${seeds.length} != ${EXPECTED_SEEDS}`);
    for (const [p, n] of Object.entries(EXPECTED_PHASE_BETS)) {
      const got = (phaseCounts as Record<string, number>)[p] ?? 0;
      if (got !== n) popIssues.push(`phase ${p} ${got} != ${n}`);
    }

    const r = failures.length === 0 && popIssues.length === 0
      ? pass(14, 'Population & Phase Labels', ['EC-24'],
          `All ${bets.length} bets and ${seeds.length} seeds have valid phase labels, and the population matches the capture plan in src/loader.ts (code constants, not the dataset header)`,
          { betPhases: phaseCounts, seedPhases: seedPhaseCounts })
      : fail(14, 'Population & Phase Labels', ['EC-24'], 'HARD_FAIL',
          popIssues.length
            ? `POPULATION MISMATCH vs the capture plan in src/loader.ts: ${popIssues.join('; ')}`
            : `${failures.length} invalid phase labels`,
          popIssues.length ? popIssues : failures.slice(0, 10));
    results.push(r);
    console.log(`  [${tag(r)}] Step 14 — ${r.name}`);
  }

  // ── Step 15: Dataset Hash (EC-25) ─────────────────────────────────────────────
  // A STEP WITH NO FAILURE BRANCH IS NOT A CHECK. This one recomputed the hash, printed it,
  // and returned pass() unconditionally: it reported PASS whatever the two values were. The
  // pre-flight guard in tests/verify.ts did the real work, which is fine as defence in depth
  // and useless as evidence — the published artifact recorded a step that could not fail.
  //
  // The comparison is against src/loader.ts EXPECTED_DATASET_SHA256, the same constant the
  // pre-flight guard reads, so there is one pin rather than two that can drift apart.
  {
    const buf = loadMasterBuffer();
    const hash = sha256Buffer(buf);
    const match = hash === EXPECTED_DATASET_SHA256;
    const details = {
      file: 'data/plinko-master-8100bets.json',
      sizeBytes: buf.length,
      sha256: hash,
      expected: EXPECTED_DATASET_SHA256,
      pinnedIn: 'src/loader.ts EXPECTED_DATASET_SHA256',
      contextExpected: expectedHash,
      match,
    };
    const r = match && expectedHash === EXPECTED_DATASET_SHA256
      ? pass(15, 'Dataset Hash', ['EC-25'],
          `SHA-256 of the master JSON equals the pin in src/loader.ts: ${hash}`, details)
      : fail(15, 'Dataset Hash', ['EC-25'], 'HARD_FAIL',
          match
            ? `the pre-flight guard compared against ${expectedHash}, src/loader.ts pins ${EXPECTED_DATASET_SHA256}`
            : `dataset SHA-256 ${hash} ≠ pin ${EXPECTED_DATASET_SHA256}`,
          [match
            ? 'the dataset matches the loader pin but the run was admitted against a different one'
            : `recomputed ${hash}, pinned ${EXPECTED_DATASET_SHA256}`],
          details);
    results.push(r);
    console.log(`  [${tag(r)}] Step 15 — ${r.name}`);
    console.log(`         ${hash}`);
  }

  // ── Step 16: Scaling Edge Analysis (EC-17, EC-32) ─────────────────────────────
  // FULL-BRACKET COVERAGE. This step used to audit bracket 0 only — the small-stake table
  // every captured bet lands in — and merely printed the edge span of one configuration
  // without asserting anything about it. But the scaling_edge mode IS the house-edge story:
  // each configuration declares a ladder of brackets whose house edge climbs from 0.001 at
  // the smallest stakes to 0.02 at the largest, so the RTP the config declares falls
  // from 99.9% to 98.0% as the stake grows. A per-bracket check is the only thing that binds
  // the declared edge of a bracket to the multipliers it ships, and binds a stake to the
  // bracket it lands in under the config's own ranges — the two ways a scaling ladder can
  // quietly overcharge. It reads the config only, never a server response: which bracket the
  // server applies above bracket 0 is not tested here (R-BRACKET; every captured bet is in
  // bracket 0).
  //
  // For every configuration and EVERY bracket this asserts, from the hash-pinned config and
  // the independent binomial (never a casino-supplied probability):
  //   · above bracket 0, the declared house_edge equals 1 − RTP(bracket.multipliers), so the edge label cannot
  //     disagree with what the bracket pays (the RTP is DERIVED here, per bracket);
  //   · the multiplier row is symmetric;
  //   · the brackets tile the stake axis with no gap or overlap (each min_bet = the previous
  //     max_bet) and the edge is monotonically non-decreasing up the ladder;
  //   · the edge span of the configuration is exactly the declared [0.001, 0.02];
  //   · a stake placed inside a bracket's [min_bet, max_bet) resolves to that bracket under the
  //     config's lookup — checked against bracket 0, a mid-ladder bracket and the top bracket
  //     of every config.
  // A violation is a HARD_FAIL: these are structural facts about the published table, not a
  // sampling artifact.
  {
    const failures: string[] = [];
    // The multipliers are published to 8 decimal places, so the RTP derived from them carries
    // ~1e-8 of rounding; adjacent brackets' declared edges are spaced 1e-4 apart, so 1e-6 accepts
    // that rounding while still rejecting a wrong edge by two orders of magnitude.
    const EDGE_TOL = 1e-6;      // |declared edge − (1 − derived RTP)| ceiling
    const DECLARED_SPAN = { min: 0.001, max: 0.02 };
    const scalingDetails: Record<string, unknown> = {};
    const rtpSpanByConfig: Record<string, { brackets: number; edgeMin: number; edgeMax: number; rtpBracket0: number; rtpTop: number }> = {};

    // RTP of a bracket's multiplier row under the independent binomial — DERIVED, not read.
    const bracketRTP = (rows: number, mults: string[]): number => {
      let rtp = 0;
      for (let k = 0; k <= rows; k++) rtp += binomProb(rows, k) * parseFloat(mults[k]);
      return rtp;
    };
    // The bracket a stake lands in: the first whose [min_bet, max_bet) contains it, else the top.
    const bracketForStake = (brackets: ReturnType<typeof cfg.scalingEdgeBrackets>, stake: number): number => {
      for (let i = 0; i < brackets.length; i++) {
        if (stake >= parseFloat(brackets[i].min_bet) && stake < parseFloat(brackets[i].max_bet)) return i;
      }
      return brackets.length - 1;
    };

    for (const { rows, risk } of cfg.allConfigs()) {
      const key = `${rows}r/${risk}`;
      const brackets = cfg.scalingEdgeBrackets(rows, risk);
      let prevEdge = -Infinity;
      let prevMax: number | null = null;
      let edgeMin = Infinity, edgeMax = -Infinity;

      for (let bi = 0; bi < brackets.length; bi++) {
        const b = brackets[bi];
        const declaredEdge = parseFloat(b.house_edge);
        edgeMin = Math.min(edgeMin, declaredEdge);
        edgeMax = Math.max(edgeMax, declaredEdge);

        // (1) declared edge == 1 − derived RTP, for the brackets above bracket 0. Bracket 0's edge is
        //     the RTP claim itself (src/rtp-settings.ts): whether its table pays it is the RTP-CLAIM
        //     rule's to score, on Step 19 — a miss there is RTP FIGURE OVERSTATED (exit 5), never a
        //     HARD_FAIL here (C3, FIXPASS2 14 Oct 2026). The brackets above are not in the RTP table.
        const derivedEdge = 1 - bracketRTP(rows, b.multipliers);
        if (bi > 0 && Math.abs(derivedEdge - declaredEdge) > EDGE_TOL) {
          failures.push(`${key} bracket ${bi}: declared edge ${b.house_edge} ≠ 1−RTP ${derivedEdge.toFixed(10)}`);
        }
        // (2) symmetric multipliers
        const m = b.multipliers.map(parseFloat);
        for (let k = 0; k < m.length; k++) {
          if (Math.abs(m[k] - m[m.length - 1 - k]) > 1e-5) {
            failures.push(`EC-14 scaling_edge: ${key} bracket ${bi} slot ${k} vs ${m.length - 1 - k}: ${m[k]} ≠ ${m[m.length - 1 - k]}`);
            break;
          }
        }
        // (3) contiguity + monotonic edge up the ladder
        const minBet = parseFloat(b.min_bet);
        if (prevMax !== null && Math.abs(minBet - prevMax) > 1e-6) {
          failures.push(`${key} bracket ${bi}: min_bet ${b.min_bet} does not meet previous max_bet ${prevMax} (gap/overlap in the stake ladder)`);
        }
        if (declaredEdge < prevEdge - EDGE_TOL) {
          failures.push(`${key} bracket ${bi}: edge ${b.house_edge} drops below the previous bracket ${prevEdge} (ladder must not decrease)`);
        }
        prevEdge = declaredEdge;
        prevMax = parseFloat(b.max_bet);
      }

      // (4) declared edge span of the configuration
      if (edgeMin !== DECLARED_SPAN.min || edgeMax !== DECLARED_SPAN.max) {
        failures.push(`${key}: edge span [${edgeMin}, ${edgeMax}] ≠ declared [${DECLARED_SPAN.min}, ${DECLARED_SPAN.max}]`);
      }

      // (5) the config lookup resolves a stake to the bracket whose range contains it — bottom,
      //     middle, top (config only; no server response is read)
      const probeIdx = [0, Math.floor(brackets.length / 2), brackets.length - 1];
      for (const idx of probeIdx) {
        const b = brackets[idx];
        const lo = parseFloat(b.min_bet), hi = parseFloat(b.max_bet);
        const stake = idx === brackets.length - 1 ? lo + 1 : lo + (hi - lo) / 2;
        const landed = bracketForStake(brackets, stake);
        if (landed !== idx) {
          failures.push(`${key}: stake ${stake} lands in bracket ${landed} but sits inside bracket ${idx}'s [${b.min_bet}, ${b.max_bet})`);
        }
      }

      rtpSpanByConfig[key] = {
        brackets: brackets.length,
        edgeMin, edgeMax,
        rtpBracket0: bracketRTP(rows, brackets[0].multipliers),
        rtpTop: bracketRTP(rows, brackets[brackets.length - 1].multipliers),
      };
    }

    const totalBrackets = Object.values(rtpSpanByConfig).reduce((a, c) => a + c.brackets, 0);
    scalingDetails['bracketsAudited'] = totalBrackets;
    scalingDetails['rtpSpanByConfig'] = rtpSpanByConfig;
    scalingDetails['modeCoverage'] = {
      scaling_edge: `all ${totalBrackets} brackets across 27 configs — declared edge = 1−RTP per bracket above bracket 0 (bracket 0: RTP-CLAIM, Step 19), span [0.001, 0.02], RTP falls from 99.9% (bracket 0) to 98.0% (top bracket)`,
      wtf: 'n/a — declared: this game ships no WTF multiplier table',
      zero_edge: 'n/a — declared: on the captured stakes ($0.01 and $10, bracket 0) the effective_edge=0 label does not select a distinct table (Step 10 measures those bets use the same bracket-0 multipliers), so no separate zero-edge RTP mode was observed',
    };

    const r = failures.length === 0
      ? pass(16, 'Scaling Edge Analysis', ['EC-17', 'EC-32'],
          `Full scaling_edge coverage: all ${totalBrackets} brackets across 27 configs — each bracket's declared house_edge above bracket 0 equals 1 − its derived RTP (tol ${EDGE_TOL}; bracket 0's is the RTP claim, scored by RTP-CLAIM on Step 19), multipliers symmetric, the ladder tiles the stake axis with monotone non-decreasing edge, every config spans the declared [0.001, 0.02], and bottom/middle/top probe stakes each resolve, by lookup in the config, to the bracket whose range contains them (the config only: which bracket the server applies above bracket 0 was not tested, R-BRACKET). RTP falls from 99.9% at bracket 0 to 98.0% at the top bracket.`,
          scalingDetails)
      : fail(16, 'Scaling Edge Analysis', ['EC-17', 'EC-32'], 'HARD_FAIL',
          `${failures.length} scaling edge issue(s) across the bracket ladder`, failures.slice(0, 20), scalingDetails);
    results.push(r);
    console.log(`  [${tag(r)}] Step 16 — ${r.name}`);
  }

  return results;
}
