/* Chess Tutor - pure helpers (no DOM, no chrome.*). Shared by content.js and the node tests. */
(function (root) {
  'use strict';

  function fenBoardMap(fen) {
    var m = {};
    fen.split(' ')[0].split('/').forEach(function (row, i) {
      var f = 0;
      for (var k = 0; k < row.length; k++) {
        var ch = row[k];
        if (/\d/.test(ch)) f += +ch;
        else { m['abcdefgh'[f] + (8 - i)] = ch; f++; }
      }
    });
    return m;
  }

  function uciToSan(uci, fen) {
    if (!uci || uci.length < 4) return uci || '-';
    var m = fenBoardMap(fen);
    var from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci[4];
    var pc = m[from];
    if (!pc) return uci;
    var type = pc.toUpperCase();
    if (type === 'K' && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2) return to[0] === 'g' ? 'O-O' : 'O-O-O';
    var cap = !!m[to] || (type === 'P' && from[0] !== to[0]);
    var s = type === 'P' ? (cap ? from[0] + 'x' : '') + to : type + (cap ? 'x' : '') + to;
    if (promo) s += '=' + promo.toUpperCase();
    return s;
  }

  // pieces: { '55': 'wp', ... } keyed by file(1-8) + rank(1-8)
  function placementOf(pieces) {
    var rows = [];
    for (var r = 8; r >= 1; r--) {
      var row = '', empty = 0;
      for (var f = 1; f <= 8; f++) {
        var pc = pieces['' + f + r];
        if (!pc) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += pc[0] === 'w' ? pc[1].toUpperCase() : pc[1];
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return rows.join('/');
  }

  // DOM-only fallback FEN (castling is guessed from piece placement; en passant unknown)
  function buildFen(pieces, turn) {
    var c = '';
    if (pieces['51'] === 'wk') { if (pieces['81'] === 'wr') c += 'K'; if (pieces['11'] === 'wr') c += 'Q'; }
    if (pieces['58'] === 'bk') { if (pieces['88'] === 'br') c += 'k'; if (pieces['18'] === 'br') c += 'q'; }
    return placementOf(pieces) + ' ' + turn + ' ' + (c || '-') + ' - 0 1';
  }

  function setTurn(fen, turn) {
    var p = fen.split(' ');
    while (p.length < 6) p.push(p.length === 2 ? '-' : p.length === 3 ? '-' : p.length === 4 ? '0' : '1');
    if (p[1] !== turn) p[3] = '-';       // en-passant square is meaningless for the other side
    p[1] = turn;
    return p.join(' ');
  }

  function parseOption(line) {
    var m = /^option name (.+?) type (\w+)(?: default (\S*))?(?: min (-?\d+))?(?: max (-?\d+))?/.exec(line);
    if (!m) return null;
    return { name: m[1], type: m[2], def: m[3], min: m[4] === undefined ? null : +m[4], max: m[5] === undefined ? null : +m[5] };
  }

  function parseInfo(line) {
    if (line.indexOf('info') !== 0 || line.indexOf(' pv ') < 0 || / (lower|upper)bound/.test(line)) return null;
    var d = /depth (\d+)/.exec(line), mp = /multipv (\d+)/.exec(line);
    var sc = /score (cp|mate) (-?\d+)/.exec(line), pv = / pv (.+)$/.exec(line);
    if (!d || !sc || !pv) return null;
    var n = /nodes (\d+)/.exec(line), nps = /nps (\d+)/.exec(line), t = /time (\d+)/.exec(line), sd = /seldepth (\d+)/.exec(line);
    var moves = pv[1].trim().split(/\s+/);
    return {
      depth: +d[1], seldepth: sd ? +sd[1] : null, multipv: mp ? +mp[1] : 1, type: sc[1], score: +sc[2],
      pv: moves, move: moves[0], nodes: n ? +n[1] : null, nps: nps ? +nps[1] : null, time: t ? +t[1] : null
    };
  }

  function evalText(line, turn) {
    var sign = turn === 'w' ? 1 : -1;
    if (line.type === 'mate') { var m = line.score * sign; return (m > 0 ? '+M' : '-M') + Math.abs(m); }
    var v = (line.score * sign) / 100;
    return (v >= 0 ? '+' : '') + v.toFixed(1);
  }

  function whitePct(line, turn) {
    var sign = turn === 'w' ? 1 : -1;
    if (line.type === 'mate') return line.score * sign > 0 ? 100 : 0;
    return 100 / (1 + Math.exp(-(line.score * sign) / 400));
  }

  function sqCenter(sq, flipped) {
    var f = sq.charCodeAt(0) - 96, r = +sq[1];
    var col = flipped ? 8 - f : f - 1, row = flipped ? r - 1 : 8 - r;
    return { x: (col + 0.5) * 12.5, y: (row + 0.5) * 12.5, col: col, row: row };
  }

  // Arrow geometry in a 100x100 board space: polyline for the shaft + triangle for the head.
  function arrowShape(uci, flipped, o) {
    o = o || {};
    var headLen = o.headLen || 3.9, headHalf = o.headHalf || 2.8, tail = o.tail == null ? 2.6 : o.tail;
    var a = sqCenter(uci.slice(0, 2), flipped), b = sqCenter(uci.slice(2, 4), flipped);
    var dc = Math.abs(b.col - a.col), dr = Math.abs(b.row - a.row);
    var knight = (dc === 1 && dr === 2) || (dc === 2 && dr === 1);
    var pts = [[a.x, a.y]];
    if (knight) pts.push(dr === 2 ? [a.x, b.y] : [b.x, a.y]);
    pts.push([b.x, b.y]);
    var tip = pts[pts.length - 1], prev = pts[pts.length - 2];
    var dx = tip[0] - prev[0], dy = tip[1] - prev[1], len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    var base = [tip[0] - dx * headLen, tip[1] - dy * headLen];
    var tx = pts[1][0] - pts[0][0], ty = pts[1][1] - pts[0][1], tl = Math.hypot(tx, ty) || 1;
    pts[0] = [pts[0][0] + tx / tl * tail, pts[0][1] + ty / tl * tail];
    pts[pts.length - 1] = base;
    var px = -dy, py = dx;
    return {
      pts: pts,
      head: [tip, [base[0] + px * headHalf, base[1] + py * headHalf], [base[0] - px * headHalf, base[1] - py * headHalf]],
      to: b
    };
  }

  /* ---- engine result bookkeeping ----
     byDepth is the engine's raw info dump: { depth: { multipv: info } }.
     bestDepth  - deepest depth that holds as many lines as any depth does, so the arrows never mix depths
                  (this is the answer for a normal search that ran to its end).
     firstDepth - shallowest depth that already holds all `want` lines: the engine's first complete answer.
                  "Instant" (max time 0 / auto-play speed 0) uses this - there is no reason to wait for the
                  search to finish when a usable answer is already on the table. */
  function bestDepth(byDepth) {
    var ds = Object.keys(byDepth).map(Number), maxN = 0;
    ds.forEach(function (d) { maxN = Math.max(maxN, Object.keys(byDepth[d]).length); });
    if (!maxN) return null;
    var best = ds.filter(function (d) { return Object.keys(byDepth[d]).length === maxN; })
      .sort(function (x, y) { return y - x; })[0];
    return best === undefined ? null : best;
  }
  function firstDepth(byDepth, want) {
    var ds = Object.keys(byDepth).map(Number).sort(function (a, b) { return a - b; });
    for (var i = 0; i < ds.length; i++) if (Object.keys(byDepth[ds[i]]).length >= want) return ds[i];
    return null;
  }
  /* The depth an "instant" answer should be read from: the shallowest depth that already holds every requested
     line. When the engine has moved on to a deeper depth, the one below it is as complete as it will ever get -
     a forced position simply has fewer moves than MultiPV asked for - so that depth is used instead. */
  function instantDepth(byDepth, want) {
    var d = firstDepth(byDepth, want);
    if (d !== null) return d;
    var ds = Object.keys(byDepth).map(Number).sort(function (a, b) { return a - b; });
    if (ds.length < 2) return null;
    var prev = ds[ds.length - 2];
    return Object.keys(byDepth[prev]).length ? prev : null;
  }

  /* ---- what to ask the engine for ----
     opt = { depth, time, autoplay, speed, safetyMs }
       time 0          -> instant: no time cap, the first complete result is the answer and the search is stopped
       autoplay, speed 0 -> the same, because a move that is already known has no reason to wait for a deeper one
       autoplay, speed > 0 -> the search is capped at that many seconds, so moves come out at the chosen rhythm
     A search is never sent with neither a depth nor a time (a bare "go" would run forever). */
  function searchLimits(opt) {
    opt = opt || {};
    var instant = !(opt.time > 0);
    var depth = opt.depth || 0;
    var timeMs = instant ? 0 : Math.max(50, Math.round(opt.time * 1000));
    var eager = instant;
    if (opt.autoplay) {
      if (!(opt.speed > 0)) eager = true;
      else timeMs = timeMs ? Math.min(timeMs, Math.round(opt.speed * 1000)) : Math.round(opt.speed * 1000);
    }
    if (!depth && !timeMs) timeMs = opt.safetyMs > 0 ? opt.safetyMs : 2500;
    return { depth: depth, timeMs: timeMs, eager: eager };
  }
  function goCommand(lim) {
    return 'go' + (lim.depth ? ' depth ' + lim.depth : '') + (lim.timeMs ? ' movetime ' + lim.timeMs : '');
  }

  /* ---- auto-play pacing ----
     speedMs: how fast the tutor should play; elapsedMs: what the engine already spent on this position.
     Returns the extra wait before the move goes out, so a slow search is not slowed down twice and a fast one
     is not fired before its rhythm. speedMs 0 means "as soon as the engine has a move" - no wait at all. */
  function paceWait(speedMs, elapsedMs) {
    if (!(speedMs > 0)) return 0;
    return Math.max(0, Math.round(speedMs - (elapsedMs > 0 ? elapsedMs : 0)));
  }

  /* ---- ELO deviation (as specified) ----
     What a player of a given rating would pick out of the engine's candidate lines (best move first).
     rand is injectable so the unit tests can drive both branches deterministically. */
  var ERROR_RATES = { 400: 0.75, 600: 0.60, 800: 0.45, 1000: 0.30, 1200: 0.18, 1500: 0.10, 1800: 0.04, 2000: 0 };
  function eloMove(best, candidates, elo, rand) {
    var list = (candidates || []).filter(function (m) { return !!m; });
    if (!list.length) return best;
    var chance = ERROR_RATES[elo] || 0;
    rand = rand || Math.random;
    if (chance > 0 && rand() < chance) return list[Math.floor(rand() * list.length)] || best;
    return best;
  }

  /* ---- free-floating panel geometry ----
     The tutor panel is dragged like a normal window, except the screen edges do not stop it: push it through a
     wall and it keeps going until only a slim grab strip is left on screen; push it back and it is whole again.
     p = { x, y, w, h } panel box, v = { w, h } viewport, keep = px that must stay reachable.
     Returns:
       over   - px the panel hangs past each wall (l, r, t, b)
       hidden - the wall the panel is buried in, but only when more than `keep` px are outside it (so a reveal
                may slide it back out); null whenever the panel is on screen, which is what makes "push it back
                in and it is whole again" win over any reveal.
       strips - one grab strip per wall the panel pokes through, positioned to cover the part poking in. */
  function panelGeom(p, v, keep) {
    var over = {
      l: Math.max(0, -p.x), r: Math.max(0, p.x + p.w - v.w),
      t: Math.max(0, -p.y), b: Math.max(0, p.y + p.h - v.h)
    };
    var hidden = null, worst = keep;
    ['l', 'r', 't', 'b'].forEach(function (k) { if (over[k] > worst) { worst = over[k]; hidden = k; } });
    var strips = [];
    Object.keys(over).forEach(function (dir) {
      if (over[dir] <= 0.5) return;                    // half a pixel cannot be grabbed, ignore it
      var vertical = dir === 'l' || dir === 'r';
      var thin = Math.min(keep, vertical ? v.w : v.h);   // thickness, never more than the screen it sits on
      var long = vertical ? Math.min(p.h, v.h) : Math.min(p.w, v.w);
      var along = vertical ? clampStart(p.y, long, v.h) : clampStart(p.x, long, v.w);
      var rect = vertical
        ? { x: dir === 'l' ? 0 : Math.max(0, v.w - thin), y: along, w: thin, h: long }
        : { x: along, y: dir === 't' ? 0 : Math.max(0, v.h - thin), w: long, h: thin };
      strips.push({ dir: dir, rect: rect });
    });
    return { over: over, hidden: hidden, strips: strips };
  }
  // slide a window as long as the panel on that axis into the viewport, so a strip always stays on screen
  function clampStart(a, extent, len) { return Math.max(0, Math.min(a, Math.max(0, len - extent))); }

  function fmtCount(n) {
    if (n == null) return '?';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'G';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
    return String(n);
  }

  var api = { fenBoardMap: fenBoardMap, uciToSan: uciToSan, placementOf: placementOf, buildFen: buildFen, setTurn: setTurn,
    parseOption: parseOption, parseInfo: parseInfo, evalText: evalText, whitePct: whitePct, sqCenter: sqCenter,
    arrowShape: arrowShape, fmtCount: fmtCount, panelGeom: panelGeom,
    bestDepth: bestDepth, firstDepth: firstDepth, instantDepth: instantDepth, searchLimits: searchLimits,
    goCommand: goCommand, paceWait: paceWait, eloMove: eloMove, ERROR_RATES: ERROR_RATES };
  root.CTLib = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
