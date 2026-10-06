(() => {
  'use strict';
  if (window.__chessTutorLoaded) return;
  window.__chessTutorLoaded = true;
  const L = window.CTLib;
  if (!L) { console.warn('Chess Tutor: lib.js did not load'); return; }

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
    // mateMode 'shortest' = take the fewest-move forced mate the engine proved; 'normal' = the regular top line.
    // mistakes = the low-ELO deviation roll that makes play look human instead of engine-perfect.
    autoplay: false, autoplayElo: 3200, mateMode: 'shortest', mistakes: true
  };
  const S = Object.assign({}, DEFAULTS);
  const DEPTH_INF = 40;            // slider maximum = no strength cap: play the deepest line
  const NS = 'http://www.w3.org/2000/svg';
  const EAGER_SAFETY_MS = 2500;    // prevents an unlimited, instant search from running forever
  const POLL_MS = 600, AUTOPLAY_TICK_MS = 100;   // MutationObserver handles the immediate path; this is a fallback

  let lastResult = null;           // { fen, lines, turn }
  let lastEloMove = null;
  let lastKeySeen = '', lastFlip = null;
  let engine = null, starting = false;
  let el = {};
  let revealTimer = null, hideTimer = null, drag = null, panelHover = false, panelFocus = false;
  let analysisSeq = 0, polling = false, mismatch = 0, pollTimer = null;
  let boardObserver = null, observedBoard = null, autoPollQueued = false, autoPollScheduled = false;

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
    S.mateMode = S.mateMode === 'normal' ? 'normal' : 'shortest';   // anything unknown = chase the fewest-move mate
    S.mistakes = S.mistakes !== false;                               // mistakes stay on unless explicitly turned off
    if (!['me', 'turn', 'w', 'b'].includes(S.side)) S.side = 'me';
    // "speed" belonged to the old paced auto-play UI. Delete it on load so every upgraded installation now has
    // the same no-added-delay behavior, rather than silently retaining a stored wait.
    delete S.speed;
    delete S.dock; delete S.tucked; delete S.autoTuck;   // 1.1 tuck state: replaced by free dragging
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

  // exact FEN straight from chess.com's board object (page-bridge.js runs in the page world)
  let bridgeSeq = 0;
  function bridgeFen(timeout = 350) {
    return new Promise(res => {
      const id = ++bridgeSeq;
      const off = () => { clearTimeout(t); window.removeEventListener('message', h); };
      const t = setTimeout(() => { off(); res(null); }, timeout);
      const h = e => {
        if (e.source !== window || !e.data || e.data.ctRes !== 1 || e.data.id !== id) return;
        off(); res(e.data.ok ? e.data.fen : null);
      };
      window.addEventListener('message', h);
      window.postMessage({ ctReq: 1, id }, '*');
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
      if (bf.split(' ')[0] === domPlacement) { fen = bf; src = 'board'; mismatch = 0; }
      else if (++mismatch < 4) return { settling: true };     // board is mid-animation / mid-drag: wait a tick
    }
    if (!fen) fen = L.buildFen(pieces, domMover(b, pieces));
    const mover = fen.split(' ')[1] === 'b' ? 'b' : 'w';
    // Never rewrite the FEN turn. Analysing an invented side to move can produce a move that chess.com's board
    // must reject; the selected side controls when we act, while the actual board turn controls legality.
    return { board: b, turn: mover, mover, me, flipped, src, fen };
  }
  const keyOf = p => p.fen.split(' ').slice(0, 4).join(' ') + '|' + p.mover + S.side;

  // ---------- Search limits ----------
  const eloKey = () => PRESETS[S.elo] !== undefined ? S.elo : 1200;
  const autoplayEloKey = () => PRESETS[S.autoplayElo] !== undefined ? S.autoplayElo : 3200;
  // The ELO level is the strength target, Think time is the clock. They are separate on purpose: the engine is
  // allowed to keep searching for the whole think time even at 400 ELO, and the move it answers/plays is then
  // taken from that level's depth. Auto-play dispatches as soon as that search returns - no extra pacing timer.
  function limits() {
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
    }
    async init() {
      const frame = document.createElement('iframe');
      frame.src = chrome.runtime.getURL('engine.html');
      frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none;left:0;top:0;';
      this.frame = frame;
      const loaded = new Promise((res, rej) => { this._loaded = res; this._fail = rej; });
      loaded.catch(() => {});
      window.addEventListener('message', e => {
        if (e.source !== frame.contentWindow || !e.data || !e.data.ct) return;
        const d = e.data;
        if (d.error) { setStatus('Engine error: ' + d.error); if (d.fatal) this._fail(new Error(d.error)); }
        if (d.engineName) { this.meta = d; this._loaded(); }
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
      await Promise.race([loaded, new Promise((_, rej) => setTimeout(() => rej(new Error('engine download timed out')), 180000))]);

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
      const cur = this.cur; this.cur = null; this.busy = false;
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
      const top = ds.length ? this.byDepth[Math.max(...ds)][1] || lines[0] : null;   // latest stats for line 1
      cur.resolve({ lines, eager: !!eager,
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
    analyze(fen, lim, mpv) {
      return new Promise(resolve => {
        const job = { fen, lim, mpv: mpv || 1, resolve, superseded: false, settled: false, eager: !!(lim && lim.eager) };
        if (this.busy) {
          if (this.queued) this.queued.resolve(null);
          this.queued = job;
          if (this.cur) this.cur.superseded = true;
          this.send('stop');
        } else this.run(job);
      });
    }
    run(job) {
      this.busy = true; this.cur = job; this.byDepth = {};
      if (this.mpv !== job.mpv) { this.send('setoption name MultiPV value ' + job.mpv); this.mpv = job.mpv; }
      this.send('position fen ' + job.fen);
      this.send(L.goCommand(job.lim));
    }
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
    if (!el.engine || !engine || !engine.meta) return;
    const m = engine.meta, id = m.idName || 'unknown engine';
    const is18 = /stockfish\s*18/i.test(id);
    el.engine.textContent = id;
    if (is18 && m.verified) { el.verify.className = 'ok'; el.verify.textContent = '\u2713 Stockfish 18 confirmed (engine reported it)'; }
    else if (/stockfish/i.test(id)) { el.verify.className = 'warn'; el.verify.textContent = '\u26A0 NOT Stockfish 18 - running ' + id; }
    else { el.verify.className = 'warn'; el.verify.textContent = '\u26A0 Unverified engine: "' + id + '"'; }
    const bits = [m.engineKind,
      'NNUE ' + (engine.nnue ? '\u2713' : '?'),
      'Hash ' + engine.hash + ' MB',
      'Threads ' + engine.threads + (engine.threads === 1 ? ' (single-thread build)' : '')];
    if (engine.selfTest) bits.push(engine.selfTest.ok ? 'self-test OK' + (engine.selfTest.nps ? ' @ ' + Math.round(engine.selfTest.nps / 1000) + ' kn/s' : '') : 'self-test FAILED');
    if (m.hash) bits.push('sha256 ' + m.hash.slice(0, 12));
    el.engdetail.textContent = bits.filter(Boolean).join(' \u00B7 ');
  }
  function updateTip() {
    const think = S.time > 0 ? 'It thinks for ' + fmtSecs(S.time) + ' per position at every level' : 'It answers instantly (first complete result)';
    const policy = (S.mateMode === 'shortest' ? 'fewest-move mate' : 'regular best move') + ', ' +
      (S.mistakes ? 'natural mistakes on' : 'mistakes off');
    el.tip.textContent = (S.custom
      ? 'Custom search: ' + (S.depth >= DEPTH_INF ? 'no depth limit, full strength' : 'plays the depth-' + S.depth + ' lines') + '. '
      : 'At ' + levelLabel() + ' ELO: ' + TIPS[eloKey()] + ' ') + think + ' \u00B7 ' + policy + '.';
    el.eloBtn.textContent = S.custom ? 'What would 1200 play?' : 'What would ' + levelLabel() + ' play?';
  }
  function updateAutoHint() {
    const who = S.side === 'me' ? 'your side' : S.side === 'turn' ? 'the side to move, both colours' : S.side === 'w' ? 'White' : 'Black';
    const at = autoplayEloKey() >= 3200 ? 'Full engine' : autoplayLevelLabel() + ' ELO';
    const timing = S.time > 0
      ? 'It thinks ' + fmtSecs(S.time) + ' for every move at any level, then plays at once - no extra delay.'
      : 'It plays the first complete result at once.';
    const mateGoal = S.mateMode === 'shortest' ? 'A proven forced mate is taken in the fewest moves.' : 'Regular play: its best line, no mate hunting.';
    const slip = S.mistakes ? 'Natural mistakes are on, so a low level slips like a person.' : 'Mistakes are off: it always plays its own best line.';
    el.autohint.textContent = (S.autoplay ? 'On: ' + who + ' at ' + at + '. ' : 'Off - turn on to play ' + who + ' at ' + at + '. ')
      + timing + ' ' + mateGoal + ' ' + slip;
    el.autohint.classList.toggle('on', S.autoplay);
  }
  // "Move dispatch" is a readout, not a control: auto-play has no pacing timer of its own, the only wait before
  // a move goes out is the Think time the engine is given for that position.
  function syncDispatch() {
    if (el.response) el.response.textContent = S.time > 0 ? 'After ' + fmtSecs(S.time) + ' thinking' : 'Immediate (instant)';
  }
  function syncControls() {
    el.level.value = S.custom ? 'custom' : String(eloKey());
    el.depthRow.style.display = S.custom ? '' : 'none';
    el.depth.value = S.depth; el.depthVal.textContent = S.depth >= DEPTH_INF ? '\u221E' : String(S.depth);
    el.time.value = S.time; el.timeVal.textContent = fmtSecs(S.time);
    el.mate.value = S.mateMode; el.mistakes.checked = S.mistakes;
    syncDispatch();
    el.hash.value = String(S.hash);
    el.opacity.value = S.opacity; el.opacityVal.textContent = S.opacity + '%';
    el.panel.style.opacity = String(S.opacity / 100);
    el.autoplayElo.value = String(autoplayEloKey());
    el.autoplay.checked = S.autoplay;
    updateTip(); updateAutoHint();
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
    if (!ourTurn(pos)) {
      el.best.textContent = '-';
      setStatus(sideLabel(sideForPosition(pos)) + ' to move - waiting');
      return;
    }
    if (!engine.ready) { setStatus('Engine loading...'); return; }
    const lim = limits(), t0 = Date.now();
    const strength = S.autoplay ? 'auto-play ' + autoplayLevelLabel() + ' ELO' : levelLabel() + ' ELO';
    const goal = S.mateMode === 'shortest' ? ', preferring the shortest proven mate' : ', regular best move';
    setStatus((S.time > 0 ? 'Thinking for ' + fmtSecs(S.time) + ' (' + strength + goal + ')...' : 'Searching (' + strength + goal + ')...'));
    // Auto-play gets multiple PVs so it can choose the shortest engine-verified mating line, and so a natural
    // mistake has real candidate moves to pick from instead of a single engine line.
    const r = await engine.analyze(pos.fen, lim, S.autoplay ? 5 : S.showTop3 ? 3 : 1);
    if (!r) return;                                           // superseded by a newer request
    if (seq !== analysisSeq) return;
    const now = await readPosition();
    if (!now || now.settling || keyOf(now) !== keyOf(pos)) return;   // board changed while thinking; poll restarts
    if (!r.lines.length) { setStatus('No legal moves (game over?).'); return; }
    lastResult = { fen: pos.fen, lines: r.lines, turn: pos.turn };
    const top = r.lines[0];
    el.best.textContent = L.uciToSan(top.move, pos.fen); el.best.title = top.move;
    el.eval.textContent = L.evalText(top, pos.turn);
    setBar(top, pos.turn);
    el.elotxt.textContent = '-';
    const spentMs = Date.now() - t0;
    let msg = 'Thought ' + (spentMs / 1000).toFixed(2) + 's · played from depth ' + top.depth +
      (lim.playDepth ? '/' + lim.playDepth : '') +
      (r.searchDepth > top.depth ? ' (searched to ' + r.searchDepth + ')' : '') + ' \u00B7 ' +
      L.fmtCount(r.stats.nodes) + ' nodes' +
      (r.stats.nps ? ' \u00B7 ' + Math.round(r.stats.nps / 1000) + ' kn/s' : '');
    const forcedMate = L.fastestMateLine(r.lines);
    if (forcedMate && S.mateMode === 'shortest') msg += ' · shortest verified mate M' + forcedMate.score;
    if (r.eager) {
      msg += ' (first complete result - raise Think time for a deeper search)';
    } else {
      if (lim.playDepth && top.depth < lim.playDepth) msg += ' (target depth not reached in ' + fmtSecs(S.time) + ' - raise Think time)';
      // a `go movetime` window only ends early when the engine has nothing left to search (a single legal move)
      if (lim.timeMs > 0 && spentMs < lim.timeMs * 0.9) msg += ' (nothing left to think about here)';
    }
    setStatus(msg);
    render();
    if (S.autoplay) autoPlay(pos, r.lines).catch(() => {});
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

  // Mate mode picks the line: 'shortest' takes the fewest-move mate the engine proved, 'normal' just plays the
  // top line at the Auto-play ELO. Natural mistakes then get the low-ELO deviation roll - skipped while a proven
  // mate is on the board, so a forced win is never thrown away to look human. The policy lives in lib.js.
  function pickForAutoplay(lines) {
    return L.chooseMove(lines, { elo: autoplayEloKey(), mistakes: S.mistakes, mateMode: S.mateMode, rand: Math.random });
  }

  let playAttempt = null;         // { key, uci, ok, tries, at, mate, mistake }: what auto-play tried for which position
  let playing = false;

  // Play one move for the analyzed position. Nothing here trusts the analysis: the board is re-read, and the
  // move goes through chess.com's own legal-move list (page-bridge), so a stale position simply does nothing.
  // There is intentionally no extra pace timer: Think time was already spent searching for this move.
  async function autoPlay(pos, lines) {
    if (!S.autoplay || playing || !engine || !engine.ready || !lines || lines.length < 1 || !ourTurn(pos)) return;
    const key = keyOf(pos);
    if (playAttempt && playAttempt.key === key && playAttempt.ok) return;      // already moved for this position
    const choice = pickForAutoplay(lines);
    if (!choice) return;
    // Yield only to the board/FEN request needed for stale-move protection; the move itself goes straight out.
    const now = await readPosition();
    if (!S.autoplay || !now || now.settling || keyOf(now) !== key || !ourTurn(now)) return;
    await tryPlay(now, choice.uci, choice);
  }

  // One attempt on chess.com's board. Whether it worked is judged by the board itself: an accepted move changes
  // the position, and the poll loop retries the same move until it does (or gives up after a few tries).
  async function tryPlay(pos, uci, info) {
    const key = keyOf(pos);
    const prior = playAttempt && playAttempt.key === key ? playAttempt.tries : 0;
    playAttempt = { key, uci, ok: false, tries: prior + 1, at: Date.now(),
      mate: info && info.mate ? info.mate : null, mistake: !!(info && info.mistake) };
    const { mate, mistake } = playAttempt;
    const san = L.uciToSan(uci, pos.fen);
    const mateNote = mate ? ' · shortest verified mate M' + mate.score : '';
    const slipNote = mistake ? ' · natural ' + autoplayLevelLabel() + ' ELO slip' : '';
    playing = true;
    let res;
    try { res = await playMove(uci); } finally { playing = false; }
    if (res.ok) {
      // an API move is confirmed by the board; a synthetic click is only reported once the board confirms it
      playAttempt.ok = !!res.confirmed;
      lastEloMove = uci; render();
      el.elotxt.textContent = (res.san || san) + ' (auto-played at ' + labelForPlay() + ')' + mateNote + slipNote;
      const when = S.time > 0 ? ' after ' + fmtSecs(S.time) + ' of thinking' : ' instantly';
      setStatus(res.confirmed
        ? 'Auto-played ' + (res.san || san) + when + mateNote + slipNote
        : 'Auto-play: sent ' + san + when + ' - waiting for the board to confirm it' + mateNote + slipNote);
    } else {
      setStatus('Auto-play: ' + san + ' not played (' + res.reason + ')');
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
    let lines = base.lines;
    if (lines.length < 3 && engine && engine.ready) {
      const r = await engine.analyze(base.fen, limits(), 5);
      if (!lastResult || lastResult.fen !== base.fen) return;
      if (r && r.lines.length) lines = r.lines;
    }
    const eloForPick = S.custom ? 1200 : eloKey();
    const pick = L.chooseMove(lines, { elo: eloForPick, mistakes: S.mistakes, mateMode: S.mateMode, rand: Math.random });
    if (!pick) return;
    const best = lines.map(l => l.move)[0];
    lastEloMove = pick.uci;
    const san = L.uciToSan(pick.uci, base.fen), label = S.custom ? '1200' : levelLabel();
    if (pick.mate) {
      el.elotxt.textContent = san + ' (mate in ' + pick.mate.score + ' - the shortest line the engine proved)';
      el.tip.textContent = 'Mate mode "fewest moves": any proven mate is played instead of a quieter top line. ' +
        'Switch Checkmate style to Regular to let it just follow the evaluation.';
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
      const key = keyOf(pos);
      if (key !== lastKeySeen) {
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
      hash: q('ct-hash'), opacity: q('ct-opacity'), opacityVal: q('ct-opacityval'),
      analyze: q('ct-analyze'), eloBtn: q('ct-elomove'), status: q('ct-status'), best: q('ct-bestmove'), eval: q('ct-eval'),
      engine: q('ct-engine'), verify: q('ct-verify'), engdetail: q('ct-engdetail'), barfill: q('ct-barfill'),
      elotxt: q('ct-elotxt'), tip: q('ct-tip'), fen: q('ct-fen')
    };
    el.side.value = S.side;
    el.bestCb.checked = S.showBest; el.top3.checked = S.showTop3; el.auto.checked = S.auto;
    el.panel.classList.toggle('open', S.open);
    buildStrips();
    if (S.pos) placePanel(S.pos.x, S.pos.y);
    syncControls(); clampPanel();

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
      S.mateMode = el.mate.value === 'normal' ? 'normal' : 'shortest';
      saveSettings(); updateTip(); updateAutoHint(); rerun();
    });
    el.mistakes.addEventListener('change', () => {
      S.mistakes = el.mistakes.checked;
      saveSettings(); updateTip(); updateAutoHint();
      if (lastResult) rerunSoon();          // the pick changes: its arrow should not keep pointing at the old slip
    });
    el.autoplay.addEventListener('change', () => {
      S.autoplay = el.autoplay.checked; saveSettings(); updateAutoHint();
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
    el.top3.addEventListener('change', () => { S.showTop3 = el.top3.checked; saveSettings(); rerun(); });
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
    const e = new Engine();
    try {
      setStatus('Loading engine...');
      el.verify.className = 'warn'; el.verify.textContent = 'Checking engine...';
      engine = e;
      await e.init();
      showEngine(); setStatus('Ready');
      if (S.auto || S.autoplay) analyze();
    } catch (err) {
      engine = null;
      el.verify.className = 'warn'; el.verify.textContent = '\u26A0 Engine failed to start';
      setStatus('Engine failed to start: ' + err.message + ' (press Analyze to retry)');
      try { e.frame && e.frame.remove(); } catch (_) {}
    } finally { starting = false; }
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
      clearOverlay();
      startEngine();
    }, 800);
  }

  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
