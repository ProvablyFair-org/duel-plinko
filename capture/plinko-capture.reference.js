// Capture methodology, published for provenance/review.
// Reference record, not a runnable tool.
// Dataset in `data/`, hash-verified by the suite.

if (window._plinkokill) window._plinkokill();

(function () {
  'use strict';

  // ── Instance guard ──────────────────────────────────────────────────────────
  // each paste gets a unique id; the loop checks it every iteration
  // if you re-paste, the old loop sees a mismatch and dies
  var INSTANCE = Date.now();
  window._plinkokill = function () {
    INSTANCE = -1; // signals old loop to stop
  };

  // ── Config ──────────────────────────────────────────────────────────────────
  var PH = {
    A: { name: 'Phase A — 5.4K random', total: 5400, amount: '0.01', rows: null, risk: null },
    B: { name: 'Phase B — 2K 16r/high', total: 2000, amount: '0.01', rows: 16,   risk: 'high' },
    C: { name: 'Phase C — 200 $10',     total: 200,  amount: '10',   rows: 16,   risk: 'high' },
    D: { name: 'Phase D — 500 all-configs custom seed', total: 500, amount: '0.01', rows: null, risk: null },
  };
  var BETS_PER_SEED = 50;
  var BET_DELAY_MS  = 550;
  var MAX_ERRORS    = 8;       // consecutive errors before auto-pause

  // 27 configs (9 rows x 3 risks)
  var CONFIGS = [];
  for (var r = 8; r <= 16; r++)
    for (var ki = 0; ki < 3; ki++)
      CONFIGS.push({ rows: r, risk: ['low', 'medium', 'high'][ki] });

  // balanced queue: exactly 4 epochs per config = 108 epochs = 5,400 bets
  function buildQueue() {
    var shuffle = function (a) {
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.random() * (i + 1) | 0;
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    };
    var q = [];
    // 4 full shuffled passes of all 27 configs = 108 epochs
    for (var i = 0; i < 4; i++) q = q.concat(shuffle(CONFIGS.slice()));
    return shuffle(q); // final shuffle so passes aren't clustered
  }

  // ── State ─────────────────────────────────────────────────────────────────
  // Bets + seeds stay in MEMORY only (too large for localStorage).
  // Only small metadata (counters, queue, token) goes to localStorage.
  // Auto-downloads a backup JSON every AUTO_SAVE_EVERY bets.
  var KEY    = 'plinko_meta';
  var AUTO_SAVE_EVERY = 500;

  function freshMeta() {
    return {
      phase: null, betCount: 0, epochBets: 0,
      epochIdx: 0, globalEpoch: 0, queue: buildQueue(),
      token: null, tokenAt: 0,
      rotationPending: null,
      errors: 0, nullReveals: 0,
      phaseCounts: { A: 0, B: 0, C: 0, D: 0 },
      exportedParts: [],  // track which auto-save files were downloaded
    };
  }

  function fresh() {
    return {
      phase: null, bets: [], seeds: [], epochBets: 0,
      epochIdx: 0, globalEpoch: 0, queue: buildQueue(),
      token: null, tokenAt: 0,
      rotationPending: null,
      errors: 0, nullReveals: 0,
    };
  }

  // load metadata from localStorage
  var meta;
  try { meta = JSON.parse(localStorage.getItem(KEY)) || freshMeta(); } catch (e) { meta = freshMeta(); }
  if (!meta.phaseCounts) meta.phaseCounts = { A: 0, B: 0, C: 0, D: 0 };
  if (!meta.phaseCounts.D) meta.phaseCounts.D = 0; // migrate existing sessions
  if (!meta.exportedParts) meta.exportedParts = [];

  // full state lives in memory only
  var S = fresh();
  // restore small fields from persisted metadata
  S.phase = meta.phase;
  S.epochBets = meta.epochBets;
  S.epochIdx = meta.epochIdx;
  S.globalEpoch = meta.globalEpoch;
  S.queue = meta.queue || buildQueue();
  S.token = meta.token;
  S.tokenAt = meta.tokenAt;
  S.rotationPending = meta.rotationPending;
  S.errors = meta.errors;
  S.nullReveals = meta.nullReveals;

  // restore gameProfiles from localStorage (small ~11 KB)
  try {
    var gp = localStorage.getItem('plinko_gameProfiles');
    if (gp) {
      S.gameProfiles = JSON.parse(gp);
      S.gameProfilesCapturedAt = localStorage.getItem('plinko_gameProfilesAt') || null;
    }
  } catch (e) {}

  function persist() {
    // only save small metadata to localStorage — never bets/seeds
    meta.phase = S.phase;
    meta.betCount = S.bets.length;
    meta.epochBets = S.epochBets;
    meta.epochIdx = S.epochIdx;
    meta.globalEpoch = S.globalEpoch;
    meta.queue = S.queue;
    meta.token = S.token;
    meta.tokenAt = S.tokenAt;
    meta.rotationPending = S.rotationPending;
    meta.errors = S.errors;
    meta.nullReveals = S.nullReveals;
    meta.phaseCounts.A = countPhase('A');
    meta.phaseCounts.B = countPhase('B');
    meta.phaseCounts.C = countPhase('C');
    meta.phaseCounts.D = countPhase('D');
    try {
      localStorage.setItem(KEY, JSON.stringify(meta));
    } catch (e) {
      warn('meta persist failed: ' + e.message);
    }
  }

  function backup() {
    // no-op — replaced by autoSaveFile
  }

  function autoSaveFile() {
    var partNum = meta.exportedParts.length + 1;
    var fname = 'plinko-part' + partNum + '-' + S.bets.length + 'bets-' + Date.now() + '.json';
    var blob = new Blob([JSON.stringify({ part: partNum, bets: S.bets, seeds: S.seeds, evidence: S.evidence || [] }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    meta.exportedParts.push({ part: partNum, bets: S.bets.length, at: new Date().toISOString(), file: fname });
    persist();
    good('auto-saved ' + fname + ' (' + S.bets.length + ' bets)');
  }

  // ── Evidence snapshots (Canvas PNG) ────────────────────────────────────────
  // generates a timestamped proof card with audit data — auto-fires at phase
  // start/end, callable manually via plinko.snap('label')
  if (!S.evidence) S.evidence = [];
  if (S.globalEpoch == null) S.globalEpoch = S.seeds ? S.seeds.length : 0;
  if (S.nullReveals == null) S.nullReveals = 0;

  function renderCard(label, lines) {
    var W = 720, lineH = 20, padTop = 60, padBot = 30;
    var H = padTop + lines.length * lineH + padBot;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');

    // bg
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);
    // top accent
    ctx.fillStyle = '#1e2d3d';
    ctx.fillRect(0, 0, W, 2);

    // title
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#ddeeff';
    ctx.fillText('EVIDENCE: ' + label, 16, 24);

    // timestamp + url
    ctx.font = '11px monospace';
    ctx.fillStyle = '#4d6880';
    ctx.fillText(new Date().toISOString() + '   ' + location.hostname + location.pathname, 16, 42);

    // separator
    ctx.strokeStyle = '#1e2d3d';
    ctx.beginPath(); ctx.moveTo(16, 50); ctx.lineTo(W - 16, 50); ctx.stroke();

    // data lines
    ctx.font = '12px monospace';
    var y = padTop + 4;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.charAt(0) === '!') {
        // highlight line (green)
        ctx.fillStyle = '#2dff82';
        ctx.fillText(line.slice(1), 16, y);
      } else if (line.charAt(0) === '~') {
        // dim line
        ctx.fillStyle = '#4d6880';
        ctx.fillText(line.slice(1), 16, y);
      } else if (line === '---') {
        ctx.strokeStyle = '#1e2d3d';
        ctx.beginPath(); ctx.moveTo(16, y - 6); ctx.lineTo(W - 16, y - 6); ctx.stroke();
      } else {
        ctx.fillStyle = '#b8cfe0';
        ctx.fillText(line, 16, y);
      }
      y += lineH;
    }

    return c;
  }

  function snap(label) {
    if (!label) label = 'manual';

    var pA = countPhase('A'), pB = countPhase('B'), pC = countPhase('C'), pD = countPhase('D');
    var lastBet = S.bets.length > 0 ? S.bets[S.bets.length - 1] : null;
    var lastResp = lastBet ? lastBet.response : {};
    var lastSeed = S.seeds.length > 0 ? S.seeds[S.seeds.length - 1] : null;

    var lines = [
      'Phase A: ' + pA + '/' + PH.A.total + '   Phase B: ' + pB + '/' + PH.B.total + '   Phase C: ' + pC + '/' + PH.C.total + '   Phase D: ' + pD + '/' + PH.D.total,
      'Total bets: ' + S.bets.length + '   Seeds: ' + S.seeds.length + '   Epoch: ' + S.epochIdx,
      '---',
      'Current seed hash:',
      '  ' + (lastResp.server_seed_hashed || (lastSeed && lastSeed.seed.serverSeedHashed) || 'n/a'),
      'Client seed:  ' + (lastResp.client_seed || (lastSeed && lastSeed.seed.clientSeed) || 'n/a'),
      'Nonce:        ' + (lastResp.nonce != null ? lastResp.nonce : S.epochBets),
      '---',
    ];

    if (lastBet) {
      lines.push('Last bet:');
      lines.push('  phase=' + lastBet.phase + '  config=' + lastBet.request.rows + 'r/' + lastBet.request.risk_level + '  amount=$' + lastBet.request.amount);
      lines.push('  slot=' + lastResp.final_slot + '  mult=' + lastResp.payout_multiplier + '  win=$' + lastResp.win_amount);
      lines.push('  id=' + lastResp.id);
    }

    if (lastSeed && lastSeed.seed.serverSeed) {
      lines.push('---');
      lines.push('Last revealed seed:');
      lines.push('  ' + lastSeed.seed.serverSeed);
      lines.push('~  context: ' + lastSeed.context);
    }

    var c = renderCard(label, lines);

    // save as download
    c.toBlob(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'evidence-' + label.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() + '-' + Date.now() + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    // store metadata in state (not the image blob — just the proof data)
    var entry = {
      at: new Date().toISOString(),
      label: label,
      bets: S.bets.length,
      seeds: S.seeds.length,
      phase: S.phase,
      phaseA: pA, phaseB: pB, phaseC: pC, phaseD: pD,
      epochIdx: S.epochIdx,
      epochBets: S.epochBets,
      seedHash: lastResp.server_seed_hashed || (lastSeed && lastSeed.seed.serverSeedHashed) || null,
      clientSeed: lastResp.client_seed || (lastSeed && lastSeed.seed.clientSeed) || null,
      nonce: lastResp.nonce != null ? lastResp.nonce : S.epochBets,
    };
    S.evidence.push(entry);
    persist();

    good('evidence snapshot: ' + label + ' (' + S.evidence.length + ' total)');
  }

  // auto-snap helper (called at phase boundaries)
  function autoSnap(label) {
    try { snap(label); } catch (e) { warn('auto-snap failed: ' + e.message); }
  }

  // ── Logging ─────────────────────────────────────────────────────────────────
  function ts() { return new Date().toTimeString().slice(0, 8); }
  function info(msg)  { console.log('%c[plinko ' + ts() + '] ' + msg, 'color:#33ccff'); updatePanel(); }
  function good(msg)  { console.log('%c[plinko ' + ts() + '] ' + msg, 'color:#2dff82;font-weight:bold'); updatePanel(); }
  function warn(msg)  { console.warn('[plinko ' + ts() + '] ' + msg); updatePanel(); }
  function bad(msg)   { console.error('[plinko ' + ts() + '] ' + msg); updatePanel(); }

  // ── API ─────────────────────────────────────────────────────────────────────
  function api(method, path, body) {
    var deviceId = localStorage.getItem('security:uuid') || '';
    var opts = {
      method: method, credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/plain, */*',
        'x-duel-device-identifier': deviceId,
        'x-env-class': localStorage.getItem('env_class') || 'blue',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok) throw new Error(path + ' ' + res.status + ': ' + JSON.stringify(j).slice(0, 200));
        return j.data || j;
      });
    });
  }

  function refreshToken() {
    var secUuid = localStorage.getItem('security:uuid');
    if (!secUuid) { return Promise.reject(new Error('security:uuid not found in localStorage — are you logged in?')); }
    return api('POST', '/api/v2/user/security/token', {
      uuid: secUuid,
      code: '0000',
      type: 'standard',
    }).then(function (r) {
      S.token = r.token || r;
      S.tokenAt = Date.now();
      persist();
      info('token refreshed');
    });
  }

  function getToken() {
    if (!S.token || Date.now() - S.tokenAt > 8 * 60 * 1000) return refreshToken().then(function () { return S.token; });
    return Promise.resolve(S.token);
  }

  // risk level mapping: API expects integers 1/2/3 (from plinkoConfig.json risk_levels)
  var RISK_INT = { low: 1, medium: 2, high: 3 };

  function placeBet(rows, risk, amount) {
    return getToken().then(function (token) {
      return api('POST', '/api/v2/games/plinko/bet', {
        rows: rows, risk_level: RISK_INT[risk] != null ? RISK_INT[risk] : risk, amount: amount,
        currency: 105, instant: true, security_token: token,
      });
    });
  }

  function getActiveSeed() {
    return api('GET', '/api/v2/client-seed').catch(function () { return null; });
  }

  function generateClientSeed() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var s = '';
    for (var i = 0; i < 16; i++) s += chars.charAt(Math.random() * chars.length | 0);
    return s;
  }

  // Phase D: deterministic auditable client seed stored per session
  var PHASE_D_SEED_KEY = 'plinko_phaseD_seed';
  function getPhaseDSeed() {
    var stored = localStorage.getItem(PHASE_D_SEED_KEY);
    if (stored) return stored;
    // generate once: 'pfaudit-' prefix makes it visually identifiable in API responses
    var rnd = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    var seed = 'pfaudit-' + rnd;
    localStorage.setItem(PHASE_D_SEED_KEY, seed);
    return seed;
  }

  function rotateSeed(customSeed) {
    var newSeed = customSeed != null ? customSeed : generateClientSeed();
    return api('POST', '/api/v2/client-seed/rotate', { client_seed: newSeed }).then(function (r) {
      return refreshToken().then(function () { return r; });
    });
  }

  function getTransaction(txId) {
    return api('GET', '/api/v2/user/transactions/' + txId);
  }

  function loadConfig(json) {
    // accepts raw plinkoConfig.json content (the object with success/data keys)
    // or just the data portion directly
    var d = json && json.data ? json.data : json;
    if (!d || !d.payout_tables) {
      warn('loadConfig: invalid data — expected plinkoConfig.json content with payout_tables');
      return;
    }
    if (!d.probabilities) warn('loadConfig: missing probabilities — RTP computation will be incomplete');
    if (!d.scaling_edge) warn('loadConfig: missing scaling_edge — EC-32 table source check will be incomplete');
    // store only payout_tables, probabilities, risk_levels, rows (~11 KB)
    // scaling_edge is ~2.9 MB and would blow the 5 MB localStorage limit
    // verification code reads scaling_edge directly from plinkoConfig.json file
    var slim = {
      rows: d.rows,
      risk_levels: d.risk_levels,
      payout_tables: d.payout_tables,
      probabilities: d.probabilities,
      _hasScalingEdge: !!d.scaling_edge,
      _scalingEdgeBrackets: d.scaling_edge ? (d.scaling_edge[Object.keys(d.payout_tables)[0]] || {}).low ? d.scaling_edge[Object.keys(d.payout_tables)[0]].low.length : 0 : 0,
    };
    S.gameProfiles = slim;
    S.gameProfilesCapturedAt = new Date().toISOString();
    try {
      localStorage.setItem('plinko_gameProfiles', JSON.stringify(slim));
      localStorage.setItem('plinko_gameProfilesAt', S.gameProfilesCapturedAt);
    } catch (e) { warn('could not persist gameProfiles: ' + e.message); }
    persist();
    var rows = Object.keys(d.payout_tables);
    good('loaded plinkoConfig: ' + rows.length + ' row counts (' + rows.join(',') + '), ' +
      Object.keys(d.risk_levels || {}).length + ' risk levels' +
      (d.probabilities ? ', probabilities OK' : '') +
      (d.scaling_edge ? ', scaling_edge present (' + slim._scalingEdgeBrackets + ' brackets, stripped from state to save space)' : ''));
  }

  // ── Config picker ───────────────────────────────────────────────────────────
  function epochConfig() {
    if (S.phase !== 'A' && S.phase !== 'D') return { rows: PH[S.phase].rows, risk: PH[S.phase].risk };
    return S.queue[S.epochIdx % S.queue.length];
  }

  // ── Phase bet count ─────────────────────────────────────────────────────────
  // _prevCounts: bets from previous sessions (frozen at script load from meta)
  // in-memory bets are counted on top
  var _prevCounts = { A: meta.phaseCounts.A || 0, B: meta.phaseCounts.B || 0, C: meta.phaseCounts.C || 0, D: meta.phaseCounts.D || 0 };
  var _ccache = { len: -1, A: 0, B: 0, C: 0, D: 0 };
  function countPhase(ph) {
    if (_ccache.len !== S.bets.length) {
      _ccache.A = _prevCounts.A;
      _ccache.B = _prevCounts.B;
      _ccache.C = _prevCounts.C;
      _ccache.D = _prevCounts.D;
      for (var i = 0; i < S.bets.length; i++) _ccache[S.bets[i].phase]++;
      _ccache.len = S.bets.length;
    }
    return _ccache[ph] || 0;
  }

  // ── Duplicate check ─────────────────────────────────────────────────────────
  function hasBetId(id) {
    for (var i = S.bets.length - 1; i >= Math.max(0, S.bets.length - 100); i--) {
      if (S.bets[i].response && S.bets[i].response.id === id) return true;
    }
    return false;
  }

  // ── Seed rotation (checkpoint-based) ────────────────────────────────────────
  // Uses rotation response for promotion verification (2 API calls: rotate + transaction)
  function doRotation() {
    info('rotating seed (epoch ' + S.epochIdx + ')...');

    var lastBet = S.bets.length > 0 ? S.bets[S.bets.length - 1] : null;
    var lastBetTxId = lastBet && lastBet.response ? (lastBet.response.transaction_id || lastBet.response.id) : null;

    // On first rotation, fetch active seed to populate _lastNextHash
    var initPromise = S._lastNextHash
      ? Promise.resolve()
      : getActiveSeed().then(function (pre) {
          if (pre && pre.next_server_seed_hash) {
            S._lastNextHash = pre.next_server_seed_hash;
            persist();
            info('initial next_hash captured: ' + pre.next_server_seed_hash.slice(0, 16) + '...');
          }
        });

    return initPromise.then(function () {
      // checkpoint before rotating
      S.rotationPending = { at: new Date().toISOString(), phase: S.phase, epochIdx: S.epochIdx };
      persist();

      return rotateSeed().then(function (rot) {
        // Build seed entry from rotation response
        var entry = {
          at:      new Date().toISOString(),
          context: 'rotate-epoch-' + S.epochIdx + '-phase-' + S.phase,
          phase:   S.phase,
          seed: {
            clientSeed:         rot.client_seed || 'unknown',
            serverSeedHashed:   rot.server_seed_hashed || 'unknown',
            serverSeed:         null,
            nextServerSeedHash: rot.next_server_seed_hash || null,
          },
          nonce: S.epochBets,
        };

        // Promotion check: compare previous _lastNextHash with new active hash
        if (S._lastNextHash) {
          var promoted = rot.server_seed_hashed === S._lastNextHash;
          entry.nextSeedPromotion = {
            expectedActive: S._lastNextHash,
            actualActive: rot.server_seed_hashed,
            match: promoted
          };
          if (promoted) {
            good('next-seed promotion verified');
          } else {
            bad('NEXT-SEED PROMOTION FAILED! Expected: ' + S._lastNextHash.slice(0,16) + ' Got: ' + rot.server_seed_hashed.slice(0,16));
          }
        }

        // Save next hash for the following rotation
        S._lastNextHash = rot.next_server_seed_hash;

        // Fetch revealed seed from last bet's transaction
        var txId = lastBetTxId || (rot.server_seed_revealed && rot.server_seed_revealed.transaction_id) || rot.transaction_id;
        var revealPromise = txId
          ? getTransaction(txId).then(function (tx) {
              return tx.server_seed || (tx.data && tx.data.server_seed) || null;
            }).catch(function () { return null; })
          : Promise.resolve(null);

        return revealPromise.then(function (revealed) {
          entry.seed.serverSeed = revealed;
          entry.revealedFrom = { transactionId: txId };

          // track consecutive null reveals
          if (!revealed) {
            S.nullReveals = (S.nullReveals || 0) + 1;
            if (S.nullReveals >= 3) {
              bad('WARNING: ' + S.nullReveals + ' consecutive NULL seed reveals — check API response structure');
            }
          } else {
            S.nullReveals = 0;
          }

          S.seeds.push(entry);
          S.rotationPending = null; // clear checkpoint
          persist();

          good('rotated. revealed: ' + (revealed ? revealed.slice(0, 16) + '...' : 'PENDING'));
        });
      });
    });
  }

  // ── Recover interrupted rotation ────────────────────────────────────────────
  function recoverRotation() {
    if (!S.rotationPending) return Promise.resolve();

    warn('found interrupted rotation — recovering...');
    var entry = S.rotationPending;

    // the rotation may or may not have completed server-side
    // safest: just record what we have and move on
    // the seed will be revealed on the NEXT rotation anyway
    S.seeds.push(entry);
    S.rotationPending = null;
    persist();
    info('recovered partial rotation entry (seed may need manual reveal later)');
    return Promise.resolve();
  }

  // ── Nonce sync ──────────────────────────────────────────────────────────────
  function syncNonce() {
    return getActiveSeed().then(function (seed) {
      if (!seed) { warn('could not fetch active seed for sync'); return; }

      var serverNonce = (seed.nonce != null) ? seed.nonce : 0;
      var localEpochBets = S.epochBets;
      var lastBet = S.bets.length > 0 ? S.bets[S.bets.length - 1] : null;
      var lastNonce = lastBet && lastBet.response ? lastBet.response.nonce : '?';

      info('sync check:  server nonce=' + serverNonce + '  local epochBets=' + localEpochBets + '  last captured nonce=' + lastNonce);

      if (serverNonce !== localEpochBets) {
        warn('nonce mismatch! server=' + serverNonce + ' local=' + localEpochBets);
        warn('adjusting local epochBets from ' + localEpochBets + ' to ' + serverNonce);
        S.epochBets = serverNonce;
        persist();
      } else {
        good('nonces in sync');
      }
    });
  }

  // ── Main loop ──────────────────────────────────────────────────────────────
  var _running = false;
  var _stop    = false;
  var _myInstance = INSTANCE;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function run(phase) {
    if (_running) { warn('already running — call plinko.pause() first'); return; }

    _myInstance = INSTANCE;
    S.phase    = phase;
    S.errors   = 0;
    _running   = true;
    _stop      = false;
    persist();

    var ph = PH[phase];
    var done = countPhase(phase);

    if (done >= ph.total) {
      good(ph.name + ' already complete (' + done + '/' + ph.total + ')');
      _running = false;
      return;
    }

    info((done > 0 ? 'resuming' : 'starting') + ' ' + ph.name + ' at ' + done + '/' + ph.total);

    // recover any interrupted rotation
    recoverRotation().then(function () {
      // restore epoch position from bet count FIRST (baseline)
      S.epochBets = done % BETS_PER_SEED;
      S.epochIdx  = Math.floor(done / BETS_PER_SEED);
      persist();

      // then sync nonce with server — this may override epochBets if server disagrees
      return syncNonce();
    }).then(function () {
      // initial seed commitment (only if phase has 0 bets)
      if (done === 0) {
        // Phase D: rotate to our known custom client seed first, then capture commitment
        var preRotate = (phase === 'D')
          ? rotateSeed(getPhaseDSeed()).then(function () {
              good('Phase D: rotated to custom client seed: ' + getPhaseDSeed());
            }).catch(function (e) {
              warn('Phase D: custom seed rotation failed: ' + e.message + ' — proceeding with existing seed');
            })
          : Promise.resolve();

        return preRotate.then(function () {
          return getActiveSeed().then(function (seed) {
            if (!seed) return;
            var already = S.seeds.some(function (s) { return s.context === 'pre-capture-phase-' + phase; });
            if (already) return;
            S.seeds.push({
              at: new Date().toISOString(), context: 'pre-capture-phase-' + phase, phase: phase,
              seed: { clientSeed: seed.client_seed, serverSeedHashed: seed.server_seed_hashed, serverSeed: null },
              nonce: seed.nonce,
              phaseDCustomSeed: phase === 'D' ? getPhaseDSeed() : undefined,
            });
            persist();
            info('captured initial seed commitment' + (phase === 'D' ? ' (custom seed: ' + getPhaseDSeed() + ')' : ''));
            autoSnap('phase-' + phase + '-start');
          });
        });
      }
    }).then(function () {
      return loop(phase);
    }).catch(function (e) {
      bad('startup error: ' + e.message);
      _running = false;
    });
  }

  function loop(phase) {
    // source of truth: count from actual stored bets (not a local counter)
    var done = countPhase(phase);

    // instance guard: if script was re-pasted, stop this loop
    if (_myInstance !== INSTANCE) {
      info('old instance detected — stopping');
      _running = false;
      return Promise.resolve();
    }

    if (_stop) {
      _running = false;
      info('paused at ' + done + '/' + PH[phase].total);
      persist();
      return Promise.resolve();
    }

    var ph = PH[phase];
    if (done >= ph.total) {
      // final rotation to reveal last epoch seed — wait 2s for active round to settle
      return sleep(2000).then(function () { return doRotation(); }).then(function () {
        S.epochBets = 0;
        S.epochIdx++;
        S.globalEpoch++;
        _running = false;
        persist();
        // report reveal health
        var nullCount = 0;
        for (var si = 0; si < S.seeds.length; si++) {
          if (S.seeds[si].seed && !S.seeds[si].seed.serverSeed) nullCount++;
        }
        if (nullCount > 0) warn(nullCount + '/' + S.seeds.length + ' seeds have NULL reveals — check manually');
        good('Phase ' + phase + ' DONE — ' + done + ' bets');
        autoSnap('phase-' + phase + '-complete');

        // auto-advance to next incomplete phase (not just the immediate next)
        var order = ['A', 'B', 'C', 'D'];
        for (var ni = order.indexOf(phase) + 1; ni < order.length; ni++) {
          var nextPh = order[ni];
          if (countPhase(nextPh) < PH[nextPh].total) {
            info('auto-advancing to ' + PH[nextPh].name + ' in 3s...');
            return sleep(3000).then(function () {
              if (!_stop) run(nextPh);
            });
          }
        }
        good('all phases complete! run plinko.save() to export');
      }).catch(function (e) {
        warn('final rotation failed: ' + e.message + ' — phase still done, seed needs manual reveal');
        _running = false;
      });
    }

    // seed rotation at epoch boundary — wait 2s for any active round to settle
    var rotationNeeded = S.epochBets >= BETS_PER_SEED;
    var rotatePromise = rotationNeeded
      ? sleep(2000).then(function () {
          return doRotation().then(function () { S.epochBets = 0; S.epochIdx++; S.globalEpoch++; persist(); });
        })
      : Promise.resolve();

    return rotatePromise.then(function () {
      var cfg = epochConfig();

      return placeBet(cfg.rows, cfg.risk, ph.amount).then(function (resp) {
        // duplicate check
        if (resp.id && hasBetId(resp.id)) {
          warn('duplicate bet id ' + resp.id + ' — skipping');
          return sleep(BET_DELAY_MS).then(function () { return loop(phase); });
        }

        // config echo validation: verify server used the config we requested
        if (resp.rows != null && resp.rows !== cfg.rows) {
          bad('CONFIG MISMATCH: requested rows=' + cfg.rows + ' but server returned rows=' + resp.rows);
        }
        // server echoes risk as string ("low"/"medium"/"high"), compare against our string config
        if (resp.risk_level != null && resp.risk_level !== cfg.risk && resp.risk_level !== RISK_INT[cfg.risk]) {
          bad('CONFIG MISMATCH: requested risk=' + cfg.risk + ' but server returned risk=' + resp.risk_level);
        }

        // $0 bet guard: if effective amount is zero, nonce may not have incremented server-side
        var effectiveAmt = parseFloat(resp.amount_currency || resp.amount || ph.amount);
        if (effectiveAmt === 0) {
          bad('$0 EFFECTIVE BET detected (id=' + resp.id + ') — nonce may be desynced. Pausing.');
          _stop = true;
        }

        // slim response to essential verification fields only (~540 bytes vs ~1.2 KB)
        var slimResp = {
          id: resp.id, rows: resp.rows, risk_level: resp.risk_level,
          final_slot: resp.final_slot, payout_multiplier: resp.payout_multiplier,
          amount_currency: resp.amount_currency, win_amount: resp.win_amount,
          nonce: resp.nonce, server_seed_hashed: resp.server_seed_hashed,
          client_seed: resp.client_seed, transaction_id: resp.transaction_id,
          effective_edge: resp.effective_edge, created_at: resp.created_at,
        };

        S.bets.push({
          at:       new Date().toISOString(),
          phase:    phase,
          request:  { rows: cfg.rows, risk_level: cfg.risk, risk_int: RISK_INT[cfg.risk], amount: ph.amount, currency: 105 },
          response: slimResp,
        });

        S.epochBets++;
        done++;
        S.errors = 0;
        persist();

        // auto-save to file every N bets
        if (done % AUTO_SAVE_EVERY === 0) {
          autoSaveFile();
        }

        // log every 10 bets or on epoch start
        if (done % 10 === 0 || S.epochBets === 1) {
          var mult = resp.payout_multiplier || '?';
          var cfgStr = cfg.rows + 'r/' + cfg.risk;
          info(phase + ' ' + done + '/' + ph.total + '  ' + cfgStr + '  nonce=' + (resp.nonce != null ? resp.nonce : '?') + '  mult=' + mult);
        }

        return sleep(BET_DELAY_MS).then(function () { return loop(phase); });

      }).catch(function (e) {
        S.errors++;
        persist();

        if (S.errors >= MAX_ERRORS) {
          bad('hit ' + MAX_ERRORS + ' consecutive errors — auto-pausing');
          bad('last error: ' + e.message);
          _running = false;
          return;
        }

        // token error → refresh and retry
        if (e.message.indexOf('401') !== -1 || e.message.indexOf('security') !== -1 || e.message.indexOf('token') !== -1) {
          warn('token issue — refreshing (' + S.errors + '/' + MAX_ERRORS + ')');
          return refreshToken().then(function () {
            return sleep(1500).then(function () { return loop(phase); });
          });
        }

        // rate limit or server error → back off
        if (e.message.indexOf('429') !== -1 || e.message.indexOf('500') !== -1 || e.message.indexOf('502') !== -1) {
          var backoff = Math.min(2000 * S.errors, 30000);
          warn('server error — backing off ' + (backoff / 1000) + 's (' + S.errors + '/' + MAX_ERRORS + ')');
          return sleep(backoff).then(function () { return loop(phase); });
        }

        // unknown error
        bad('error (' + S.errors + '/' + MAX_ERRORS + '): ' + e.message);
        return sleep(3000).then(function () { return loop(phase); });
      });
    }).catch(function (e) {
      // rotation failed
      S.errors++;
      persist();
      if (S.errors >= MAX_ERRORS) {
        bad('rotation failed ' + MAX_ERRORS + ' times — auto-pausing');
        _running = false;
        return;
      }
      warn('rotation error — retrying in 5s: ' + e.message);
      return sleep(5000).then(function () { return loop(phase); });
    });
  }

  // ── Smart resume ────────────────────────────────────────────────────────────
  function go() {
    // find first incomplete phase
    var order = ['A', 'B', 'C', 'D'];
    for (var i = 0; i < order.length; i++) {
      var ph = order[i];
      var n = countPhase(ph);
      if (n < PH[ph].total) {
        info('auto-resume: ' + PH[ph].name + ' — ' + n + '/' + PH[ph].total + ' done');
        run(ph);
        return;
      }
    }
    good('all phases complete! run plinko.save() to export');
  }

  // ── Export ──────────────────────────────────────────────────────────────────
  function save() {
    // seed reveal health summary
    var commitments = 0, failedReveals = 0;
    for (var rs = 0; rs < S.seeds.length; rs++) {
      if (S.seeds[rs].seed && !S.seeds[rs].seed.serverSeed) {
        if (S.seeds[rs].context && S.seeds[rs].context.indexOf('pre-capture') !== -1) commitments++;
        else failedReveals++;
      }
    }
    if (failedReveals > 0) warn('export note: ' + failedReveals + ' seeds have NULL reveals (excluding ' + commitments + ' commitments)');

    var dataset = {
      exportedAt: new Date().toISOString(),
      version:    'plinko',
      phases: Object.keys(PH).map(function (id) {
        var p = PH[id];
        return { id: id, name: p.name, totalTarget: p.total, amount: p.amount, rows: p.rows, risk: p.risk, captured: countPhase(id) };
      }),
      configQueue: S.queue.map(function (c) { return { rows: c.rows, risk: c.risk }; }),
      bets:     S.bets,
      seeds:    S.seeds,
      evidence: S.evidence || [],
      seedHealth: { total: S.seeds.length, commitments: commitments, revealed: S.seeds.length - commitments - failedReveals, failedReveals: failedReveals },
      gameProfiles: S.gameProfiles || null,
      gameProfilesCapturedAt: S.gameProfilesCapturedAt || null,
    };

    // clear security token from localStorage (no longer needed)
    S.token = null;
    S.tokenAt = 0;
    persist();
    var blob = new Blob([JSON.stringify(dataset, null, 2)], { type: 'application/json' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = 'duel-plinko-' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    good('exported ' + S.bets.length + ' bets + ' + S.seeds.length + ' seed entries');
  }

  // ── Status ─────────────────────────────────────────────────────────────────
  function status() {
    var lines = [
      '',
      '  Plinko v3 Capture — ' + (_running ? 'RUNNING ' + S.phase : 'idle'),
      '  ────────────────────────────────────────',
    ];

    var order = ['A', 'B', 'C', 'D'];
    for (var i = 0; i < order.length; i++) {
      var id = order[i];
      var n = countPhase(id);
      var tot = PH[id].total;
      var pct = (n / tot * 100).toFixed(0);
      var blen = Math.round(n / tot * 20);
      var bar = '';
      for (var b = 0; b < 20; b++) bar += b < blen ? '\u2588' : '\u2591';
      var marker = n >= tot ? ' \u2713' : (S.phase === id && _running ? ' \u25C0' : '');
      lines.push('  ' + id + ': ' + bar + '  ' + String(n).padStart(5) + '/' + tot + '  (' + pct + '%)' + marker);
    }

    lines.push('');
    lines.push('  total bets: ' + S.bets.length + '  |  seeds: ' + S.seeds.length + '  |  global epoch: ' + (S.globalEpoch || 0));
    lines.push('  phase epoch: '  + S.epochIdx + '  |  epoch bets: ' + S.epochBets + '/' + BETS_PER_SEED);
    if (S.errors > 0) lines.push('  consecutive errors: ' + S.errors + '/' + MAX_ERRORS);
    if (S.rotationPending) lines.push('  \u26A0 interrupted rotation pending');

    // seed reveal health
    var nullSeeds = 0;
    for (var rs = 0; rs < S.seeds.length; rs++) {
      if (S.seeds[rs].seed && !S.seeds[rs].seed.serverSeed) nullSeeds++;
    }
    if (nullSeeds > 0) lines.push('  \u26A0 ' + nullSeeds + '/' + S.seeds.length + ' seeds with NULL reveals');

    // latest nextServerSeedHash
    var lastSeedEntry = S.seeds.length > 0 ? S.seeds[S.seeds.length - 1] : null;
    if (lastSeedEntry && lastSeedEntry.seed && lastSeedEntry.seed.nextServerSeedHash) {
      lines.push('  nextServerSeedHash: ' + lastSeedEntry.seed.nextServerSeedHash);
    }

    // next action hint
    lines.push('');
    // show Phase D custom seed if set
    var dSeed = localStorage.getItem(PHASE_D_SEED_KEY);
    if (dSeed) lines.push('  Phase D client seed: ' + dSeed);

    var nextPhase = null;
    for (var j = 0; j < order.length; j++) {
      if (countPhase(order[j]) < PH[order[j]].total) { nextPhase = order[j]; break; }
    }
    if (_running)     lines.push('  \u25B6 running — plinko.pause() to stop');
    else if (nextPhase) lines.push('  \u25B6 next: plinko.go() or plinko.' + nextPhase.toLowerCase() + '()');
    else              lines.push('  \u2713 all done — plinko.save() to export');

    // config distribution for Phase A
    if (S.bets.some(function (b) { return b.phase === 'A'; })) {
      var dist = {};
      S.bets.forEach(function (b) {
        if (b.phase !== 'A') return;
        var k = b.request.rows + 'r/' + b.request.risk_level;
        dist[k] = (dist[k] || 0) + 1;
      });
      lines.push('');
      lines.push('  Phase A config distribution:');
      var sorted = Object.keys(dist).sort();
      for (var si = 0; si < sorted.length; si++) {
        var cfg = sorted[si];
        lines.push('    ' + cfg.padEnd(14) + String(dist[cfg]).padStart(4) + ' bets');
      }
    }

    console.log(lines.join('\n'));
    return lines.join('\n');
  }

  // ── Clear ──────────────────────────────────────────────────────────────────
  function clear() {
    if (_running) { warn('pause first'); return; }
    S = fresh();
    meta = freshMeta();
    _prevCounts.A = 0; _prevCounts.B = 0; _prevCounts.C = 0; _prevCounts.D = 0;
    _ccache.len = -1;
    persist();
    localStorage.removeItem('plinko_state');
    localStorage.removeItem('plinko_backup');
    localStorage.removeItem('plinko_gameProfiles');
    localStorage.removeItem('plinko_gameProfilesAt');
    localStorage.removeItem(PHASE_D_SEED_KEY);
    good('all data cleared');
    updatePanel();
  }

  // ── Floating panel ─────────────────────────────────────────────────────────
  function buildPanel() {
    var old = document.getElementById('plinkop');
    if (old) old.remove();

    var d = document.createElement('div');
    d.id = 'plinkop';
    Object.assign(d.style, {
      position:'fixed', bottom:'16px', right:'16px', zIndex:'99999',
      background:'#0d1117', border:'1px solid #1e2d3d', borderRadius:'6px',
      padding:'10px 14px', fontFamily:'monospace', fontSize:'10px',
      color:'#b8cfe0', minWidth:'240px', boxShadow:'0 4px 20px rgba(0,0,0,.6)',
      cursor:'move', userSelect:'none',
    });

    // draggable
    var dragging = false, ox = 0, oy = 0;
    d.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true; ox = e.clientX - d.offsetLeft; oy = e.clientY - d.offsetTop;
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      d.style.left = (e.clientX - ox) + 'px'; d.style.top = (e.clientY - oy) + 'px';
      d.style.right = 'auto'; d.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function () { dragging = false; });

    // title
    var title = document.createElement('div');
    title.textContent = 'plinko capture';
    Object.assign(title.style, { fontWeight:'700', fontSize:'12px', color:'#ddeeff', marginBottom:'6px' });
    d.appendChild(title);

    // status line
    var st = document.createElement('div');
    st.id = 'plinko-st';
    Object.assign(st.style, { marginBottom:'6px', color:'#4d6880', fontSize:'10px' });
    d.appendChild(st);

    // progress bars
    var phaseIds = ['A', 'B', 'C', 'D'];
    for (var pi = 0; pi < phaseIds.length; pi++) {
      var id = phaseIds[pi];
      var row = document.createElement('div');
      Object.assign(row.style, { display:'flex', alignItems:'center', gap:'6px', marginBottom:'3px' });
      var lbl = document.createElement('span');
      lbl.textContent = id;
      lbl.style.width = '12px';
      lbl.style.color = '#4d6880';
      var barOuter = document.createElement('div');
      Object.assign(barOuter.style, { flex:'1', height:'6px', background:'#161e28', borderRadius:'3px', overflow:'hidden' });
      var fill = document.createElement('div');
      fill.id = 'plinko-bar-' + id;
      Object.assign(fill.style, { height:'100%', width:'0%', background:'#2dff82', borderRadius:'3px', transition:'width .3s' });
      barOuter.appendChild(fill);
      var ct = document.createElement('span');
      ct.id = 'plinko-ct-' + id;
      ct.textContent = '0';
      Object.assign(ct.style, { width:'55px', textAlign:'right', fontSize:'9px', color:'#4d6880' });
      row.appendChild(lbl);
      row.appendChild(barOuter);
      row.appendChild(ct);
      d.appendChild(row);
    }

    // buttons
    var btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display:'flex', gap:'4px', marginTop:'8px' });

    function mkBtn(text, color, fn) {
      var b = document.createElement('button');
      b.textContent = text;
      Object.assign(b.style, {
        flex:'1', padding:'3px 0', background:'#161e28', border:'1px solid #1e2d3d',
        color: color, borderRadius:'2px', cursor:'pointer', fontFamily:'monospace',
        fontSize:'9px', fontWeight:'700',
      });
      b.addEventListener('click', fn);
      return b;
    }

    btnRow.appendChild(mkBtn('\u25B6 GO', '#2dff82', go));
    btnRow.appendChild(mkBtn('||', '#ffcc44', function () { _stop = true; }));
    btnRow.appendChild(mkBtn('\u{1F4F7}', '#bb66ff', function () { snap('manual-' + S.bets.length); }));
    btnRow.appendChild(mkBtn('DL', '#33ccff', save));
    d.appendChild(btnRow);

    document.body.appendChild(d);
  }

  function updatePanel() {
    var phaseIds = ['A', 'B', 'C', 'D'];
    for (var i = 0; i < phaseIds.length; i++) {
      var id = phaseIds[i];
      var n   = countPhase(id);
      var tot = PH[id].total;
      var bar = document.getElementById('plinko-bar-' + id);
      var ct  = document.getElementById('plinko-ct-' + id);
      if (bar) bar.style.width = Math.min(100, n / tot * 100) + '%';
      if (ct)  ct.textContent = n + '/' + tot;
      if (bar && n >= tot) bar.style.background = '#33ccff';
    }
    var st = document.getElementById('plinko-st');
    if (st) {
      var errStr = S.errors > 0 ? '  err:' + S.errors : '';
      st.textContent = (_running ? '\u25CF ' + S.phase + ' running' : '\u25CB idle') + '  |  ' + S.bets.length + ' bets' + errStr;
      st.style.color = _running ? '#2dff82' : '#4d6880';
    }
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  buildPanel();
  updatePanel();

  // gameProfiles loaded manually via plinko.loadConfig(JSON.parse('...'))
  if (S.gameProfiles) {
    info('plinkoConfig already loaded at ' + S.gameProfilesCapturedAt);
  } else {
    info('no plinkoConfig loaded yet — run plinko.loadConfig(JSON.parse(\'<plinkoConfig.json contents>\'))');
  }

  var total = S.bets.length;
  var prevBets = meta.betCount || 0;
  if (total > 0) {
    var pA = countPhase('A'), pB = countPhase('B'), pC = countPhase('C'), pD = countPhase('D');
    var evCount = (S.evidence || []).length;
    good('resumed: ' + total + ' bets in memory (A:' + pA + ' B:' + pB + ' C:' + pC + ' D:' + pD + ')  evidence: ' + evCount + ' snaps');
    if (S.rotationPending) warn('interrupted rotation detected — will recover on next run');
    console.log('%c  run plinko.go() to continue, plinko.status() for details, plinko.snap() for evidence', 'color:#4d6880');
  } else if (prevBets > 0) {
    good('metadata restored: ' + prevBets + ' bets previously captured (A:' + meta.phaseCounts.A + ' B:' + meta.phaseCounts.B + ' C:' + meta.phaseCounts.C + ' D:' + meta.phaseCounts.D + ')');
    warn('bets are in downloaded files, not in memory — counters will resume correctly');
    console.log('%c  run plinko.go() to continue from where you left off', 'color:#4d6880');
  } else {
    good('plinko v3 capture ready — fresh session');
    console.log('%c  run plinko.go() to start, plinko.status() for help', 'color:#4d6880');
  }

  });
console.log('[plinko] reference record loaded — see data/ for the captured dataset');
