(() => {
  'use strict';
  if (window.__chessTutorLoaded) return;
  window.__chessTutorLoaded = true;
  const L = window.CTLib, G = window.CTGame;
  if (!L || !G) { console.warn('Chess Tutor: lib.js / game.js did not load'); return; }
  // Troll mode is optional: if troll.js / troll-ui.js are missing the tutor keeps working exactly as before.
  const T = window.CTTroll || null, TU = window.CTTrollUI || null;

  // ---------- Config ----------
  // The ELO presets are the strength target: the depth the answer is read from. They are not a search cap -
  // Think time decides how long the engine actually searches, at every level. depth 0 = no strength cap at all
  // (the deepest line of the search is played), which is what "Full engine (max)" means.
  const PRESETS = { 400: 1, 600: 2, 800: 3, 1000: 5, 1200: 7, 1500: 10, 1800: 14, 2000: 18, 2500: 22, 3200: 0 };
  const TIPS = {
    400: "Players at this level often don't see threats more than 1 move ahead.",
    600: 'Common mistake: leaving pieces undefended. Watch for free captures.',
    800: 'Players here know basic tactics but miss combinations.',
    1000: 'Opening principles start to matter. Control the center.',
    1200: 'Players understand basic endgames and piece activity.',
    1500: 'Positional play begins. Weak squares and pawn structure matter.',
    1800: 'Near-master level. Accurate calculation and planning.',
    2000: 'Engine-level play. Best move always chosen.',
    2500: 'Super-GM strength. Deep calculation, almost no inaccuracies.',
    3200: 'Full engine strength. The objectively best move.'
  };
  const DEFAULTS = {
    elo: 1200, custom: false, depth: 24, time: 5, hash: 128,
    showBest: true, showTop3: true, auto: true, side: 'me', open: true,
    pos: null, opacity: 100,
    // Think time (S.time) is how long Stockfish searches before it answers AND before auto-play moves, at every
    // ELO level. Auto-play has its own strength setting (autoplayElo) but shares that think time.
    // mateMode 'shortest' = take the fewest-move forced mate the engine proved; 'normal' = the regular top line;
    // 'hunter' = aggressive: any proven mate (including one only the deepest iteration found), otherwise the most
    // aggressive sound candidate - check, bait, attack on the king - within huntRisk of the best line.
    // huntRisk = how much evaluation the hunter may give up for that: sound 0.3 / balanced 0.6 / very 1.2 pawns.
    // mistakes = the low-ELO deviation roll that makes play look human instead of engine-perfect.
    autoplay: false, autoplayElo: 3200, mateMode: 'shortest', huntRisk: 'very', mistakes: true,
    // ponder = search the predicted reply on the opponent's time (Maximum Strength + native host that allows it).
    // Off by default: whether pondering is permitted is a rule of the match, not something the tutor can see.
    ponder: false,
    // ---------- Troll mode ----------
    // A joke layer on top of the engine. Nothing below changes what the engine is ASKED; directives and rage
    // tactics only choose which legal move to play afterwards. Off by default, and the whole section is hidden
    // until the master switch is turned on. Taunts render inside this panel only - nothing is ever sent to the
    // page, to chat, or to another player.
    troll: false,
    trollDirective: 'off',        // 'off' | 'chaos' | a directive id
    trollSincerity: 'best',       // best / worst / random, within whatever the rule allows
    trollChaosMode: false,
    trollChaosEvery: 5,
    trollRage: false,
    trollRageTactic: 'auto',
    trollRageEval: 250,           // centipawns, our point of view
    trollRageClock: 0,            // required clock lead in seconds (0 = at least as much time as they have)
    trollPreview: true,           // directives/rage also drive the arrows and "What would X play?"
    // pranks
    trollSound: true, trollVoice: false, trollGaslight: true, trollRunaway: true, trollLoading: true,
    trollConfidence: true, trollMirror: true, trollSwap: true, trollJudge: true, trollTelem: true,
    // commentary
    trollCommentary: 'off', trollSarcastic: true, trollShame: true
  };
  const S = Object.assign({}, DEFAULTS);
  const DEPTH_INF = 40;            // slider maximum = no strength cap: play the deepest line
  const NS = 'http://www.w3.org/2000/svg';
  const EAGER_SAFETY_MS = 2500;    // prevents an unlimited, instant search from running forever
  const POLL_MS = 600, AUTOPLAY_TICK_MS = 100;   // MutationObserver handles the immediate path; this is a fallback
  // The engine frame downloads ~95-113 MB (the full-net Stockfish the tutor runs). It hands the bytes over and
  // they are kept here, in the page's Cache Storage, so the next page load starts the engine from disk. The key
  // is the file's sha256, which is what the frame verifies before running it - so the cache cannot be poisoned
  // even though anything on this origin could write to it.
  const ENGINE_CACHE = 'chess-tutor-engine-v1';
  /* The frame runs in a sandbox with no origin of its own, so all it can hand over is the file NAME - and this
     page is what turns that into the cache key. A relative key would be resolved against whatever page the tutor
     happens to run on: chess.com/game/live/12345, /analysis, /play/computer and /home are four different keys
     for the same 99 MB file, so every redirect between them used to look like a cache miss, download the engine
     again and leave another 99 MB copy behind. Keys are absolute, anchored on this page's origin only, so the
     same file is one entry no matter which page the game ended on. */
  const engineCacheKey = key => {
    try { return new URL(key, location.origin + '/').href; } catch (_) { return String(key); }
  };
  // One copy per engine file: pre-1.7 keys were relative, so a page could end up holding several copies of the
  // same build. Dropping the duplicates gives that disk space back and keeps the origin away from its storage
  // quota - which is the other way a cache entry quietly disappears.
  async function pruneEngineCache(cache, keep) {
    const name = keep.split('/').pop();
    const keys = await cache.keys();
    for (const k of keys) {
      if (k.url !== keep && k.url.split('/').pop() === name) await cache.delete(k.url);
    }
  }
  // Cache Storage is "best effort" until the page asks for persistent storage: without this, Chrome may evict
  // the entry under disk pressure, which looks exactly like the engine downloading again for no reason.
  function askPersistentStorage() {
    try {
      if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(null);
      return navigator.storage.persisted().then(has => has ? true : navigator.storage.persist());
    } catch (_) { return Promise.resolve(null); }
  }

  let lastResult = null;           // { fen, lines, turn }
  let lastEloMove = null;
  let lastKeySeen = '', lastFlip = null;
  let engine = null, starting = false;
  let el = {};
  let revealTimer = null, hideTimer = null, drag = null, panelHover = false, panelFocus = false;
  let analysisSeq = 0, polling = false, mismatch = 0, pollTimer = null;
  let boardObserver = null, observedBoard = null, autoPollQueued = false, autoPollScheduled = false;
  // ---- game context (game.js does the rules; this is the state the page has seen) ----
  let hist = null;                 // move history rebuilt from the board: see G.advanceHistory
  let listTried = '';              // last board move-list signature that was replayed (do not redo it every poll)
  let clockSamples = [];           // recent clock readings (to see which clock ticks if the page does not say)
  const latencies = [];            // measured bestmove -> board-accepted move latencies (ms), last 12
  let incObs = [];                 // observed increments this game: { estMs, tolMs }
  let incProbe = null;             // own clock just before our move, to measure the increment afterwards
  let ponderPlan = null;           // { base, move } - after our move, ponder `move` once `base` is on the board
  let clockNote = '', ponderNote = '';

  // ---------- Move choice + formatting (the rules themselves live in lib.js so the tests can drive them) ----------
  const fmtSecs = v => v <= 0 ? 'instant' : (Math.round(v * 100) / 100) + 's';

  // ---------- Settings ----------
  const clamp = (v, a, b, d) => (typeof v === 'number' && isFinite(v)) ? Math.max(a, Math.min(b, v)) : d;
  function sanitize() {
    S.elo = PRESETS[S.elo] !== undefined ? S.elo : 1200;
    S.autoplayElo = PRESETS[S.autoplayElo] !== undefined ? S.autoplayElo : 3200;
    S.depth = Math.round(clamp(S.depth, 1, DEPTH_INF, 24));
    S.time = Math.round(clamp(S.time, 0, 60, 5) * 10) / 10;   // think time; 0 = first complete engine result
    S.hash = [16, 32, 64, 128, 256].includes(S.hash) ? S.hash : 128;
    S.opacity = clamp(S.opacity, 35, 100, 100);
    S.autoplay = !!S.autoplay;
    S.mateMode = ['normal', 'shortest', 'hunter', 'maximum'].includes(S.mateMode) ? S.mateMode : 'shortest';
    S.huntRisk = ['sound', 'balanced', 'very'].includes(S.huntRisk) ? S.huntRisk : 'very';
    S.mistakes = S.mistakes !== false;                               // mistakes stay on unless explicitly turned off
    S.ponder = S.ponder === true;                                    // pondering is strictly opt-in
    if (!['me', 'turn', 'w', 'b'].includes(S.side)) S.side = 'me';
    // "speed" belonged to the old paced auto-play UI. Delete it on load so every upgraded installation now has
    // the same no-added-delay behavior, rather than silently retaining a stored wait.
    delete S.speed;
    delete S.dock; delete S.tucked; delete S.autoTuck;   // 1.1 tuck state: replaced by free dragging
    if (T) sanitizeTroll();
  }
  // Troll settings are clamped the same way as everything else, so a corrupted stored value can never leave a
  // half-configured joke running. An unknown directive id falls back to 'off' rather than to a random rule.
  function sanitizeTroll() {
    S.troll = S.troll === true;
    S.trollDirective = (S.trollDirective === 'off' || S.trollDirective === 'chaos' ||
      (T.DIRECTIVE_BY_ID[S.trollDirective] ? true : false)) ? S.trollDirective : 'off';
    S.trollSincerity = ['best', 'worst', 'random'].includes(S.trollSincerity) ? S.trollSincerity : 'best';
    S.trollChaosMode = S.trollChaosMode === true;
    S.trollChaosEvery = Math.round(clamp(S.trollChaosEvery, 2, 20, 5));
    S.trollRage = S.trollRage === true;
    S.trollRageTactic = (S.trollRageTactic === 'auto' || T.RAGE_BY_ID[S.trollRageTactic]) ? S.trollRageTactic : 'auto';
    S.trollRageEval = Math.round(clamp(S.trollRageEval, 100, 900, 250));
    S.trollRageClock = Math.round(clamp(S.trollRageClock, 0, 60, 0));
    S.trollPreview = S.trollPreview !== false;
    S.trollCommentary = ['off', 'commentator', 'grandpa', 'armchair'].includes(S.trollCommentary) ? S.trollCommentary : 'off';
    ['trollSound', 'trollGaslight', 'trollRunaway', 'trollLoading', 'trollConfidence', 'trollMirror',
      'trollSwap', 'trollJudge', 'trollTelem', 'trollSarcastic', 'trollShame'].forEach(k => { S[k] = S[k] !== false; });
    S.trollVoice = S.trollVoice === true;    // opt-in only: it talks out loud
  }
  function loadSettings() {
    return new Promise(res => {
      try {
        chrome.storage.local.get('chessTutor', d => {
          if (d && d.chessTutor) Object.assign(S, d.chessTutor);
          sanitize(); res();
        });
      } catch (e) { sanitize(); res(); }
    });
  }
  function saveSettings() { try { chrome.storage.local.set({ chessTutor: S }); } catch (e) {} }



  // ---------- Board / DOM ----------
  function getBoard() { return document.querySelector('wc-chess-board') || document.querySelector('chess-board') || document.querySelector('.board'); }
  function isFlipped(b) { return b.classList.contains('flipped'); }
  function readPieces(b) {
    const out = {};
    b.querySelectorAll('.piece').forEach(p => {
      const c = p.className;
      const pc = /\b([wb][pnbrqk])\b/.exec(c), sq = /square-(\d)(\d)/.exec(c);
      if (pc && sq) out[sq[1] + sq[2]] = pc[1];
    });
    return out;
  }
  function domMover(b, pieces) {   // fallback only: side that did NOT make the highlighted last move
    for (const h of b.querySelectorAll('.highlight')) {
      const sq = /square-(\d)(\d)/.exec(h.className);
      if (sq && pieces[sq[1] + sq[2]]) return pieces[sq[1] + sq[2]][0] === 'w' ? 'b' : 'w';
    }
    return 'w';
  }

  // exact FEN straight from chess.com's board object (page-bridge.js runs in the page world), plus - when the
  // board exposes them - its own move list and PGN headers. Those are only hints: see updateHistory.
  let bridgeSeq = 0;
  function bridgeFen(timeout = 350) {
    return new Promise(res => {
      const id = ++bridgeSeq;
      const off = () => { clearTimeout(t); window.removeEventListener('message', h); };
      const t = setTimeout(() => { off(); res(null); }, timeout);
      const h = e => {
        if (e.source !== window || !e.data || e.data.ctRes !== 1 || e.data.id !== id) return;
        off();
        const d = e.data;
        res(d.ok && typeof d.fen === 'string' ? { fen: d.fen, history: d.history || null, headers: d.headers || null } : null);
      };
      window.addEventListener('message', h);
      window.postMessage({ ctReq: 1, id, context: true }, '*');
    });
  }

  // ask the page world to play a move through chess.com's own board object
  let moveSeq = 0;
  function bridgeMove(uci, timeout = 1500) {
    return new Promise(res => {
      const id = ++moveSeq;
      const off = () => { clearTimeout(t); window.removeEventListener('message', h); };
      const t = setTimeout(() => { off(); res({ ok: false, reason: 'the board API did not answer' }); }, timeout);
      const h = e => {
        if (e.source !== window || !e.data || e.data.ctMoveRes !== 1 || e.data.id !== id) return;
        off();
        res({ ok: !!e.data.ok, san: e.data.san || null, reason: e.data.reason || null, confirmed: !!e.data.ok });
      };
      window.addEventListener('message', h);
      window.postMessage({ ctMoveReq: 1, id, uci }, '*');
    });
  }

  async function readPosition() {
    const b = getBoard();
    if (!b) { watchBoard(null); return null; }
    if (S.autoplay) watchBoard(b);
    const pieces = readPieces(b);
    if (!Object.keys(pieces).length) return null;
    const flipped = isFlipped(b), me = flipped ? 'b' : 'w';
    const domPlacement = L.placementOf(pieces);
    let fen = null, src = 'dom';
    const bf = await bridgeFen();
    if (bf) {
      if (bf.fen.split(' ')[0] === domPlacement) { fen = bf.fen; src = 'board'; mismatch = 0; }
      else if (++mismatch < 4) return { settling: true };     // board is mid-animation / mid-drag: wait a tick
    }
    if (!fen) fen = L.buildFen(pieces, domMover(b, pieces));
    const mover = fen.split(' ')[1] === 'b' ? 'b' : 'w';
    const history = updateHistory(fen, src, src === 'board' ? bf : null);
    // Never rewrite the FEN turn. Analysing an invented side to move can produce a move that chess.com's board
    // must reject; the selected side controls when we act, while the actual board turn controls legality.
    // `cmd` is what the engine is sent: the start position plus every move, whenever the game could be followed.
    return { board: b, turn: mover, mover, me, flipped, src, fen, history,
      cmd: G.positionCommand(history) || 'position fen ' + fen, headers: (src === 'board' && bf && bf.headers) || null };
  }

  /* Follow the game move by move. Each stable board reading must be one or two LEGAL moves on from the last one
     (or a step back to an earlier position, or a new game); the engine then gets `position startpos moves ...`
     and sees repetitions. When the history is not complete (the tutor joined mid-game), a move list exposed by
     the board itself is replayed and used only if it lands exactly on the current position. */
  function updateHistory(fen, src, bf) {
    const step = G.advanceHistory(hist, fen, src);
    let h = step.h;
    if (!h) return hist;
    if (src === 'board' && bf && bf.history && Array.isArray(bf.history.moves) && !h.complete) {
      const hd = bf.headers || {};
      const start = hd.FEN && hd.SetUp !== '0' ? hd.FEN : null;
      const sig = fen + '|' + (start || '') + '|' + bf.history.moves.map(m => typeof m === 'string' ? m : (m.san || (m.from || '') + (m.to || ''))).join(' ');
      if (sig !== listTried) {
        listTried = sig;
        const listed = G.historyFromMoves(start, bf.history.moves, fen);
        if (listed && (listed.complete || listed.plies > h.plies)) { listed.resets = h.resets; h = listed; }
      }
    }
    if (step.change === 'reset' || step.change === 'back') newGameContext(step.change);
    hist = h;
    return h;
  }
  // A new game (or a takeback) invalidates what was learned about this game's clocks and any ponder plan.
  function newGameContext(why) {
    if (why === 'reset') { incObs = []; clockSamples = []; }
    incProbe = null; ponderPlan = null;
    if (engine && engine.isPondering && engine.isPondering()) { engine.cancelPonder(); ponderNote = 'stopped (' + (why === 'reset' ? 'new game' : 'takeback') + ')'; }
  }

  // ---------- Clock adapter ----------
  /* One reading of both clocks. Every part must be unambiguous: exactly one white and one black clock on the
     page, one readable time in each. Anything else is an error string, which makes the search fall back to
     Think time and say why. Whose clock runs comes from the page's own marker class (or, failing that, from
     which clock was seen ticking - G.activeClock). */
  const ACTIVE_CLOCK = ['clock-player-turn', 'clock-running', 'clock-active'];
  function readClocks() {
    const now = Date.now(), out = { ts: now, plies: hist ? hist.plies : -1, key: hist ? hist.fens[hist.fens.length - 1] : '' };
    for (const c of ['white', 'black']) {
      const boxes = [...document.querySelectorAll('.clock-' + c)].filter(n => !n.closest('#ct-root') && !n.parentElement.closest('.clock-' + c));
      if (boxes.length !== 1) return { ts: now, error: boxes.length ? 'more than one ' + c + ' clock on the page' : 'no ' + c + ' clock found' };
      const box = boxes[0];
      const texts = [...new Set([...box.querySelectorAll('.clock-time-monospace, .clock-time, [role="timer"]')]
        .map(n => n.textContent.trim()).filter(Boolean))];
      if (texts.length !== 1) return { ts: now, error: texts.length ? c + ' clock is ambiguous' : c + ' clock shows no time' };
      const ms = G.clockMs(texts[0]);
      if (ms === null) return { ts: now, error: c + ' clock unreadable ("' + texts[0].slice(0, 12) + '")' };
      out[c] = ms; out[c + 'Res'] = G.clockResolution(texts[0]);
      out[c + 'Active'] = ACTIVE_CLOCK.some(k => box.classList.contains(k));
    }
    return out;
  }
  // a reading, plus the most recent earlier one of the SAME position at least ~1s older (to see a clock tick)
  function sampleClocks() {
    const cur = readClocks();
    if (cur.error) return { cur, prev: null };
    clockSamples = clockSamples.filter(x => x.key === cur.key && cur.ts - x.ts < 5000);
    const prev = clockSamples.filter(x => cur.ts - x.ts >= 1100).pop() || null;
    clockSamples.push(cur);
    return { cur, prev };
  }
  // Time-control labels on the page (minutes, "3 | 2"). Several that disagree are all reported, not picked from.
  function timeControlLabels() {
    const seen = new Set(), out = [];
    document.querySelectorAll('[data-cy*="time-control"], [class*="time-control"]').forEach(n => {
      if (n.closest('#ct-root')) return;
      const t = (n.textContent || '').trim();
      if (!t || t.length > 20) return;
      const tc = G.parseTimeControlLabel(t);
      if (tc && !seen.has(tc.incMs)) { seen.add(tc.incMs); out.push({ source: 'time-control label', incMs: tc.incMs }); }
    });
    return out;
  }
  function incrementState(pos) {
    const declared = [];
    const pgn = pos && pos.headers && pos.headers.TimeControl ? G.parsePgnTimeControl(pos.headers.TimeControl) : null;
    if (pgn) declared.push({ source: 'game TimeControl', incMs: pgn.incMs });
    return G.resolveIncrement(declared.concat(timeControlLabels()), incObs);
  }
  /* After our move the own clock stops: its value then, minus its value just before the move, plus the time the
     move took, is the increment that was really added. Display resolution and timing jitter are the tolerance.
     The first move of each side is skipped (sites often do not run the clock or add increment there). */
  function observeIncrement(pos) {
    const probe = incProbe;
    if (!probe || pos.cmd !== probe.cmdAfter) return;
    incProbe = null;
    if (probe.plies < 2) return;
    setTimeout(() => {
      if (!hist || G.positionCommand(hist) !== probe.cmdAfter) return;     // the opponent already replied
      const c = readClocks();
      if (c.error) return;
      const name = probe.side === 'w' ? 'white' : 'black';
      const est = c[name] - (probe.before - (probe.at - probe.ts));
      incObs.push({ estMs: Math.round(est), tolMs: probe.res + c[name + 'Res'] + 300 });
      if (incObs.length > 8) incObs.shift();
    }, 300);
  }
  const keyOf = p => p.fen.split(' ').slice(0, 4).join(' ') + '|' + p.mover + S.side;
  const otherSide = side => side === 'w' ? 'b' : 'w';

  // ---------- Search limits ----------
  const maximumOn = () => S.mateMode === 'maximum';
  const eloKey = () => PRESETS[S.elo] !== undefined ? S.elo : 1200;
  const autoplayEloKey = () => PRESETS[S.autoplayElo] !== undefined ? S.autoplayElo : 3200;
  // The ELO level is the strength target, Think time is the clock. They are separate on purpose: the engine is
  // allowed to keep searching for the whole think time even at 400 ELO, and the move it answers/plays is then
  // taken from that level's depth. Auto-play dispatches as soon as that search returns - no extra pacing timer.
  /* Maximum Strength: the clock adapter decides. Both clocks, whose clock runs, the increment and the measured
     latency reserve must all be known (G.clockLimits); otherwise Think time is used and the reason is shown.
     opts.ponder builds the `go ponder` search for the position AFTER the predicted reply: our side is then the
     side to move, while the opponent's clock is the one running right now. */
  function limits(pos, opts) {
    if (maximumOn()) {
      const ponder = !!(opts && opts.ponder);
      if (!S.autoplay || !pos) {
        const lim = G.clockLimits({ time: S.time });
        lim.clockOk = false;
        lim.clockNote = 'Think time ' + (lim.timeMs / 1000) + 's (clocks are only used during auto-play)';
        return lim;
      }
      const { cur, prev } = sampleClocks();
      return G.clockLimits({ time: S.time, clocks: cur, prev, mover: ponder ? otherSide(pos.mover) : pos.mover,
        expectActive: pos.mover, increment: incrementState(pos), latencies, now: Date.now(), ponder });
    }
    const depth = S.autoplay
      ? PRESETS[autoplayEloKey()]
      : (S.custom ? (S.depth >= DEPTH_INF ? 0 : S.depth) : PRESETS[eloKey()]);
    return L.searchLimits({ depth, time: S.time, safetyMs: EAGER_SAFETY_MS });
  }
  const levelLabel = () => S.custom ? 'Custom' : S.elo >= 3200 ? 'Max' : S.elo >= 2000 ? S.elo + '+' : String(S.elo);
  const autoplayLevelLabel = () => autoplayEloKey() >= 3200 ? 'Full engine' : autoplayEloKey() >= 2000 ? autoplayEloKey() + '+' : String(autoplayEloKey());

  // ---------- Engine ----------
  class Engine {
    constructor() {
      this.frame = null; this.ready = false; this.busy = false; this.queued = null; this.cur = null;
      this.byDepth = {}; this.opts = {}; this.meta = null; this.waiters = []; this.collect = null;
      this.mpv = 0; this.hash = 0; this.threads = 1; this.nnue = null; this.selfTest = null;
      this.lastStage = null; this._idle = () => {}; this._done = () => {};
      this.optVals = {}; this.wantOpts = {};   // UCI options changed between searches (never during one)
    }
    async init() {
      const frame = document.createElement('iframe');
      frame.src = chrome.runtime.getURL('engine-host.html');
      frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none;left:0;top:0;';
      this.frame = frame;
      const loaded = new Promise((res, rej) => { this._loaded = res; this._fail = rej; });
      loaded.catch(() => {});
      window.addEventListener('message', e => {
        if (e.source !== frame.contentWindow || !e.data || !e.data.ct) return;
        const d = e.data;
        if (d.error) { setStatus('Engine error: ' + d.error); if (d.fatal) this._fail(new Error(d.error)); }
        if (d.cacheSaved) { this.cachePersisted = true; this.cacheError = null; showEngine(); }
        if (d.cacheSaveError) { this.cacheError = d.cacheSaveError; showEngine(); }
        if (d.note) console.info('[Chess Tutor] ' + d.note);
        if (d.stage) { this.lastStage = d.stage; this.onStage(d.stage); this._idle(); }
        if (d.ctCacheGet) this.cacheGet(d);
        if (d.ctCachePut) this.cachePut(d);
        if (d.engineName) { this.meta = d; this._loaded(); this._done(); }
        if (d.line !== undefined) this.onLine(d.line);
      });
      const frameReady = new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('engine frame blocked by the page')), 8000);
        const h = e => {
          if (e.source === frame.contentWindow && e.data && e.data.ready) { clearTimeout(t); window.removeEventListener('message', h); res(); }
        };
        window.addEventListener('message', h);
      });
      document.documentElement.appendChild(frame);
      await frameReady;
      // The frame reports every mirror it tries and how far the download is, so waiting is measured against
      // that: the load fails only when nothing has moved for a minute (a mirror that went quiet), not on a
      // fixed clock that a 95 MB download would blow through.
      await Promise.race([loaded, new Promise((_, rej) => {
        this._idle = (ms = 90000) => {
          clearTimeout(this._idleTimer);
          this._idleTimer = setTimeout(() => rej(new Error('the engine download stalled (nothing moved for ' + Math.round(ms / 1000) + 's)')), ms);
        };
        this._done = () => { clearTimeout(this._idleTimer); this._idle = () => {}; this._done = () => {}; };
        this._idle();
      })]);

      // ---- verification + "max strength" setup ----
      (this.meta.options || []).forEach(l => { const o = L.parseOption(l); if (o) this.opts[o.name] = o; });
      const setOpt = (name, v) => { if (this.opts[name]) this.send('setoption name ' + name + ' value ' + v); };
      this.setHash(S.hash);
      if (this.opts.Threads && this.opts.Threads.max > 1) {
        this.threads = Math.max(1, Math.min(this.opts.Threads.max, (navigator.hardwareConcurrency || 2) - 1));
        setOpt('Threads', this.threads);
      }
      setOpt('Skill Level', this.opts['Skill Level'] ? this.opts['Skill Level'].max : 20);   // never self-handicap
      setOpt('UCI_LimitStrength', 'false');
      setOpt('Move Overhead', 0);                                                           // don't waste the time cap
      setOpt('Use NNUE', 'true');
      await this.sync();
      // NNUE check: the engine's own "eval" dump mentions NNUE when the net is loaded
      this.collect = [];
      this.send('position startpos'); this.send('eval'); await this.sync();
      this.nnue = /nnue/i.test(this.collect.join('\n')); this.collect = null;
      // self-test search: must return a sane move; also gives a speed reading
      const t0 = Date.now();
      const r = await this.analyze('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { depth: 10, timeMs: 8000 }, 1);
      this.selfTest = r && r.lines.length && /^[a-h][1-8][a-h][1-8]/.test(r.lines[0].move)
        ? { ok: true, nps: r.stats.nps, ms: Date.now() - t0 } : { ok: false };
      this.ready = true;
    }
    // The frame downloads the engine and reports every mirror it tries; the status line follows along, so a
    // 95 MB first download is visibly a download and not a hang.
    onStage(st) {
      const mb = n => (n / 1048576).toFixed(n >= 10485760 ? 0 : 1);
      const rate = st.rate ? ' \u00B7 ' + mb(st.rate) + '/s' : '';
      const line = st.phase === 'cache' ? 'Starting from the cached copy (' + mb(st.loaded) + ')'
        : st.phase === 'archive' ? st.name + ' from the npm archive: ' + st.pct + '% of ' + mb(st.total) + rate
          : st.phase === 'check' ? 'Verifying ' + st.name + ' (sha256)...'
            : st.phase === 'start' ? 'Starting ' + st.name + (st.bytes ? ' (' + mb(st.bytes) + ' wasm)' : '') + '...'
              : 'Downloading ' + st.name + (st.full ? ', full net' : '') + (st.total ? ': ' + st.pct + '% of ' + mb(st.total) + rate : '...');
      setStatus(line);
      if (el.verify) { el.verify.className = 'warn'; el.verify.textContent = line; }
    }
    // Cache Storage of the page the tutor runs on: the frame asks for the wasm it is about to download and
    // hands back what it downloaded. Both directions are best effort - no Cache Storage just means a download.
    // The frame only knows the file name, so every key goes through engineCacheKey first (origin absolute).
    cacheGet(req) {
      const key = engineCacheKey(req.ctCacheGet);
      const post = (msg, transfer) => {
        try { this.frame.contentWindow.postMessage(msg, '*', transfer || []); } catch (_) {}
      };
      const answer = bytes => post({ ctCacheRes: req.id, bytes: bytes }, bytes ? [bytes] : []);
      (async () => {
        try {
          const cache = window.caches && await window.caches.open(ENGINE_CACHE);
          const hit = cache && await cache.match(key);
          if (!hit) return answer(null);
          // Two steps on purpose: reading 99 MB off the disk and transferring it can take longer than the
          // frame's plain lookup window, so the file is announced before the bytes are on their way
          // (`ctCacheFound` is what makes the frame extend its wait - engine-frame.js io.cacheGet).
          post({ ctCacheFound: req.id });
          const bytes = await hit.arrayBuffer();
          answer(bytes);
          pruneEngineCache(cache, key).catch(() => {});       // older path-keyed duplicates of this same file
        } catch (_) { answer(null); }
      })();
    }
    cachePut(req) {
      const key = engineCacheKey(req.ctCachePut);       // a put carries the file name in ctCachePut
      (async () => {
        try {
          if (!req.bytes) return;
          const cache = window.caches && await window.caches.open(ENGINE_CACHE);
          if (!cache) throw new Error('Cache Storage is not available in this browser');
          await cache.put(key, new Response(req.bytes, { headers: { 'content-type': 'application/wasm' } }));
          this.cacheError = null;
          await pruneEngineCache(cache, key);
        } catch (err) {
          this.cacheError = (err && err.message) || String(err);
          console.info('[Chess Tutor] engine not cached (' + this.cacheError + ') - the next page load downloads again');
        }
        showEngine();
      })();
    }
    setHash(mb) {
      const o = this.opts.Hash;
      this.hash = o && o.max ? Math.min(mb, o.max) : mb;
      this.send('setoption name Hash value ' + this.hash);
    }
    sync() { this.send('isready'); return this.waitLine(l => l === 'readyok', 8000); }
    waitLine(test, ms) {
      return new Promise(res => {
        const w = { test, res, t: setTimeout(() => { this.waiters = this.waiters.filter(x => x !== w); res(null); }, ms) };
        this.waiters.push(w);
      });
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.waiters.splice(0).forEach(w => { clearTimeout(w.t); w.res(null); });
      this.ready = false;
      if (this.cur) { this.cur.superseded = true; this.settle(this.cur); }
      if (this.queued) this.queued.resolve(null);
      this.cur = this.queued = null;
      if (this.port) this.port.disconnect();
      if (this.frame) { this.send('stop'); this.frame.remove(); }
    }
    send(c) {
      this.frame.contentWindow.postMessage({ ctCmd: c }, '*');
    }
    onLine(l) {
      if (this.collect) this.collect.push(l);
      this.waiters = this.waiters.filter(w => { if (w.test(l)) { clearTimeout(w.t); w.res(l); return false; } return true; });
      const info = L.parseInfo(l);
      if (info) {
        (this.byDepth[info.depth] = this.byDepth[info.depth] || {})[info.multipv] = info;
        this.eagerCheck();
        return;
      }
      if (!l.startsWith('bestmove')) return;
      const cur = this.cur, parts = l.split(/\s+/);
      if (cur) { cur.bestmove = parts[1]; cur.ponderMove = parts[2] === 'ponder' ? parts[3] : null; }
      this.cur = null; this.busy = false;
      this.settle(cur);
      if (this.queued) { const q = this.queued; this.queued = null; this.run(q); }
    }
    // Hand the caller the lines for one settled depth (the level's depth when a strength cap is set, otherwise
    // the deepest one holding every line, so arrows never mix depths) plus the freshest stats for line 1.
    // Never resolves the same job twice.
    settle(cur, eager) {
      if (!cur || cur.settled) return;
      cur.settled = true;
      if (cur.superseded) { cur.resolve(null); return; }
      const ds = Object.keys(this.byDepth).map(Number);
      const best = L.reportDepth(this.byDepth, cur.lim && cur.lim.playDepth);
      const m = (best === null ? null : this.byDepth[best]) || {};
      const lines = Object.keys(m).map(Number).sort((x, y) => x - y).map(k => m[k]);
      const deepest = ds.length ? this.byDepth[Math.max(...ds)] : {};
      // the deepest iteration the think time reached, as candidate lines too. The hunter uses these for pressure
      // picks that a low ELO's own depth never saw.
      if (cur.lim && cur.lim.maximum && cur.bestmove) {
        // UCI bestmove is authoritative, not a previous iteration's tempting mate.
        const candidates = ds.sort((a, b) => b - a).flatMap(d => Object.values(this.byDepth[d]));
        const finalLine = candidates.find(l => l.move === cur.bestmove);
        lines.splice(0, lines.length, ...(finalLine ? [finalLine] : []));
      }
      const deepLines = Object.keys(deepest).map(Number).sort((x, y) => x - y).map(k => deepest[k]);
      // Keep every positive mate proof reported during this search, not just the selected ELO depth or the final
      // (possibly half-filled) MultiPV depth. Shortest-mate styles can then take advantage of the whole think-time
      // search without making all ordinary low-ELO moves come from the deepest iteration.
      const mateLines = [];
      ds.forEach(d => Object.keys(this.byDepth[d]).forEach(k => {
        const line = this.byDepth[d][k];
        if (line && line.type === 'mate' && line.score > 0) mateLines.push(line);
      }));
      const top = ds.length ? this.byDepth[Math.max(...ds)][1] || lines[0] : null;   // latest stats for line 1
      const finalPv = (lines[0] && lines[0].pv) || (top && top.pv) || [];
      cur.resolve({ lines, deepLines, mateLines, eager: !!eager,
        bestmove: cur.bestmove || null, ponder: cur.ponderMove || null, pv: finalPv, doneAt: Date.now(),
        pondered: cur.hitAt ? { ms: cur.hitAt - cur.startedAt } : null,
        // how deep the engine actually got inside the think time: the panel shows it, so a low level that thinks
        // long is visibly "searching harder than it plays" rather than looking stuck
        searchDepth: ds.length ? Math.max(...ds) : null,
        stats: top ? { depth: top.depth, nodes: top.nodes, nps: top.nps, time: top.time } : {} });
    }
    // "Instant" mode: an answer that already has every requested line needs no further searching. Also fire
    // when the engine has moved past a depth that holds fewer lines than we asked for (a forced position has
    // fewer moves than MultiPV), because that depth is then as complete as it will ever be.
    eagerCheck() {
      const cur = this.cur;
      if (!cur || !cur.eager || cur.settled) return;
      const d = L.instantDepth(this.byDepth, cur.mpv);
      if (d === null) return;
      this.byDepth = { [d]: this.byDepth[d] };   // report exactly that depth, so the answer cannot mix iterations
      this.settle(cur, true);
      this.send('stop');
    }
    // `position` is either a full UCI position command (history-aware: `position startpos moves ...`) or a FEN.
    analyze(position, lim, mpv) {
      return new Promise(resolve => {
        const job = { pos: String(position).startsWith('position ') ? position : 'position fen ' + position,
          lim, mpv: mpv || 1, resolve, superseded: false, settled: false, eager: !!(lim && lim.eager) };
        if (this.busy) {
          if (this.queued) this.queued.resolve(null);
          this.queued = job;
          // one `stop` per search: a cancelled ponder search has already been told to stop
          if (this.cur && !this.cur.superseded) { this.cur.superseded = true; this.send('stop'); }
          else if (!this.cur) this.send('stop');
        } else this.run(job);
      });
    }
    run(job) {
      this.busy = true; this.cur = job; this.byDepth = {}; job.startedAt = Date.now();
      if (this.mpv !== job.mpv) { this.send('setoption name MultiPV value ' + job.mpv); this.mpv = job.mpv; }
      for (const name of Object.keys(this.wantOpts)) {
        if (this.optVals[name] !== this.wantOpts[name]) { this.send('setoption name ' + name + ' value ' + this.wantOpts[name]); this.optVals[name] = this.wantOpts[name]; }
      }
      this.send(job.pos);
      this.send(G.goCommand(job.lim));
    }
    // applied right before the next search starts, because UCI options must not change during one
    wantOption(name, value) { if (this.opts[name]) this.wantOpts[name] = String(value); }

    /* ---- pondering ----
       ponder(): from idle, search the position after the predicted reply with `go ponder`. Nobody waits on it.
       ponderhit(): the predicted reply was played - the same search continues as a normal one (its elapsed time
                    already includes the pondering, so it never overspends the clock) and this resolves with it.
       cancelPonder(): any other reply, a takeback, a new game, auto-play off - `stop`, and the bestmove that
                    comes back is discarded (it belongs to a position that did not happen). */
    ponder(position, lim, base) {
      if (this.busy || !this.ready) return false;
      this.run({ pos: position, base, lim: Object.assign({}, lim, { ponder: true }), mpv: 1, resolve: () => {},
        superseded: false, settled: false, eager: false, ponder: true });
      return true;
    }
    isPondering(position) {
      const c = this.cur;
      return !!(c && c.ponder && !c.superseded && !c.settled && (position === undefined || c.pos === position));
    }
    get ponderBase() { return this.isPondering() ? this.cur.base : null; }
    ponderhit() {
      const cur = this.cur;
      if (!this.isPondering()) return Promise.resolve(null);
      return new Promise(resolve => {
        cur.resolve = resolve; cur.ponder = false; cur.hitAt = Date.now();
        cur.lim = Object.assign({}, cur.lim, { ponder: false });
        this.send('ponderhit');
      });
    }
    cancelPonder() {
      if (!this.isPondering()) return false;
      this.cur.superseded = true;
      this.send('stop');
      return true;
    }
  }

  class NativeEngine extends Engine {
    async init() {
      this.port = chrome.runtime.connect({ name: 'ct-native' });
      this.meta = { engineKind: 'Native UCI', engineName: 'Stockfish', options: [] };
      const fail = error => {
        if (this.disposed) return;
        this.failure = error; this.dispose();
        if (engine === this) {
          engine = null; lastResult = null; lastEloMove = null; analysisSeq++; render();
          el.verify.className = 'warn'; el.verify.textContent = 'Native backend disconnected';
          setStatus('Native engine disconnected: ' + error + '. Press Analyze to retry.');
        }
      };
      this.port.onDisconnect.addListener(() => fail('Native Messaging connection closed'));
      this.port.onMessage.addListener(d => {
        if (d.error) { fail(d.error); return; }
        if (d.line) {
          if (d.line.startsWith('id name ')) this.meta.idName = d.line.slice(8);
          if (d.line.startsWith('option ')) { const o = L.parseOption(d.line); if (o) this.opts[o.name] = o; }
          if (d.line.startsWith('info string CT ')) this.nativeDetail = d.line.slice(15);
          if (d.line.startsWith('info string CT-CAPS ')) this.hostPonder = /\bponder=1\b/.test(d.line);
          this.onLine(d.line);
        }
      });
      const hello = this.waitLine(l => l === 'uciok', 5000);
      this.send('uci');
      if (!await hello || this.failure) throw new Error(this.failure || 'native host did not answer');
      if (!/stockfish/i.test(this.meta.idName || '')) throw new Error('native host must run Stockfish');
      // The host owns hardware/tablebase configuration; do not override it with browser settings.
      this.send('setoption name UCI_LimitStrength value false');
      this.send('setoption name Skill Level value 20');
      this.send('setoption name Move Overhead value 150');
      const ready = this.waitLine(l => l === 'readyok', 5000);
      this.send('isready');
      if (!await ready || this.failure) throw new Error(this.failure || 'native engine not ready');
      this.ready = true;
    }
    send(c) { if (this.port) this.port.postMessage({ command: c }); }
    setHash() {} // Native settings live in native/config.json.
  }

  // ---------- SVG overlay ----------
  function svgEl(tag, attrs, cls) {
    const n = document.createElementNS(NS, tag);
    if (cls) n.setAttribute('class', cls);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function getOverlay(board) {
    let svg = board.querySelector(':scope > svg.ct-overlay');
    if (!svg) {
      svg = svgEl('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none' }, 'ct-overlay');
      if (getComputedStyle(board).position === 'static') board.style.position = 'relative';
      board.appendChild(svg);
    }
    return svg;
  }
  function addRect(svg, sq, flipped, cls, opacity) {
    const c = L.sqCenter(sq, flipped);
    svg.appendChild(svgEl('rect', { x: c.col * 12.5, y: c.row * 12.5, width: 12.5, height: 12.5, 'fill-opacity': opacity }, cls));
  }
  function addArrow(svg, uci, flipped, idx, opacity, badge) {
    const s = L.arrowShape(uci, flipped);
    const g = svgEl('g', { opacity }, 'ct-a' + idx);
    g.appendChild(svgEl('polyline', { points: s.pts.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '), 'stroke-width': 2.2 }, 'ct-shaft'));
    g.appendChild(svgEl('polygon', { points: s.head.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ') }, 'ct-head'));
    if (badge) {
      const bx = Math.max(3.2, Math.min(96.8, s.to.x + 4.6)), by = Math.max(3.2, Math.min(96.8, s.to.y - 4.6));
      g.appendChild(svgEl('circle', { cx: bx, cy: by, r: 2.9 }, 'ct-badge'));
      g.appendChild(svgEl('circle', { cx: bx, cy: by, r: 2.9 }, 'ct-badge-ring'));
      const t = svgEl('text', { x: bx, y: by + 0.15 }, 'ct-badge-txt'); t.textContent = badge; g.appendChild(t);
    }
    svg.appendChild(g);
  }
  function render() {
    const board = getBoard();
    if (!board) return;
    const svg = getOverlay(board);
    svg.innerHTML = '';
    if (!lastResult) return;
    const flipped = isFlipped(board), lines = lastResult.lines;
    const ops = [0.88, 0.62, 0.52];
    const n = S.showTop3 ? Math.min(3, lines.length) : (S.showBest && lines[0] ? 1 : 0);
    for (let i = n - 1; i >= 0; i--) {                       // draw the best arrow last = on top
      if (i === 0 && !S.showBest) continue;
      addArrow(svg, lines[i].move, flipped, i, ops[i], String(i + 1));
    }
    if (S.showBest && lines[0]) {
      addRect(svg, lines[0].move.slice(0, 2), flipped, 'ct-sq0', 0.22);
      addRect(svg, lines[0].move.slice(2, 4), flipped, 'ct-sq0b', 0.38);
    }
    if (lastEloMove) {
      addArrow(svg, lastEloMove, flipped, 3, 0.9, '');
      addRect(svg, lastEloMove.slice(0, 2), flipped, 'ct-sq3', 0.22);
      addRect(svg, lastEloMove.slice(2, 4), flipped, 'ct-sq3b', 0.38);
    }
  }
  function clearOverlay() { const b = getBoard(); if (b) { const s = b.querySelector(':scope > svg.ct-overlay'); if (s) s.innerHTML = ''; } }

  // ---------- UI helpers ----------
  const setStatus = t => { if (el.status) el.status.textContent = t; };
  function showEngine() {
    if (engine instanceof NativeEngine && engine.ready) {
      el.engine.textContent = engine.meta.idName;
      el.verify.className = 'ok';
      el.verify.textContent = 'Native backend connected (identity reported by engine, binary not verified)';
      el.engdetail.textContent = engine.nativeDetail || 'Native Stockfish · hardware and Syzygy configured in native/config.json';
      return;
    }
    if (!el.engine || !engine || !engine.meta) return;
    const m = engine.meta, id = m.idName || 'unknown engine';
    const name = m.engineName || 'engine';
    el.engine.textContent = id;
    // The panel only claims what the engine itself reported. The frame names the build it downloaded and says
    // whether the engine confirmed it (`id name`), so a lite fallback is shown as one instead of as "Stockfish".
    if (m.verified) {
      el.verify.className = 'ok';
      el.verify.textContent = '\u2713 ' + name + ' confirmed (engine reported it)' + (m.engineFull === false ? ' - lite net' : '');
    } else if (/stockfish/i.test(id)) {
      el.verify.className = 'warn';
      el.verify.textContent = '\u26A0 Not the expected build - running ' + id;
    } else {
      el.verify.className = 'warn';
      el.verify.textContent = '\u26A0 Unverified engine: "' + id + '"';
    }
    const bits = [m.engineKind,
      'NNUE ' + (engine.nnue ? '\u2713' : '?'),
      'Hash ' + engine.hash + ' MB',
      'Threads ' + engine.threads + (engine.threads === 1 ? ' (single-thread build)' : '')];
    // Where the 99 MB came from matters to the user: "(from cache)" means the next visit is instant, and a
    // failed or evictable cache is named here instead of being a mystery download every time.
    if (m.bytes) bits.push((m.bytes / 1048576).toFixed(0) + ' MB engine' + (m.cached ? ' (from cache)' : ' (downloaded)'));
    if (m.host) bits.push('via ' + m.host);
    if (engine.cachePersisted === true) bits.push('cache persistent');
    if (engine.cachePersisted === false) bits.push('cache best-effort (browser may evict it)');
    if (engine.cacheError) bits.push('not cached: ' + engine.cacheError);
    if (engine.selfTest) bits.push(engine.selfTest.ok ? 'self-test OK' + (engine.selfTest.nps ? ' @ ' + Math.round(engine.selfTest.nps / 1000) + ' kn/s' : '') : 'self-test FAILED');
    if (m.hash) bits.push('sha256 ' + m.hash.slice(0, 12));
    if (engine.nativeFallback) bits.push('Native unavailable: ' + engine.nativeFallback + ' — browser fallback, no local Syzygy');
    el.engdetail.textContent = bits.filter(Boolean).join(' \u00B7 ');
  }
  /* updateTip writes the normal, useful explanation. With Judgmental tips on, the roast replaces it: the
     point of the feature is that the panel stops explaining and starts commenting. */
  function updateTip() {
    updateTipBase();
    if (!trollOn() || !T || !S.trollJudge) return;
    const cp = ourCpOf(lastResult);
    const roast = trollJudge(cp);
    if (roast) el.tip.textContent = roast;
  }
  function updateTipBase() {
    if (maximumOn()) {
      el.tip.textContent = 'Maximum Strength: uncapped search, one principal variation, no mistakes or speculative sacrifices. ' +
        'The engine gets the start position plus every move (repetition-aware). During auto-play both clocks, the running side and the increment ' +
        'go to Stockfish\'s time manager minus a measured latency reserve; any uncertainty falls back to Think time (minimum 1s) and says why. ' +
        'Forced mates only - not guaranteed instant mate. Native backend is optional; see native/README.md.';
      el.eloBtn.textContent = 'Show maximum-strength move';
      return;
    }
    const think = S.time > 0 ? 'It thinks for ' + fmtSecs(S.time) + ' per position at every level' : 'It answers instantly (first complete result)';
    const policy = (S.mateMode === 'shortest' ? 'fewest-move mate'
      : S.mateMode === 'hunter' ? 'aggressive hunter (' + huntLabel() + ')' : 'regular best move') + ', ' +
      (S.mateMode === 'hunter' ? 'no mistake roll' : S.mistakes ? 'natural mistakes on' : 'mistakes off');
    el.tip.textContent = (S.custom
      ? 'Custom search: ' + (S.depth >= DEPTH_INF ? 'no depth limit, full strength' : 'plays the depth-' + S.depth + ' lines') + '. '
      : 'At ' + levelLabel() + ' ELO: ' + TIPS[eloKey()] + ' ') + think + ' \u00B7 ' + policy + '.';
    el.eloBtn.textContent = S.custom ? 'What would 1200 play?' : 'What would ' + levelLabel() + ' play?';
  }
  function updateAutoHint() {
    if (maximumOn()) {
      el.autohint.textContent = 'Maximum Strength · ' + (S.autoplay ? 'auto-play on' : 'auto-play off') + '. Full-depth engine best move; clock-aware when the clock data is certain. ' +
        (S.ponder ? 'Pondering on: needs the native host installed with --allow-ponder; only where the match rules allow it. ' : 'Pondering off. ') +
        'Training/bot matches only.';
      el.autohint.classList.toggle('on', S.autoplay);
      return;
    }
    const who = S.side === 'me' ? 'your side' : S.side === 'turn' ? 'the side to move, both colours' : S.side === 'w' ? 'White' : 'Black';
    const at = autoplayEloKey() >= 3200 ? 'Full engine' : autoplayLevelLabel() + ' ELO';
    const timing = S.time > 0
      ? 'It thinks ' + fmtSecs(S.time) + ' for every move at any level, then plays at once - no extra delay.'
      : 'It plays the first complete result at once.';
    const mateGoal = S.mateMode === 'shortest' ? 'A proven mate found anywhere in the think-time search is taken in the fewest moves; otherwise it uses the selected level.'
      : S.mateMode === 'hunter' ? 'Hunter: the fewest-move mate whenever one is proven, otherwise the most aggressive sound move - check, bait, attack on the king. Its '
        + 'pressure candidates use the whole depth the search reached, so the level matters less while it attacks.'
      : 'Regular play: its best line at the selected level, no mate hunting.';
    const slip = S.mateMode === 'hunter'
      ? 'Hunter choices are deliberate; Natural mistakes is ignored in this style.'
      : S.mistakes
        ? 'Natural mistakes are on, so a low level sometimes deviates from its best line.'
        : 'Natural mistakes are off: there is no random deviation. A shallow level can still miss tactics, and mate style may choose a different move.';
    el.autohint.textContent = (S.autoplay ? 'On: ' + who + ' at ' + at + '. ' : 'Off - turn on to play ' + who + ' at ' + at + '. ')
      + timing + ' ' + mateGoal + ' ' + slip;
    el.autohint.classList.toggle('on', S.autoplay);
  }
  // "Move dispatch" is a readout, not a control: auto-play has no pacing timer of its own, the only wait before
  // a move goes out is the Think time the engine is given for that position.
  function syncDispatch() {
    if (el.response) el.response.textContent = maximumOn() ? 'Engine clock budget / Think time fallback' : S.time > 0 ? 'After ' + fmtSecs(S.time) + ' thinking' : 'Immediate (instant)';
  }
  function syncControls() {
    [el.level, el.depth, el.autoplayElo, el.mistakes].forEach(n => { n.disabled = maximumOn(); });
    el.level.value = S.custom ? 'custom' : String(eloKey());
    el.depthRow.style.display = S.custom ? '' : 'none';
    el.depth.value = S.depth; el.depthVal.textContent = S.depth >= DEPTH_INF ? '\u221E' : String(S.depth);
    el.time.value = S.time; el.timeVal.textContent = fmtSecs(S.time);
    el.mate.value = S.mateMode; el.mistakes.checked = S.mistakes;
    el.huntRisk.value = S.huntRisk;
    el.huntRiskRow.style.display = S.mateMode === 'hunter' ? '' : 'none';   // only the hunter has a risk dial
    syncDispatch();
    el.hash.value = String(S.hash);
    el.opacity.value = S.opacity; el.opacityVal.textContent = S.opacity + '%';
    el.panel.style.opacity = String(S.opacity / 100);
    el.autoplayElo.value = String(autoplayEloKey());
    el.autoplay.checked = S.autoplay;
    el.ponder.checked = S.ponder;
    el.ponderRow.style.display = maximumOn() ? '' : 'none';   // pondering only exists in Maximum Strength
    updateTip(); updateAutoHint(); showContext();
  }
  function setBar(line, turn) {
    el.barfill.style.width = Math.max(3, Math.min(97, L.whitePct(line, turn))) + '%';
    const sign = turn === 'w' ? 1 : -1, v = line.score * sign;
    el.eval.className = v > (line.type === 'mate' ? 0 : 15) ? 'pos' : v < (line.type === 'mate' ? 0 : -15) ? 'neg' : '';
  }

  // ---------- Analysis ----------
  async function analyze(given) {
    if (!engine) { startEngine(); return; }
    const seq = ++analysisSeq;
    const pos = given || await readPosition();
    if (seq !== analysisSeq) return;
    if (!pos) { setStatus('No board found.'); return; }
    if (pos.settling) { setStatus('Waiting for the board to settle...'); return; }
    el.fen.textContent = pos.fen;
    lastKeySeen = keyOf(pos);
    lastEloMove = null; lastResult = null; render();          // hide arrows until the answer is final
    // A ponder search is only kept while the board still shows the position it started from (opponent thinking)
    // or the exact predicted continuation (ponderhit below). Any other position cancels it.
    const hit = !!(engine.isPondering && ourTurn(pos) && engine.isPondering(pos.cmd));
    if (engine.isPondering && engine.isPondering() && !hit && engine.ponderBase !== pos.cmd) {
      engine.cancelPonder();
      ponderNote = 'predicted reply not played - ponder search stopped and discarded';
    }
    showContext();
    if (!ourTurn(pos)) {
      el.best.textContent = '-';
      setStatus(sideLabel(sideForPosition(pos)) + ' to move - waiting');
      if (maximumOn() && S.autoplay) { observeIncrement(pos); startPonder(pos); }
      return;
    }
    if (!engine.ready) { setStatus('Engine loading...'); return; }
    const t0 = Date.now();
    // Troll timing is decided BEFORE the search: the pick that asked for it only happens once it has answered.
    trollThinkKind = trollPlanThink(pos);
    // ponderhit keeps the time limits the ponder search was started with (our clock has not moved since)
    let lim = hit ? Object.assign({}, engine.cur.lim, { ponder: false }) : trollLimits(pos);
    if (maximumOn()) {
      clockNote = lim.clockNote || '';
      if (!hit) engine.wantOption('Ponder', ponderGateFor(pos, lim).ok ? 'true' : 'false');
      showContext();
    }
    const strength = maximumOn() ? 'Maximum Strength' : S.autoplay ? 'auto-play ' + autoplayLevelLabel() + ' ELO' : levelLabel() + ' ELO';
    const goal = S.mateMode === 'shortest' ? ', preferring the shortest proven mate'
      : S.mateMode === 'hunter' ? ', hunting mate / check / bait (' + huntLabel() + ')' : ', regular best move';
    setStatus(hit ? 'Ponderhit: the predicted reply was played - continuing the search started on the opponent\'s time...'
      : maximumOn() && lim.clocks ? 'Thinking on the clock (Maximum Strength, Stockfish time management)...'
        : (S.time > 0 ? 'Thinking for ' + fmtSecs(S.time) + ' (' + strength + goal + ')...' : 'Searching (' + strength + goal + ')...'));
    // The search keeps multiple PVs for mate proofs and, when enabled, realistic candidate deviations, independent
    // of whether their arrows are shown. Auto-play gets five; the hunter asks for more (plus the deepest iteration)
    // because a check or bait can sit well below the quiet top lines.
    // The engine always gets the history-aware position (start position + every move) when the game was followed.
    let r = hit ? await engine.ponderhit() : null;
    if (hit && r) ponderNote = 'ponderhit - search continued after ' + (r.pondered ? (r.pondered.ms / 1000).toFixed(1) + 's' : 'some time') + ' on the opponent\'s time';
    if (!r && seq === analysisSeq) {
      if (hit) { lim = limits(pos); clockNote = lim.clockNote || clockNote; }   // the ponder search vanished: plain search
      r = await engine.analyze(pos.cmd, lim, mpvFor());
    }
    if (!r) return;                                           // superseded by a newer request
    if (seq !== analysisSeq) return;
    const now = await readPosition();
    if (!now || now.settling || keyOf(now) !== keyOf(pos)) return;   // board changed while thinking; poll restarts
    if (!r.lines.length) { setStatus(maximumOn() ? 'No usable final engine line (game over or insufficient search output). No move played.' : 'No legal moves (game over?).'); return; }
    r.clockManaged = !!(maximumOn() && lim.clocks);
    const pool = huntPoolFor(r);                              // hunter: level depth + deepest iteration
    // In hunter mode the headline move and arrow 1 ARE the hunter's choice, so what the panel shows is what the
    // style would actually play; the engine's remaining candidates follow it. The other styles show the search.
    const mateLines = r.mateLines || [];
    const styleOpts = pickOpts(pos.fen, S.autoplay ? autoplayEloKey() : eloKey(), mateLines);
    const huntPickInfo = huntOn() ? L.chooseMove(pool, styleOpts) : null;
    const shortestPickInfo = S.mateMode === 'shortest' ? L.chooseMove(r.lines, styleOpts) : null;
    const displayPick = huntPickInfo || (shortestPickInfo && shortestPickInfo.mate ? shortestPickInfo : null);
    const displayPool = huntPickInfo ? pool : r.lines;
    // Show an intentional style choice as the headline/first arrow: the hunter's pressure pick, or a proven
    // shortest mate. Keep only same-depth alternatives so arrows do not mix evaluations from different iterations.
    // Without a deliberate choice, keep the regular search line visible (including any Natural-mistake model).
    const shownRaw = displayPick
      ? [displayPick.line].concat(displayPool.filter(l => l.move !== displayPick.uci && l.depth === displayPick.line.depth))
      : r.lines;
    // A directive or the Rage Brain owns the headline arrow when it is driving, so the board preview shows
    // the move that is about to be played rather than the move the engine would have preferred.
    const shown = trollPreviewLines(pos, pool, shownRaw);
    lastResult = { fen: pos.fen, cmd: pos.cmd, lines: shown, choiceLines: pool, turn: pos.turn, mateLines: mateLines };
    const top = shown[0];
    // A UCI score is already from the mover's point of view, and this runs only when it is our turn.
    const ourCp = top.type === 'mate' ? (top.score > 0 ? 100000 : -100000) : (top.score || 0);
    el.best.textContent = L.uciToSan(top.move, pos.fen); el.best.title = top.move;
    el.eval.textContent = trollSarcastic(L.evalText(top, pos.turn), ourCp);
    setBar(top, pos.turn);
    el.elotxt.textContent = '-';
    if (trollUI) {
      trollUI.showConfidence(ourCp);
      // The soundboard judges OUR last move here, because this is the first moment its result is visible:
      // the opponent has replied and the position has been searched again.
      if (evalBeforeOurMove != null) {
        const swing = ourCp - evalBeforeOurMove;
        evalBeforeOurMove = null;
        if (swing <= -900) trollUI.onHang();
        else if (swing <= -300) trollUI.onBlunder();
        else if (swing >= 300) trollUI.onBrilliant();
      }
      if (top.type === 'mate' && ourCp > 0) trollUI.onMate();
      else if (ourCp <= -9000) trollUI.onLoss();
    }
    const spentMs = Date.now() - t0;
    let msg = (r.pondered ? 'Ponderhit · ' : '') + 'Thought ' + (spentMs / 1000).toFixed(2) + 's · played from depth ' + top.depth +
      (lim.playDepth ? '/' + lim.playDepth : '') +
      (r.searchDepth > top.depth ? ' (searched to ' + r.searchDepth + ')' : '') + ' \u00B7 ' +
      L.fmtCount(r.stats.nodes) + ' nodes' +
      (r.stats.nps ? ' \u00B7 ' + Math.round(r.stats.nps / 1000) + ' kn/s' : '');
    const forcedMate = L.fastestMateLine(pool.concat(mateLines));
    if (forcedMate && S.mateMode === 'shortest') msg += ' · shortest verified mate M' + forcedMate.score;
    else if (huntPickInfo) {
      // say what the hunter is going for, so an unusual move is visible in the panel instead of mysterious
      if (huntPickInfo.mate) msg += ' · hunter mate M' + huntPickInfo.mate.score +
        (huntPickInfo.line.depth < r.searchDepth ? ' (proved at depth ' + huntPickInfo.line.depth + ')' : '');
      else if (huntPickInfo.hunt && L.aggressionScore(huntPickInfo.hunt)) {
        msg += ' · hunter: ' + L.huntNote(huntPickInfo.hunt) + ' (' + L.uciToSan(huntPickInfo.uci, pos.fen) + ')';
      }
    }
    if (r.eager) {
      msg += ' (first complete result - raise Think time for a deeper search)';
    } else {
      if (lim.playDepth && top.depth < lim.playDepth) msg += ' (target depth not reached in ' + fmtSecs(S.time) + ' - raise Think time)';
      // a `go movetime` window only ends early when the engine has nothing left to search (a single legal move)
      if (lim.timeMs > 0 && spentMs < lim.timeMs * 0.9 && !r.pondered) msg += ' (nothing left to think about here)';
    }
    if (maximumOn()) msg += lim.clocks ? ' · clock-managed' : ' · Think time (clock fallback)';
    if (lim.trollThink) msg += ' · troll timing (' + lim.trollThink + ')';
    if (lastTrollNote) msg += ' · ' + lastTrollNote;
    const quip = trollCommentaryFor(pos, top.move, ourCp);
    if (quip) el.tip.textContent = quip;
    setStatus(msg);
    showContext();
    render();
    if (S.autoplay) autoPlay(pos, pool, mateLines, r).catch(() => {});
  }

  // ---------- Pondering ----------
  function ponderGateFor(pos, lim) {
    return G.ponderGate({ enabled: S.ponder, maximum: maximumOn(), autoplay: S.autoplay,
      native: engine instanceof NativeEngine, hostAllows: !!(engine && engine.hostPonder),
      engineOption: !!(engine && engine.opts && engine.opts.Ponder), historyComplete: !!(pos.history && pos.history.complete),
      clocksOk: !!(lim && lim.clockOk) });
  }
  /* Our move is on the board and the opponent is thinking: if every condition holds, search the position after
     the reply Stockfish expects. ponderPlan was made when the move was played and is consumed here once. */
  function startPonder(pos) {
    const plan = ponderPlan;
    if (!plan || plan.base !== pos.cmd) return;
    ponderPlan = null;
    if (!plan.move) { ponderNote = 'no predicted reply from the engine'; showContext(); return; }
    const lim = trollLimits(pos, { ponder: true });
    const gate = ponderGateFor(pos, lim);
    if (!gate.ok) { ponderNote = 'not pondering: ' + gate.reason; showContext(); return; }
    const cmd = G.positionCommand(pos.history, [plan.move]);
    engine.wantOption('Ponder', 'true');
    if (!cmd || !engine.ponder(cmd, lim, pos.cmd)) { ponderNote = 'not pondering: engine busy'; showContext(); return; }
    ponderNote = 'pondering ' + (G.sanOf(pos.fen, plan.move) || plan.move) + ' (predicted reply) on the opponent\'s time';
    setStatus(sideLabel(pos.mover) + ' to move - pondering the predicted reply ' + (G.sanOf(pos.fen, plan.move) || plan.move));
    showContext();
  }
  function stopPondering(why) {
    ponderPlan = null;
    if (engine && engine.cancelPonder && engine.cancelPonder()) { ponderNote = 'stopped (' + why + ')'; showContext(); }
  }
  // History / clock / ponder state, one line each, so it is visible what the engine was actually told
  function showContext() {
    if (!el.context) return;
    const rows = ['History: ' + G.historyLabel(hist)];
    if (maximumOn()) {
      if (clockNote) rows.push('Clock: ' + clockNote);
      rows.push('Ponder: ' + (S.ponder ? (ponderNote || 'enabled - waits for our move and a predicted reply') : 'off'));
    }
    el.context.textContent = rows.join('\n');
  }

  // ===================================================================================
  //  Troll mode
  //  A joke layer on top of the engine. Two rules govern everything below:
  //    1. Nothing here changes what the engine is ASKED. Directives and rage tactics only choose which of the
  //       legal moves to play after the search has answered. The analysis path is untouched.
  //    2. Every taunt, index and fake number is rendered in this panel. Nothing is written to the page, sent
  //       to chat, or shown to another player.
  // ===================================================================================
  let trollUI = null;                 // the DOM/audio half, installed once the panel exists
  let directiveState = {};            // per-directive memory (monorail file, queen's tour quadrant, ...)
  let rageState = {};                 // the Rage Brain's memory (last tactic, carousel cycle)
  let currentDirective = null;        // what chaos mode is currently running
  let chaosPlays = 0;
  let trollThinkKind = null;          // think-time override for the next search: 'instant' | 'max' | 'oscillate'
  let lastRageThink = null;           // rage timing applies from the move after the tactic is chosen
  let lastTrollNote = '';             // what the panel says about the last troll choice
  let trollMemo = { key: null, pick: null };
  let lastFenSeen = null, lastMoveAt = 0;
  let evalBeforeOurMove = null;       // for the blunder/applause swing
  let pendingTrade = false;
  let lastOppUci = null;

  const trollOn = () => !!(T && S.troll);
  const dirState = id => (directiveState[id] = directiveState[id] || {});

  function randomDirectiveId() {
    if (!T) return null;
    const all = T.DIRECTIVES.filter(d => d.id !== 'time-troll' || true);
    return all[Math.floor(Math.random() * all.length)].id;
  }
  // Chaos mode rotates the rule every N moves, so a game under it never settles into one joke.
  function activeDirectiveId() {
    if (!trollOn()) return null;
    if (S.trollDirective === 'off') return null;
    const chaos = S.trollDirective === 'chaos' || S.trollChaosMode;
    if (chaos) {
      const every = Math.max(2, S.trollChaosEvery || 5);
      if (!currentDirective || chaosPlays >= every) {
        currentDirective = randomDirectiveId();
        chaosPlays = 0;
        directiveState = {};
      }
      return currentDirective;
    }
    return S.trollDirective;
  }
  function resetDirective() {
    currentDirective = null; chaosPlays = 0; directiveState = {}; rageState = {};
    trollMemo = { key: null, pick: null };
  }

  // The <details> header says whether troll mode is live and which rule is running, so it is never a mystery.
  function syncTrollSummary() {
    if (!el.trollSummary) return;
    if (!S.troll) { el.trollSummary.textContent = 'Troll mode (off)'; return; }
    const id = activeDirectiveId();
    const d = id && T ? T.DIRECTIVE_BY_ID[id] : null;
    el.trollSummary.textContent = 'Troll mode (on)' + (d ? ' \\u00B7 ' + d.name : S.trollRage ? ' \\u00B7 Rage Brain' : '');
  }

  /* Panel wiring. The directive menu is built from the registry in troll.js rather than written out in HTML,
     so the menu can never drift away from the code that implements it. */
  function wireTroll() {
    if (!T || !TU || !el.troll) return;
    if (el.trollDir) {
      el.trollDir.innerHTML = '';
      const opt = (v, txt, title) => { const o = document.createElement('option'); o.value = v; o.textContent = txt; if (title) o.title = title; return o; };
      el.trollDir.appendChild(opt('off', 'Off (no directive)'));
      el.trollDir.appendChild(opt('chaos', 'Chaos mode (rotate randomly)'));
      T.DIRECTIVE_GROUPS.forEach(g => {
        const og = document.createElement('optgroup'); og.label = g.name;
        T.DIRECTIVES.filter(d => d.group === g.id).forEach(d => og.appendChild(opt(d.id, d.name, d.blurb)));
        if (og.children.length) el.trollDir.appendChild(og);
      });
    }
    if (el.trollTactic) {
      el.trollTactic.innerHTML = '';
      const o = document.createElement('option'); o.value = 'auto'; o.textContent = 'Auto (picks for the moment)';
      el.trollTactic.appendChild(o);
      T.RAGE_GROUPS.forEach(g => {
        const og = document.createElement('optgroup'); og.label = g.name;
        T.RAGE_TACTICS.filter(t => t.group === g.id).forEach(t => {
          const n = document.createElement('option'); n.value = t.id; n.textContent = t.name; n.title = t.blurb;
          og.appendChild(n);
        });
        if (og.children.length) el.trollTactic.appendChild(og);
      });
    }
    trollUI = TU.install({
      S: S, save: saveSettings, root: el.root, panel: el.panel, head: el.head,
      status: el.status, tip: el.tip, evalEl: el.eval, bestEl: el.best,
      engineEl: el.engine, verifyEl: el.verify, viewport: viewport,
      say: setStatus, rand: Math.random,
      els: {
        troll: el.troll, trollBody: el.trollBody, trollDir: el.trollDir, trollSincerity: el.trollSincerity,
        trollChaos: el.trollChaos, trollRage: el.trollRage, trollTactic: el.trollTactic,
        trollEval: el.trollEval, trollEvalVal: el.trollEvalVal, trollClock: el.trollClock,
        trollClockVal: el.trollClockVal, trollPreview: el.trollPreview, trollCommentary: el.trollCommentary,
        trollSarcastic: el.trollSarcastic, trollShame: el.trollShame, trollSound: el.trollSound,
        trollVoice: el.trollVoice, trollGaslight: el.trollGaslight, trollRunaway: el.trollRunaway,
        trollLoading: el.trollLoading, trollConfidence: el.trollConfidence, trollMirror: el.trollMirror,
        trollSwap: el.trollSwap, trollJudge: el.trollJudge, trollTelem: el.trollTelem,
        dirRow: el.dirRow, rageRow: el.rageRow, bug: el.bug,
        confidenceRow: el.confidenceRow, confidence: el.confidence, telem: el.telem,
        frustRow: el.frustRow, frustFill: el.frustFill, frustVal: el.frustVal,
        analyze: el.analyze, close: el.close, engine: el.engine
      }
    });

    const save2 = () => { saveSettings(); if (trollUI) trollUI.sync(); syncTrollSummary(); };
    const refresh = () => { lastResult = null; lastEloMove = null; analyze(); };

    if (el.troll) el.troll.addEventListener('change', () => {
      S.troll = el.troll.checked;
      if (!S.troll) { resetDirective(); lastTrollNote = ''; trollThinkKind = null; lastRageThink = null; }
      sanitizeTroll(); save2(); render(); refresh();
    });
    if (el.trollDir) el.trollDir.addEventListener('change', () => {
      S.trollDirective = el.trollDir.value; sanitizeTroll(); resetDirective(); save2(); render(); refresh();
    });
    if (el.trollSincerity) el.trollSincerity.addEventListener('change', () => {
      S.trollSincerity = el.trollSincerity.value; sanitizeTroll(); save2();
    });
    if (el.trollChaosMode) el.trollChaosMode.addEventListener('change', () => {
      S.trollChaosMode = el.trollChaosMode.checked;
      if (el.chaosRow) el.chaosRow.style.display = S.trollChaosMode ? '' : 'none';
      resetDirective(); sanitizeTroll(); save2();
    });
    if (el.trollChaos) el.trollChaos.addEventListener('input', () => {
      S.trollChaosEvery = +el.trollChaos.value;
      if (el.trollChaosVal) el.trollChaosVal.textContent = S.trollChaosEvery;
    });
    if (el.trollChaos) el.trollChaos.addEventListener('change', () => { sanitizeTroll(); save2(); });
    if (el.trollRage) el.trollRage.addEventListener('change', () => {
      S.trollRage = el.trollRage.checked; resetDirective(); sanitizeTroll(); save2(); refresh();
    });
    if (el.trollTactic) el.trollTactic.addEventListener('change', () => {
      S.trollRageTactic = el.trollTactic.value; sanitizeTroll(); save2();
    });
    if (el.trollEval) {
      el.trollEval.addEventListener('input', () => {
        S.trollRageEval = +el.trollEval.value;
        if (el.trollEvalVal) el.trollEvalVal.textContent = '+' + (S.trollRageEval / 100).toFixed(1);
      });
      el.trollEval.addEventListener('change', () => { sanitizeTroll(); save2(); });
    }
    if (el.trollClock) {
      el.trollClock.addEventListener('input', () => {
        S.trollRageClock = +el.trollClock.value;
        if (el.trollClockVal) el.trollClockVal.textContent = S.trollRageClock + 's';
      });
      el.trollClock.addEventListener('change', () => { sanitizeTroll(); save2(); });
    }
    if (el.trollCommentary) el.trollCommentary.addEventListener('change', () => {
      S.trollCommentary = el.trollCommentary.value; sanitizeTroll(); save2(); refresh();
    });
    const bools = {
      trollPreview: 'trollPreview', trollSarcastic: 'trollSarcastic', trollShame: 'trollShame',
      trollSound: 'trollSound', trollVoice: 'trollVoice', trollGaslight: 'trollGaslight',
      trollRunaway: 'trollRunaway', trollLoading: 'trollLoading', trollConfidence: 'trollConfidence',
      trollMirror: 'trollMirror', trollSwap: 'trollSwap', trollJudge: 'trollJudge', trollTelem: 'trollTelem'
    };
    Object.keys(bools).forEach(nodeKey => {
      const node = el[nodeKey];
      if (!node) return;
      node.addEventListener('change', () => {
        S[bools[nodeKey]] = node.checked;
        sanitizeTroll(); save2(); render();
      });
    });
    if (trollUI) { trollUI.sync(); trollUI.armButtonSwap(); }
    syncTrollSummary();
    if (el.chaosRow) el.chaosRow.style.display = S.trollChaosMode ? '' : 'none';
  }

  /* Our evaluation in centipawns from OUR point of view, and whether it is a mate for us. `lines` lets a
     caller pass the search that just finished instead of the previous one, so the Rage Brain always gates on
     the position it is about to move in rather than on the one before it.

     No sign flip is needed: a UCI score is already stated from the point of view of the side to move, and
     every caller here only runs when it is genuinely our turn. Converting to "white's point of view" first
     (the usual `score * (turn === 'w' ? 1 : -1)`) would be correct for the bar but wrong for the gate, which
     has to know whether WE are the ones winning. */
  function ourEval(pos, lines) {
    const src = (lines && lines.length) ? lines : (lastResult ? lastResult.lines : null);
    if (!src || !src.length) return { cp: null, mate: false };
    const top = src[0];
    if (top.type === 'mate') { const m = top.score || 0; return { cp: m > 0 ? 100000 : -100000, mate: m > 0 }; }
    return { cp: top.score || 0, mate: false };
  }
  // Both clocks, from the point of view of the side the tutor plays.
  function clockPair(pos) {
    const c = readClocks();
    if (!c || c.error) return { myClockMs: null, oppClockMs: null };
    const us = sideForPosition(pos);
    return { myClockMs: us === 'w' ? c.white : c.black, oppClockMs: us === 'w' ? c.black : c.white };
  }

  /* The move a directive or the Rage Brain wants, or null when neither is active (or when the rule has
     nothing legal to do and the engine should just play). Rage is tried first because it is conditional: it
     only fires when you are winning AND have the time to be annoying with.

     The result is memoised per position: the board preview and the auto-play move are asked for in the same
     cycle, and asking twice would advance every stateful rule (the chaos rotation, blunder chicken's ratchet)
     by two moves instead of one. */
  function trollPickFor(pos, lines, preview) {
    if (!trollOn() || !T) return null;
    if (preview === true && !S.trollPreview) return null;   // preview follows its own switch; auto-play does not
    const k = keyOf(pos);
    if (trollMemo.key === k) return trollMemo.pick;
    const useLines = lines && lines.length ? lines : (lastResult ? lastResult.lines : []);
    const id = activeDirectiveId();
    const state = id ? dirState(id) : {};
    const ctx = T.makeContext(pos.fen, { lines: useLines, state: state, oppLastUci: lastOppUci, rand: Math.random });
    if (!ctx || !ctx.moves.length) return null;

    if (S.trollRage) {
      const ev = ourEval(pos, useLines), cl = clockPair(pos);
      const ply = pos.history && pos.history.plies != null ? pos.history.plies : null;
      const s = {
        score: ev.cp, mate: ev.mate, myClockMs: cl.myClockMs, oppClockMs: cl.oppClockMs, ply: ply,
        tactic: S.trollRageTactic, state: rageState,
        cfg: { evalThreshold: S.trollRageEval, clockMargin: (S.trollRageClock || 0) * 1000 }
      };
      const r = T.ragePick(ctx, s);
      if (trollUI) trollUI.setGateReason(r && r.gate ? r.gate.reason : '');
      // A timing override is only earned by a gate that is actually open: if the gate shut again, the search
      // window goes back to normal from the next move instead of lingering.
      if (!r || !r.on) lastRageThink = null;
      if (r && r.on && r.uci) {
        lastRageThink = r.think || null;
        chaosPlays++;
        return memo(k, {
          uci: r.uci, name: r.name, kind: 'rage', suspended: !!r.suspended, blurb: r.blurb,
          note: trollUI ? trollUI.rageNote(r) : r.name, think: r.think || null
        });
      }
    }
    if (id) {
      const p = T.pickDirective(id, ctx, { sincerity: S.trollSincerity });
      if (p && p.uci) {
        chaosPlays++;
        return memo(k, {
          uci: p.uci, name: p.name, kind: 'directive', suspended: !!p.suspended, blurb: p.blurb,
          note: trollUI ? trollUI.directiveNote(p) : p.name, think: T.directiveThink(id)
        });
      }
    }
    return memo(k, null);
  }
  function memo(k, pick) { trollMemo = { key: k, pick: pick }; return pick; }

  // The think-time override for the next search, decided before the search starts (the pick itself comes after).
  function trollPlanThink(pos) {
    if (!trollOn() || !T) return null;
    const id = activeDirectiveId();
    if (id) return T.directiveThink(id);
    if (S.trollRage && lastRageThink) return lastRageThink;
    return null;
  }
  /* Wrap the normal search limits with a troll timing. Maximum Strength normally hands both clocks to
     Stockfish's own time manager; a deliberate timing is not a time-management decision, so the override
     drops the clock budget and says so in the clock note rather than quietly pretending it is one. */
  function trollLimits(pos, opts) {
    const lim = limits(pos, opts);
    if (!trollOn() || !T || !trollThinkKind) return lim;
    const ply = pos && pos.history && pos.history.plies != null ? pos.history.plies : null;
    const ms = T.thinkMs(trollThinkKind, (S.time || 0) * 1000, ply);
    if (ms == null) return lim;
    if (lim.clocks) { delete lim.clocks; lim.clockOk = false; }
    lim.timeMs = ms;
    lim.eager = ms <= 150;
    lim.trollThink = trollThinkKind;
    lim.clockNote = (lim.clockNote ? lim.clockNote + ' \\u00B7 ' : '') + 'troll timing (' + trollThinkKind + ')';
    return lim;
  }

  /* Reorder the arrows so the first one is the move the directive/rage would actually play, so the preview
     on the board is honest about what is about to happen. Only same-depth alternatives follow it, exactly
     like the hunter's deliberate pick does. */
  function trollPreviewLines(pos, lines, shown) {
    if (!trollOn() || !S.trollPreview || !shown || shown.length < 2) return shown;
    const p = trollPickFor(pos, lines, true);
    if (!p) return shown;
    lastTrollNote = p.note || p.name;
    const hit = shown.filter(l => l.move === p.uci);
    if (!hit.length) return shown;
    const rest = shown.filter(l => l.move !== p.uci && l.depth === hit[0].depth);
    return hit.concat(rest);
  }

  // ---------- the panel's voice ----------
  // The sarcastic eval replaces "+2.3" with "+2.3 (and yet, here we are)". Cosmetic: the number is unchanged.
  function trollSarcastic(text, cp) {
    if (!trollOn() || !T || !S.trollSarcastic) return text;
    return T.COMMENTARY.sarcastic({ evalText: text, eval: cp || 0, rng: Math.random });
  }
  function trollCommentaryFor(pos, uci, cp) {
    if (!trollOn() || !T || !trollUI || !S.trollCommentary || S.trollCommentary === 'off') return '';
    const info = pos ? T.infoOf(uci, L.fenBoardMap(pos.fen)) : null;
    const after = pos ? G.playUci(pos.fen, uci) : null;
    return trollUI.commentaryFor({
      san: pos ? L.uciToSan(uci, pos.fen) : uci,
      piece: info ? info.type : '',
      capture: !!(info && info.capture),
      check: !!(after && G.inCheck(after)),
      mate: !!(after && G.inCheck(after) && !(G.legalMoves(after) || []).length),
      eval: cp || 0, evalText: pos && lastResult ? L.evalText(lastResult.lines[0], pos.turn) : '0.0',
      rng: Math.random
    });
  }
  function trollJudge(cp) {
    if (!trollOn() || !T || !S.trollJudge || cp == null) return '';
    return T.judgmentFor(cp, Math.random);
  }
  const ourCpOf = res => {
    if (!res || !res.lines || !res.lines.length) return null;
    const top = res.lines[0];
    return top.type === 'mate' ? ((top.score || 0) > 0 ? 100000 : -100000) : (top.score || 0);
  };

  // ---------- telemetry: what the opponent has been allowed to do ----------
  function pieceCount(st) { let n = 0; for (let i = 0; i < 64; i++) if (st.b[i]) n++; return n; }
  function piecesInOurHalf(st, ourSide) {
    let n = 0;
    for (let i = 0; i < 64; i++) {
      const p = st.b[i];
      if (!p) continue;
      const sq = 'abcdefgh'[i & 7] + ((i >> 3) + 1);
      const adv = ourSide === 'w' ? (+sq[1]) : 9 - (+sq[1]);
      const mine = p === p.toUpperCase() ? 'w' : 'b';
      if (mine !== ourSide && adv <= 4) n++;
    }
    return n;
  }
  function notePositionChange(prevFen, pos, atMs) {
    if (!trollOn() || !trollUI || !prevFen) { lastFenSeen = pos.fen; lastMoveAt = Date.now(); return; }
    const prev = G.parseFen(prevFen), now = G.parseFen(pos.fen);
    lastFenSeen = pos.fen;
    lastMoveAt = Date.now();
    if (!prev || !now) return;
    const byUs = !ourTurn(pos);
    // remember the opponent's move itself: Monkey see, monkey do mirrors it
    if (!byUs) {
      const cands = G.legalMoves(prevFen) || [];
      for (let i = 0; i < cands.length; i++) {
        if (G.playUci(prevFen, cands[i]) === pos.fen) { lastOppUci = cands[i]; break; }
      }
    }
    const captured = pieceCount(now) < pieceCount(prev);
    const check = !!G.inCheck(pos.fen);
    const our = sideForPosition(pos);
    const ctx = T ? T.makeContext(pos.fen, { lines: lastResult ? lastResult.lines : [] }) : null;
    if (byUs) {
      const gain = captured;
      if (gain && pendingTrade) { trollUI.noteMove({ byUs: true, capture: true, trade: true, ctx: ctx }); pendingTrade = false; }
      else trollUI.noteMove({ byUs: true, capture: gain, check: check, ctx: ctx });
      // The swing our move caused is only visible once the reply is on the board, so remember the
      // evaluation here and judge it in analyze() when the next position is searched.
      evalBeforeOurMove = ourCpOf(lastResult);
      return;
    }
    // the opponent just moved: this is where the eval swing of OUR last move becomes visible
    const entries = piecesInOurHalf(now, our) - piecesInOurHalf(prev, our);
    trollUI.noteMove({
      byUs: false, capture: captured, check: check, entered: entries > 0, trade: false,
      legalReplies: (G.legalMoves(pos.fen) || []).length,
      moveMs: atMs ? Math.max(0, Date.now() - atMs) : null,
      ctx: ctx
    });
    if (captured) pendingTrade = true;
    trollUI.telemetry(ctx);
  }

  // ---------- Auto-play ----------
  // Keep the physical board turn and the configured side separate. A selected colour is only acted on when it
  // is actually that colour's turn; this prevents a synthetic FEN from suggesting an illegal move.
  function sideForPosition(pos) {
    return S.side === 'me' ? pos.me : S.side === 'turn' ? pos.mover : S.side;
  }
  function sideLabel(side) { return side === 'w' ? 'White' : 'Black'; }
  const ourTurn = pos => pos.mover === sideForPosition(pos);
  const labelForPlay = () => autoplayEloKey() >= 3200 ? 'Full engine' : autoplayLevelLabel() + ' ELO';

  // Mate mode picks the line: 'shortest' takes the fewest-move mate proved anywhere in the think-time search,
  // 'normal' just plays the selected-depth top line, and 'hunter' prefers the most aggressive sound candidate.
  // Natural mistakes only add random deviations to non-mate choices; they never discard a proven mate, and the
  // hunter never rolls because its attacking choice is deliberate (see lib.js chooseMove / huntPick).
  const huntOn = () => S.mateMode === 'hunter';
  // Search candidate counts are independent of the arrow-display switch: hiding Top 3 must not silently disable
  // natural deviations or shrink mate coverage to one PV. The hunter asks for more because checks/baits can rank
  // well below the quiet top lines; MultiPV splits the same think time, which is the cost of that style.
  const MPV_HUNTER = 12, MPV_AUTOPLAY = 5, MPV_STANDARD = 3;
  const mpvFor = () => maximumOn() ? 1 : huntOn() ? MPV_HUNTER : (S.autoplay ? MPV_AUTOPLAY : MPV_STANDARD);
  // For non-mate pressure the hunter looks at its level's depth AND the deepest iteration. All mate-seeking styles
  // also receive the engine's positive mate proofs from every completed depth; ordinary moves remain level-capped.
  const huntPoolFor = r => huntOn() ? L.huntPool(r.lines, r.deepLines) : r.lines;
  const pickOpts = (fen, elo, mateLines) => ({ elo: maximumOn() ? 3200 : elo, mistakes: maximumOn() ? false : S.mistakes, mateMode: maximumOn() ? 'normal' : S.mateMode,
    huntRisk: S.huntRisk, fen: fen, rand: Math.random, mateLines: mateLines || [] });
  const huntLabel = () => (S.huntRisk === 'sound' ? 'sound' : S.huntRisk === 'balanced' ? 'balanced' : 'very aggressive');

  function pickForAutoplay(lines, fen, mateLines) {
    return L.chooseMove(lines, pickOpts(fen, autoplayEloKey(), mateLines));
  }
  // " · hunter: check + bait (3 pts offered)" - what the aggressive pick was going for
  const huntNoteOf = pick => huntOn() && pick && pick.hunt ? L.huntNote(pick.hunt) : '';

  let playAttempt = null;         // { key, uci, ok, tries, at, mate, mistake }: what auto-play tried for which position
  let playing = false;

  // Play one move for the analyzed position. Nothing here trusts the analysis: the board is re-read, and the
  // move goes through chess.com's own legal-move list (page-bridge), so a stale position simply does nothing.
  // There is intentionally no extra pace timer: Think time was already spent searching for this move.
  async function autoPlay(pos, lines, mateLines, result) {
    if (!S.autoplay || playing || !engine || !engine.ready || !lines || lines.length < 1 || !ourTurn(pos)) return;
    const key = keyOf(pos);
    if (playAttempt && playAttempt.key === key && playAttempt.ok) return;      // already moved for this position
    // Troll mode owns the move when it is on: a directive or the Rage Brain picks from the legal moves the
    // engine has already produced, so the engine's answer stays what it is - only the choice changes.
    const troll = trollPickFor(pos, lines, false);
    if (troll) {
      // The same stale-position guard as the normal path: the board is re-read and the move only goes out
      // while it is still genuinely our turn in the position that was analysed.
      const now = await readPosition();
      if (!S.autoplay || !now || now.settling || keyOf(now) !== key || !ourTurn(now)) return;
      lastTrollNote = troll.note || troll.name;
      await tryPlay(now, troll.uci, { troll: troll });
      return;
    }
    const choice = pickForAutoplay(lines, pos.fen, mateLines);
    if (!choice) return;
    // Yield only to the board/FEN request needed for stale-move protection; the move itself goes straight out.
    const now = await readPosition();
    if (!S.autoplay || !now || now.settling || keyOf(now) !== key || !ourTurn(now)) return;
    await tryPlay(now, choice.uci, Object.assign({}, choice, { result: result || null }));
  }

  // One attempt on chess.com's board. Whether it worked is judged by the board itself: an accepted move changes
  // the position, and the poll loop retries the same move until it does (or gives up after a few tries).
  async function tryPlay(pos, uci, info) {
    const key = keyOf(pos);
    const prior = playAttempt && playAttempt.key === key ? playAttempt.tries : 0;
    playAttempt = { key, uci, ok: false, tries: prior + 1, at: Date.now(),
      mate: info && info.mate ? info.mate : null, mistake: !!(info && info.mistake),
      hunt: info && info.hunt ? info.hunt : null };
    const { mate, mistake, hunt } = playAttempt;
    const san = L.uciToSan(uci, pos.fen);
    // `hunt` is only set by the hunter, so it is also what labels the move as the hunter's
    const mateNote = mate ? (hunt ? ' · hunter mate M' + mate.score : ' · shortest verified mate M' + mate.score) : '';
    const huntTraits = hunt && huntOn() && L.aggressionScore(hunt) ? L.huntNote(hunt) : '';
    const huntNote = !mateNote && huntTraits ? ' · hunter: ' + huntTraits : '';
    const slipNote = mistake ? ' · natural ' + autoplayLevelLabel() + ' ELO slip' : '';
    // A troll choice says what it is, so an absurd move is explained instead of mysterious.
    const tr = info && info.troll ? info.troll : null;
    const trollNote = tr ? ' · ' + (tr.suspended ? 'DIRECTIVE SUSPENDED, playing a real move' : tr.name) : '';
    if (tr) {
      playAttempt.troll = { kind: tr.kind, name: tr.name, suspended: !!tr.suspended };
      if (trollUI) trollUI.telemetry(T ? T.makeContext(pos.fen, { lines: [] }) : null);
    }
    // Maximum Strength: note our clock right before the move (to measure the increment afterwards)
    const result = info && info.result, measure = maximumOn() && S.autoplay && prior === 0;
    const pre = measure ? readClocks() : null, side = pos.mover === 'w' ? 'white' : 'black';
    const cmdAfter = pos.history ? G.positionCommand(pos.history, [uci]) : null;
    // Both are armed BEFORE the move goes out: the board can show the new position (and the poll can react to it)
    // before the bridge's answer arrives. They are keyed to the exact history after this move, so a move that does
    // not land can never match them.
    incProbe = pre && !pre.error && cmdAfter
      ? { side: pos.mover, before: pre[side], res: pre[side + 'Res'], ts: pre.ts, plies: pos.history.plies, cmdAfter, at: Date.now() } : null;
    // the opponent's most likely reply, for pondering once our move is on the board
    ponderPlan = maximumOn() && S.autoplay && cmdAfter
      ? { base: cmdAfter, move: G.ponderMove(G.playUci(pos.fen, uci) || pos.fen, result && result.ponder, result && result.pv) } : null;
    playing = true;
    let res;
    try { res = await playMove(uci); } finally { playing = false; }
    if (!(res.ok && res.confirmed)) {
      if (incProbe && incProbe.cmdAfter === cmdAfter) incProbe = null;
      if (ponderPlan && ponderPlan.base === cmdAfter && !res.ok) ponderPlan = null;
    }
    if (res.ok && res.confirmed && measure && result && result.doneAt) {
      // move-submission latency: engine answer -> board accepted the move (re-check + bridge round trip)
      latencies.push(Date.now() - result.doneAt);
      if (latencies.length > 12) latencies.shift();
    }
    if (res.ok) {
      // an API move is confirmed by the board; a synthetic click is only reported once the board confirms it
      playAttempt.ok = !!res.confirmed;
      lastEloMove = uci; render();
      el.elotxt.textContent = (res.san || san) + ' (auto-played at ' + labelForPlay() + ')' + mateNote + huntNote + slipNote + trollNote;
      const when = result && result.pondered ? ' after ponderhit (' + (result.pondered.ms / 1000).toFixed(1) + 's pondered on the opponent\'s time)'
        : result && result.clockManaged ? ' (clock-managed search)'
          : S.time > 0 ? ' after ' + fmtSecs(S.time) + ' of thinking' : ' instantly';
      setStatus(res.confirmed
        ? 'Auto-played ' + (res.san || san) + when + mateNote + huntNote + slipNote + trollNote
        : 'Auto-play: sent ' + san + when + ' - waiting for the board to confirm it' + mateNote + huntNote + slipNote + trollNote);
    } else {
      setStatus('Auto-play: ' + san + ' not played (' + res.reason + ')' + trollNote);
    }
    return res.ok;
  }

  async function playMove(uci) {
    const viaApi = await bridgeMove(uci);
    if (viaApi.ok) return viaApi;
    if (viaApi.reason === 'not a legal move here') return viaApi;
    return domMove(uci) ? { ok: true, confirmed: false, san: null } : viaApi;   // last resort: click the squares
  }

  // Synthetic pointer drag on the board squares, the way a user would move. Only used if chess.com's board
  // object refused the move, and never trusted blindly: the poll loop reports what really happened.
  function domMove(uci) {
    const b = getBoard();
    if (!b || typeof PointerEvent !== 'function') return false;
    const r = b.getBoundingClientRect(), size = r.width / 8;
    if (!size) return false;
    const flipped = isFlipped(b);
    const at = sq => {
      const f = sq.charCodeAt(0) - 97, rank = +sq[1] - 1;
      const col = flipped ? 7 - f : f, row = flipped ? rank : 7 - rank;
      return { x: r.left + size * (col + 0.5), y: r.top + size * (row + 0.5) };
    };
    const a = at(uci.slice(0, 2)), c = at(uci.slice(2, 4));
    const fire = (type, p) => b.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, view: window, pointerId: 1, pointerType: 'mouse',
      isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: p.x, clientY: p.y
    }));
    try { fire('pointerdown', a); fire('pointermove', c); fire('pointerup', c); return true; } catch (e) { return false; }
  }

  async function whatWouldEloPlay() {
    if (!lastResult) { await analyze(); if (!lastResult) return; }
    const base = lastResult;
    let lines = base.choiceLines || base.lines;
    let mateLines = base.mateLines || [];
    if (!maximumOn() && lines.length < 3 && engine && engine.ready) {
      const r = await engine.analyze(base.cmd || base.fen, trollLimits(null), mpvFor());
      if (!lastResult || lastResult.fen !== base.fen) return;
      if (r && r.lines.length) {
        lines = r.deepLines && huntOn() ? L.huntPool(r.lines, r.deepLines) : r.lines;
        mateLines = mateLines.concat(r.mateLines || []);
      }
    }
    const eloForPick = S.custom ? 1200 : eloKey();
    // With "Directives drive the preview" on, this button answers what the joke would actually play.
    const pseudo = { fen: base.fen, turn: base.turn, mover: base.turn, me: base.turn };
    const tr = trollPickFor(pseudo, lines, true);
    const pick = tr
      ? { uci: tr.uci, line: lines.filter(l => l.move === tr.uci)[0] || lines[0] }
      : L.chooseMove(lines, pickOpts(base.fen, eloForPick, mateLines));
    if (!pick) return;
    if (tr) {
      lastTrollNote = tr.note || tr.name;
      el.elotxt.textContent = L.uciToSan(pick.uci, base.fen) + ' \\u2014 ' +
        (tr.suspended ? 'DIRECTIVE SUSPENDED: ' + tr.name + ' has no legal move here' : tr.name + ': ' + tr.blurb);
      el.tip.textContent = tr.blurb + (tr.kind === 'rage' ? ' (Rage Brain)' : '');
      render();
      return;
    }
    const best = lines.map(l => l.move)[0];
    lastEloMove = pick.uci;
    const san = L.uciToSan(pick.uci, base.fen), label = S.custom ? '1200' : levelLabel();
    const huntNote = huntNoteOf(pick);
    if (pick.mate) {
      el.elotxt.textContent = san + ' (mate in ' + pick.mate.score + ' - the shortest line the engine proved)';
      el.tip.textContent = (huntOn()
        ? 'Hunter: any proven mate is taken, including one only the deepest iteration of the search found, so a '
          + 'low level still finishes the game. '
        : 'Mate mode "fewest moves": any proven mate is played instead of a quieter top line. ') +
        'Switch Checkmate style to Regular to let it just follow the evaluation.';
    } else if (huntNote) {
      el.elotxt.textContent = san + ' (hunter: ' + huntNote + ')';
      el.tip.textContent = 'Hunter (' + huntLabel() + '): with no mate proven, the most aggressive candidate wins - '
        + 'check, bait, then attack on the king - as long as the engine still scores it within '
        + (S.huntRisk === 'sound' ? '0.3' : S.huntRisk === 'balanced' ? '0.6' : '1.2') + ' pawns of the best line.';
    } else if (pick.uci !== best) {
      el.elotxt.textContent = san + ' (a likely inaccuracy at ' + label + ' ELO)';
      el.tip.textContent = 'At ' + label + ' ELO, players often pick a reasonable-looking move over the best one. ' + TIPS[eloForPick];
    } else {
      el.elotxt.textContent = san + ' (same as the engine move' + (S.mistakes ? '' : ' - mistakes are turned off') + ')';
      updateTip();
    }
    render();
  }

  // ---------- Auto-detect ----------
  // The observer is the no-added-delay path for auto-play: when chess.com updates the board, queue one read in
  // the next microtask instead of waiting for the fallback timer. The timer below remains only for board builds
  // that update their game object before their DOM.
  function queueAutoPoll() {
    if (!S.autoplay) return;
    // Coalesce a burst of board mutations. If a read is already in flight, retain the dirty flag so its finally
    // block performs one fresh read instead of losing the opponent's move until the fallback timer fires.
    autoPollQueued = true;
    if (polling || autoPollScheduled) return;
    autoPollScheduled = true;
    const run = () => {
      autoPollScheduled = false;
      if (!S.autoplay) { autoPollQueued = false; return; }
      if (!autoPollQueued || polling) return;
      autoPollQueued = false;
      poll();
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else Promise.resolve().then(run);
  }
  function watchBoard(board) {
    if (!S.autoplay || !board || typeof MutationObserver !== 'function') {
      if (boardObserver) boardObserver.disconnect();
      boardObserver = null; observedBoard = null;
      return;
    }
    if (observedBoard === board && boardObserver) return;
    if (boardObserver) boardObserver.disconnect();
    observedBoard = board;
    boardObserver = new MutationObserver(queueAutoPoll);
    boardObserver.observe(board, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
  }
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const pos = await readPosition();
      if (!pos || pos.settling) return;
      if (maximumOn() && S.autoplay) sampleClocks();   // so a ticking clock can be recognised if the page has no marker
      const key = keyOf(pos);
      if (key !== lastKeySeen) {
        notePositionChange(lastFenSeen, pos, lastMoveAt);
        lastKeySeen = key; lastResult = null; lastEloMove = null; clearOverlay();
        if (playAttempt && playAttempt.key !== key) playAttempt = null;   // that move landed (or the game moved on)
        el.fen.textContent = pos.fen;
        if (S.auto || S.autoplay) analyze(pos);     // auto-play drives its own analysis
        return;
      }
      // auto-play tried a move and the board still shows the same position: try again while it stays legal
      if (S.autoplay && !playing && playAttempt && !playAttempt.ok && playAttempt.key === key &&
        playAttempt.tries < 3 && Date.now() - playAttempt.at > 900 && ourTurn(pos)) {
        tryPlay(pos, playAttempt.uci, playAttempt);      // retry the same move, with the same mate/slip note
        return;
      }
      if (lastFlip !== pos.flipped) { lastFlip = pos.flipped; render(); }
      if (lastResult && !pos.board.querySelector(':scope > svg.ct-overlay')) render();
    } finally {
      polling = false;
      if (autoPollQueued) queueAutoPoll();
    }
  }
  // One poll at a time. Auto-play normally arrives here through the MutationObserver; the shorter timer is only
  // a safety net for board implementations whose state update is not reflected in the observed DOM immediately.
  async function pollLoop() {
    await poll();
    pollTimer = setTimeout(pollLoop, S.autoplay ? AUTOPLAY_TICK_MS : POLL_MS);
  }

  // ---------- Free dragging: the panel phases through any wall and comes back ----------
  // There is no tuck button and no docking anymore: the panel is dragged like a normal window, except the walls
  // do not stop it. Push it through the left edge and it keeps going off-screen until only a slim grab strip is
  // left on screen (that is the "tucked" look); push it back and it is whole again. Same for the other edges and
  // the corners. Dragging works in every mode and on every page the tutor runs on - it is pure panel geometry.
  const KEEP = 22;                  // px of panel that must stay on screen, so there is always something to grab
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

  function openPanel() { if (!S.open) { S.open = true; el.panel.classList.add('open'); saveSettings(); } }
  // ---- the "through the wall" state: only KEEP px of the panel are on screen, the rest is outside the viewport.
  // Whole panel on screen wins over any reveal, so pushing the panel back in always restores it completely.
  const panelBox = r => ({ x: r.left, y: r.top, w: r.width, h: r.height });
  const viewport = () => ({ w: window.innerWidth, h: window.innerHeight });
  function panelGeom() { return el.panel ? L.panelGeom(panelBox(el.panel.getBoundingClientRect()), viewport(), KEEP) : null; }
  function hiddenDir() { const g = panelGeom(); return g ? g.hidden : null; }
  function clearReveal() {
    clearTimeout(revealTimer); clearTimeout(hideTimer); revealTimer = null; hideTimer = null;
    if (el.panel) el.panel.classList.remove('reveal', 'from-t', 'from-b');
  }
  // pull a wall-hidden panel back out (no effect while the whole panel is on screen, or while it is being dragged)
  function applyReveal() {
    if (!el.panel || drag) return;       // a reveal mid-drag would slide the panel away from the cursor
    clearReveal();
    const dir = hiddenDir();
    if (!dir) return;
    el.panel.classList.add('reveal');
    if (dir === 't') el.panel.classList.add('from-t');
    else if (dir === 'b') el.panel.classList.add('from-b');
  }
  const revealOn = () => { clearTimeout(hideTimer); hideTimer = null; applyReveal(); };
  // leaving the panel / strip slides it back into the wall, after a short hand-over gap
  function revealOff() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { hideTimer = null; if (!panelHover && !panelFocus) clearReveal(); }, 150);
  }
  // ---- grab strip: while any part of the panel is past a wall, a slim strip sits on that wall where the panel
  // pokes in, so a wall-hidden panel can be pulled straight back out. Positions come from L.panelGeom (lib.js).
  let strips = [];
  function buildStrips() {
    for (const dir of ['l', 'r', 't', 'b']) {
      const s = document.createElement('div');
      s.className = 'ct-strip ct-strip-' + dir; s.dataset.dir = dir; s.style.cssText = 'display:none';
      s.addEventListener('mouseenter', () => { panelHover = true; revealOn(); });
      s.addEventListener('mouseleave', () => { panelHover = false; revealOff(); });
      s.addEventListener('pointerdown', e => {           // grab the strip: pull the panel back out of the wall
        e.preventDefault(); e.stopPropagation();
        openPanel();
        startDrag(e.clientX, e.clientY, true);
      });
      el.root.appendChild(s);
      strips.push(s);
    }
  }
  function updateGeometry() {
    if (!el.panel) return;
    const g = panelGeom() || { strips: [] };
    const byDir = {};
    g.strips.forEach(s => { byDir[s.dir] = s.rect; });
    for (const s of strips) {
      const r = byDir[s.dataset.dir];
      if (!r) { s.style.display = 'none'; continue; }
      s.style.display = 'block';
      s.style.left = r.x + 'px'; s.style.top = r.y + 'px';
      s.style.width = r.w + 'px'; s.style.height = r.h + 'px';
    }
  }
  // ---- free placement: the panel may slide right through the edges, it is never snapped back to a wall
  function placePanel(x, y) {
    el.panel.style.left = x + 'px'; el.panel.style.top = y + 'px';
    el.panel.style.right = 'auto'; el.panel.style.bottom = 'auto';
    S.pos = { x, y };
    updateGeometry();
  }
  function clampPanel() {                       // only for resize / first paint: keep a rescue sliver on screen
    if (!S.pos || !el.panel) return;
    const w = el.panel.offsetWidth, h = el.panel.offsetHeight;
    const x = S.pos.x, y = S.pos.y, W = window.innerWidth, H = window.innerHeight;
    placePanel(clampN(x, -(w - KEEP), W - KEEP), clampN(y, -(h - KEEP), H - KEEP));
  }
  function pullIn() {                           // slide the whole panel back on screen (tap on a grab strip)
    if (!S.pos || !el.panel) return;
    const w = el.panel.offsetWidth, h = el.panel.offsetHeight;
    placePanel(clampN(S.pos.x, 0, Math.max(0, window.innerWidth - w)), clampN(S.pos.y, 0, Math.max(0, window.innerHeight - h)));
  }

  // ---------- UI ----------
  async function buildUI() {
    const html = await (await fetch(chrome.runtime.getURL('panel.html'))).text();
    const root = document.createElement('div');
    root.id = 'ct-root'; root.innerHTML = html;
    document.body.appendChild(root);
    const q = id => root.querySelector('#' + id);
    el = {
      root: root, toggle: q('ct-toggle'), panel: q('ct-panel'), head: q('ct-head'), close: q('ct-close'),
      level: q('ct-level'), side: q('ct-side'), bestCb: q('ct-best'), top3: q('ct-top3'), auto: q('ct-auto'),
      autoplay: q('ct-autoplay'), autoplayElo: q('ct-autoplay-elo'), autohint: q('ct-autohint'),
      depth: q('ct-depth'), depthVal: q('ct-depthval'), depthRow: q('ct-depthrow'), time: q('ct-time'), timeVal: q('ct-timeval'),
      mate: q('ct-mate'), mistakes: q('ct-mistakes'), response: q('ct-response'),
      huntRisk: q('ct-hunt-risk'), huntRiskRow: q('ct-hunt-riskrow'),
      hash: q('ct-hash'), opacity: q('ct-opacity'), opacityVal: q('ct-opacityval'),
      analyze: q('ct-analyze'), eloBtn: q('ct-elomove'), status: q('ct-status'), best: q('ct-bestmove'), eval: q('ct-eval'),
      engine: q('ct-engine'), verify: q('ct-verify'), engdetail: q('ct-engdetail'), barfill: q('ct-barfill'),
      elotxt: q('ct-elotxt'), tip: q('ct-tip'), fen: q('ct-fen'), context: q('ct-context'),
      ponder: q('ct-ponder'), ponderRow: q('ct-ponderrow'),
      // ---- troll mode ----
      troll: q('ct-troll'), trollBody: q('ct-trollbody'), trollSummary: q('ct-trollsummary'),
      trollDir: q('ct-trolldir'), trollSincerity: q('ct-trollsincerity'), dirRow: q('ct-dir-row'),
      trollChaosMode: q('ct-trollchaosmode'), trollChaos: q('ct-trollchaos'),
      trollChaosVal: q('ct-trollchaosval'), chaosRow: q('ct-chaos-row'),
      trollRage: q('ct-trollrage'), rageRow: q('ct-trollragerow'), trollTactic: q('ct-trolltactic'),
      trollEval: q('ct-trolleval'), trollEvalVal: q('ct-trollevalval'),
      trollClock: q('ct-trollclock'), trollClockVal: q('ct-trollclockval'),
      trollPreview: q('ct-trollpreview'), trollCommentary: q('ct-trollcommentary'),
      trollSarcastic: q('ct-trollsarcastic'), trollShame: q('ct-trollshame'),
      trollSound: q('ct-trollsound'), trollVoice: q('ct-trollvoice'), trollGaslight: q('ct-trollgaslight'),
      trollRunaway: q('ct-trollrunaway'), trollLoading: q('ct-trollloading'),
      trollConfidence: q('ct-trollconfidence'), trollMirror: q('ct-trollmirror'),
      trollSwap: q('ct-trollswap'), trollJudge: q('ct-trolljudge'), trollTelem: q('ct-trolltelem'),
      bug: q('ct-bug'),
      confidenceRow: q('ct-confidence-row'), confidence: q('ct-confidence'),
      telem: q('ct-telem'), frustRow: q('ct-frust-row'), frustFill: q('ct-frustfill'), frustVal: q('ct-frustval')
    };
    el.side.value = S.side;
    el.bestCb.checked = S.showBest; el.top3.checked = S.showTop3; el.auto.checked = S.auto;
    el.panel.classList.toggle('open', S.open);
    buildStrips();
    if (S.pos) placePanel(S.pos.x, S.pos.y);
    syncControls(); clampPanel();
    wireTroll();

    const tap = (node, fn) => {   // click + touchend without double firing
      let touched = false;
      node.addEventListener('touchend', e => { touched = true; e.preventDefault(); fn(e); }, { passive: false });
      node.addEventListener('click', e => { if (touched) { touched = false; return; } fn(e); });
    };
    const rerun = () => { lastResult = null; lastEloMove = null; analyze(); };
    let rerunTimer = null;
    const rerunSoon = () => { clearTimeout(rerunTimer); rerunTimer = setTimeout(rerun, 350); };

    tap(el.toggle, () => { S.open = !S.open; el.panel.classList.toggle('open', S.open); updateGeometry(); saveSettings(); });
    tap(el.close, () => { S.open = false; el.panel.classList.remove('open'); clearReveal(); updateGeometry(); saveSettings(); });
    tap(el.analyze, () => analyze());
    tap(el.eloBtn, () => whatWouldEloPlay());

    el.level.addEventListener('change', () => {
      if (el.level.value === 'custom') S.custom = true; else { S.custom = false; S.elo = +el.level.value; }
      saveSettings(); syncControls(); rerun();
    });
    el.depth.addEventListener('input', () => { S.depth = +el.depth.value; el.depthVal.textContent = S.depth >= DEPTH_INF ? '\u221E' : String(S.depth); updateTip(); });
    el.depth.addEventListener('change', () => { saveSettings(); rerunSoon(); });
    el.time.addEventListener('input', () => { S.time = +el.time.value; el.timeVal.textContent = fmtSecs(S.time); updateTip(); updateAutoHint(); syncDispatch(); });
    el.time.addEventListener('change', () => { saveSettings(); syncDispatch(); rerunSoon(); });
    el.mate.addEventListener('change', () => {
      const wasMaximum = maximumOn();
      S.mateMode = ['normal', 'shortest', 'hunter', 'maximum'].includes(el.mate.value) ? el.mate.value : 'shortest';
      saveSettings(); syncControls();
      if (wasMaximum !== maximumOn() && !starting) {
        analysisSeq++; lastResult = null; lastEloMove = null; render();
        if (engine) engine.dispose();
        engine = null; startEngine();
      } else rerun();
    });
    el.huntRisk.addEventListener('change', () => {
      S.huntRisk = ['sound', 'balanced', 'very'].includes(el.huntRisk.value) ? el.huntRisk.value : 'very';
      saveSettings(); updateTip(); updateAutoHint(); rerun();
    });
    el.mistakes.addEventListener('change', () => {
      S.mistakes = el.mistakes.checked;
      saveSettings(); updateTip(); updateAutoHint();
      if (lastResult && !huntOn()) rerunSoon();   // update a random pick; the deliberate hunter is unaffected
    });
    el.ponder.addEventListener('change', () => {
      S.ponder = el.ponder.checked; saveSettings(); updateAutoHint();
      if (!S.ponder) stopPondering('pondering switched off');
      ponderNote = ''; showContext();
    });
    el.autoplay.addEventListener('change', () => {
      S.autoplay = el.autoplay.checked; saveSettings(); updateAutoHint();
      if (!S.autoplay) stopPondering('auto-play off');
      if (playAttempt && !playAttempt.ok) playAttempt = null;
      if (S.autoplay) {
        watchBoard(getBoard());
        queueAutoPoll();
        analyze();                                                // start searching straight away
      } else {
        watchBoard(null);
        setStatus('Auto-play off');
      }
    });
    el.autoplayElo.addEventListener('change', () => {
      S.autoplayElo = +el.autoplayElo.value;
      saveSettings(); updateAutoHint();
      if (S.autoplay) rerun();
    });
    el.hash.addEventListener('change', () => { S.hash = +el.hash.value; saveSettings(); if (engine && engine.ready) { engine.setHash(S.hash); showEngine(); } });
    el.side.addEventListener('change', () => { S.side = el.side.value; saveSettings(); updateAutoHint(); rerun(); });
    el.bestCb.addEventListener('change', () => { S.showBest = el.bestCb.checked; saveSettings(); render(); });
    el.top3.addEventListener('change', () => { S.showTop3 = el.top3.checked; saveSettings(); render(); });
    el.auto.addEventListener('change', () => { S.auto = el.auto.checked; saveSettings(); });
    el.opacity.addEventListener('input', () => { S.opacity = +el.opacity.value; el.opacityVal.textContent = S.opacity + '%'; el.panel.style.opacity = String(S.opacity / 100); });
    el.opacity.addEventListener('change', saveSettings);

    // a panel that was dragged past a wall slides back out while the pointer or the keyboard focus is inside it
    el.panel.addEventListener('mouseenter', () => { panelHover = true; revealOn(); });
    el.panel.addEventListener('mouseleave', () => { panelHover = false; revealOff(); });
    el.panel.addEventListener('focusin', () => { panelFocus = true; revealOn(); });
    el.panel.addEventListener('focusout', () => { panelFocus = false; revealOff(); });

    // dragging (mouse + touch + pen): grab the header and the panel follows the cursor, straight through any
    // wall and back. Nothing snaps, nothing docks - walls are not obstacles, they are just the end of the screen.
    el.head.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      startDrag(e.clientX, e.clientY);
      e.preventDefault();
    });
    el.head.addEventListener('touchstart', e => {
      if (e.target.tagName === 'BUTTON') return;
      const t = e.touches[0];
      startDrag(t.clientX, t.clientY);
    }, { passive: true });
  }

  // Starts a drag from anywhere the panel can be grabbed (header or wall strip).
  function startDrag(cx, cy, fromStrip) {
    // if a reveal has the panel slid out of the wall, freeze it exactly where the pointer sees it before grabbing
    const seen = el.panel.getBoundingClientRect();
    clearReveal();
    placePanel(seen.left, seen.top);          // same tick as .dragging below, so the panel does not jump or slide
    drag = { dx: cx - seen.left, dy: cy - seen.top, sx: cx, sy: cy, moved: false, fromStrip: !!fromStrip };
    el.panel.classList.add('dragging');
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
    window.addEventListener('touchmove', onDragMove, { passive: false });
    window.addEventListener('touchend', onDragEnd);
    window.addEventListener('touchcancel', onDragEnd);
  }
  function moveDrag(cx, cy) {
    if (Math.abs(cx - drag.sx) + Math.abs(cy - drag.sy) > 3) drag.moved = true;
    placePanel(cx - drag.dx, cy - drag.dy);
  }
  function onDragMove(e) {
    if (!drag) return;
    if (e.touches) {
      if (!e.touches[0]) return;
      e.preventDefault();
      moveDrag(e.touches[0].clientX, e.touches[0].clientY);
    } else moveDrag(e.clientX, e.clientY);
  }
  function onDragEnd() {
    if (!drag) return;
    const d = drag; drag = null;
    el.panel.classList.remove('dragging');
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
    window.removeEventListener('touchmove', onDragMove);
    window.removeEventListener('touchend', onDragEnd);
    window.removeEventListener('touchcancel', onDragEnd);
    if (d.fromStrip && !d.moved) pullIn();   // a tap on the strip slides the panel all the way back into view
    clampPanel();                            // never leave the panel fully off-screen: worst case a KEEP px strip stays
    saveSettings();
  }

  // ---------- Boot ----------
  async function startEngine() {
    if (engine || starting) return;
    starting = true;
    const requestedMaximum = maximumOn();
    let e = new Engine();
    try {
      if (maximumOn()) {
        const native = new NativeEngine();
        setStatus('Connecting optional native Stockfish backend...');
        try { await native.init(); e = native; }
        catch (err) { native.dispose(); e.nativeFallback = err.message; }
      }
      setStatus('Loading engine...');
      el.verify.className = 'warn'; el.verify.textContent = 'Checking engine...';
      engine = e;
      if (trollUI) trollUI.bootTheater();     // loading theater: absurd sub-steps while the real download runs
      // ask for persistent storage once the panel is up, so Chrome keeps the engine instead of evicting it
      askPersistentStorage().then(p => { if (e.cachePersisted !== true) e.cachePersisted = p; showEngine(); }).catch(() => {});
      if (!e.ready) await e.init();
      if (trollUI) trollUI.stopBootTheater();   // the real engine line replaces the jokes
      showEngine(); setStatus(e.nativeFallback ? 'Browser fallback: ' + e.nativeFallback : 'Ready');
      if (S.auto || S.autoplay) analyze();
    } catch (err) {
      engine = null;
      if (trollUI) trollUI.stopBootTheater();
      el.verify.className = 'warn'; el.verify.textContent = '\u26A0 Engine failed to start';
      setStatus('Engine failed to start: ' + err.message + ' (press Analyze to retry)');
      try { e.frame && e.frame.remove(); } catch (_) {}
    } finally {
      starting = false;
      if (requestedMaximum !== maximumOn()) {
        if (engine) engine.dispose();
        engine = null; startEngine();
      }
    }
  }

  async function boot() {
    await loadSettings();
    await buildUI();
    startEngine();
    pollLoop();
    window.addEventListener('resize', () => { clampPanel(); updateGeometry(); clearReveal(); render(); });
    let lastPath = location.pathname;
    setInterval(() => {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname; lastResult = null; lastEloMove = null; lastKeySeen = ''; analysisSeq++;
      stopPondering('page changed');
      clearOverlay();
      startEngine();
    }, 800);
  }

  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
