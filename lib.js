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

  /* ---- board tracing: what a move DOES to the position (pure) ----
     The aggressive Checkmate style needs to know more about a candidate move than its evaluation: does it give
     check, does it attack the enemy king, and does it leave a piece hanging on purpose (a bait). Everything in
     here works on the fenBoardMap piece map ('e4' -> 'N' white, 'e5' -> 'p' black), the same board the tutor
     already builds for SAN / arrows: no engine round trip and no legal-move generation - attacks are geometry
     plus blocking pieces, and a "bait" is a piece that is attacked and not defended after the move. Nothing here
     claims a move is LEGAL: the engine's candidate list decides what a candidate is (chooseMove) and chess.com's
     board decides what is playable (content.js). */
  var PIECE_WORTH = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  var fileOf = sq => sq.charCodeAt(0) - 97;
  var rankOf = sq => +sq[1] - 1;
  var sqName = (f, r) => 'abcdefgh'[f] + (r + 1);
  var onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
  var typeOf = pc => pc ? pc.toUpperCase() : '';              // 'N' and 'n' are both a knight
  var sideOf = pc => pc && pc === pc.toUpperCase() ? 'w' : 'b';   // a FEN piece: upper case is white
  var worthOf = pc => pc ? (PIECE_WORTH[typeOf(pc).toLowerCase()] || 0) : 0;

  // every square strictly between two squares that sit on one rank / file / diagonal (true when nothing is)
  function pathClear(pieces, from, to) {
    var df = Math.sign(fileOf(to) - fileOf(from)), dr = Math.sign(rankOf(to) - rankOf(from));
    var f = fileOf(from) + df, r = rankOf(from) + dr;
    while (onBoard(f, r) && sqName(f, r) !== to) {
      if (pieces[sqName(f, r)]) return false;
      f += df; r += dr;
    }
    return true;
  }

  /* Does the piece standing on `from` attack `to`? Occupancy of `to` is ignored (that is what makes it usable
     for a king's square in check detection), but a piece never attacks its own square. */
  function pieceAttacks(pieces, from, to) {
    var pc = pieces[from];
    if (!pc || from === to) return false;
    var type = typeOf(pc), white = sideOf(pc) === 'w';
    var df = fileOf(to) - fileOf(from), dr = rankOf(to) - rankOf(from);
    var adf = Math.abs(df), adr = Math.abs(dr);
    if (type === 'P') return adf === 1 && dr === (white ? 1 : -1);
    if (type === 'N') return (adf === 1 && adr === 2) || (adf === 2 && adr === 1);
    if (type === 'K') return adf <= 1 && adr <= 1;
    if (type === 'R') return (adf === 0 || adr === 0) && pathClear(pieces, from, to);
    if (type === 'B') return adf === adr && adf > 0 && pathClear(pieces, from, to);
    if (type === 'Q') return (adf === adr || adf === 0 || adr === 0) && pathClear(pieces, from, to);
    return false;
  }

  // is `sq` attacked by any piece of `side`? (a pawn attacks its diagonals, never the square in front of it)
  function attackedBy(pieces, sq, side) {
    for (var from in pieces) {
      if (sideOf(pieces[from]) === side && pieceAttacks(pieces, from, sq)) return true;
    }
    return false;
  }

  function kingSquare(pieces, side) {
    var want = side === 'w' ? 'K' : 'k';
    for (var sq in pieces) if (pieces[sq] === want) return sq;
    return null;
  }
  function sideInCheck(pieces, side) {
    var king = kingSquare(pieces, side);
    return !!king && attackedBy(pieces, king, side === 'w' ? 'b' : 'w');
  }
  // the enemy king's ring: the squares a mating net is built on (the king's own square is the check test)
  function kingRing(pieces, side) {
    var king = kingSquare(pieces, side);
    if (!king) return [];
    var kf = fileOf(king), kr = rankOf(king), out = [];
    for (var df = -1; df <= 1; df++) for (var dr = -1; dr <= 1; dr++) {
      if (!df && !dr) continue;
      if (onBoard(kf + df, kr + dr)) out.push(sqName(kf + df, kr + dr));
    }
    return out;
  }

  /* The position after `uci`, plus what was taken. Castling moves the rook too; en passant (when the FEN
     carries the target square) removes the pawn that is not standing on the destination. */
  function applyMove(pieces, uci, ep) {
    var from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci[4], pc = pieces[from];
    if (!pc) return null;
    var next = {};
    for (var k in pieces) next[k] = pieces[k];
    var captured = pieces[to] || null, capturedSq = captured ? to : null;
    if (typeOf(pc) === 'P' && !captured && !promo && from[0] !== to[0] && ep === to) {
      capturedSq = to[0] + from[1];
      captured = pieces[capturedSq] || null;
    }
    delete next[from];
    if (capturedSq) delete next[capturedSq];
    next[to] = promo ? (sideOf(pc) === 'w' ? promo.toUpperCase() : promo.toLowerCase()) : pc;
    if (typeOf(pc) === 'K' && Math.abs(fileOf(to) - fileOf(from)) === 2) {
      var rf = to[0] === 'g' ? 'h' : 'a', rt = to[0] === 'g' ? 'f' : 'd', rank = from[1];
      var rook = next[rf + rank];
      if (rook) { delete next[rf + rank]; next[rt + rank] = rook; }
    }
    return { pieces: next, captured: captured, capturedSq: capturedSq, promotion: promo ? promo.toLowerCase() : null };
  }

  /* Is a non-king piece of `side` currently attacked and undefended? This is a geometric trace, not a full
     legal-capture search: pinned attackers/defenders can make the label approximate, and the engine evaluation
     remains the safety check before the hunter can choose the move. */
  function isHanging(pieces, sq, side) {
    var pc = pieces[sq], other = side === 'w' ? 'b' : 'w';
    return !!pc && sideOf(pc) === side && typeOf(pc) !== 'K' &&
      attackedBy(pieces, sq, other) && !attackedBy(pieces, sq, side);
  }
  /* The most valuable piece of `side` that the opponent can take for free in a position. A king never counts. */
  function hangingValue(pieces, side) {
    var worst = 0;
    for (var sq in pieces) {
      if (!isHanging(pieces, sq, side)) continue;
      var worth = worthOf(pieces[sq]);
      if (worth > worst) worst = worth;
    }
    return worst;
  }
  /* The hunter should call a piece a bait only when this move newly leaves material en prise. Counting every
     hanging piece in the resulting position made an unrelated quiet move look like a bait whenever the position
     already contained a loose piece. */
  function newlyHangingValue(before, after, side) {
    var worst = 0;
    for (var sq in after) {
      if (!isHanging(after, sq, side)) continue;
      if (before[sq] === after[sq] && isHanging(before, sq, side)) continue;
      var worth = worthOf(after[sq]);
      if (worth > worst) worst = worth;
    }
    return worst;
  }
  // does `side` have a piece pointing at the enemy king or at the squares around it?
  function attacksKingRing(pieces, side) {
    var ring = kingRing(pieces, side === 'w' ? 'b' : 'w');
    for (var i = 0; i < ring.length; i++) {
      if (attackedBy(pieces, ring[i], side)) return true;
    }
    return false;
  }
  // Did this move create pressure on a previously unattacked square around the enemy king? Existing pressure
  // should not make every unrelated move look like an attack.
  function addsKingRingAttack(before, after, side) {
    var ring = kingRing(after, side === 'w' ? 'b' : 'w');
    for (var i = 0; i < ring.length; i++) {
      if (attackedBy(after, ring[i], side) && !attackedBy(before, ring[i], side)) return true;
    }
    return false;
  }

  /* What a candidate move is, in the terms the aggressive style decides on:
       check      - the opponent is in check after it
       bait       - material is offered: what the move wins is at least 2 points less than what it leaves
                    hanging (a knight en prise for nothing is a bait, an equal trade never is)
       kingAttack - the move points a piece at the enemy king or its ring (a mating net, check or not)
       capture / gain / loss - the raw material ledger, so the panel can say what was offered. */
  function moveTraits(fen, uci) {
    if (typeof fen !== 'string' || fen.indexOf('/') < 0) return null;     // no board, nothing to trace
    var parts = fen.split(' ');
    var pieces = fenBoardMap(fen), turn = parts[1] === 'b' ? 'b' : 'w';
    var them = turn === 'w' ? 'b' : 'w';
    if (!uci || uci.length < 4 || !pieces[uci.slice(0, 2)]) return null;
    if (pieces[uci.slice(2, 4)] && sideOf(pieces[uci.slice(2, 4)]) === turn) return null;   // own piece there
    var mv = applyMove(pieces, uci, parts[3] && parts[3] !== '-' ? parts[3] : null);
    if (!mv) return null;
    var gain = worthOf(mv.captured) + (mv.promotion ? worthOf(mv.promotion) - 1 : 0);
    var loss = newlyHangingValue(pieces, mv.pieces, turn);
    return {
      check: sideInCheck(mv.pieces, them), bait: loss >= 2 && loss - gain >= 1,
      kingAttack: addsKingRingAttack(pieces, mv.pieces, turn), capture: !!mv.captured,
      gain: gain, loss: loss, piece: typeOf(pieces[uci.slice(0, 2)])
    };
  }

  function parseOption(line) {
    var m = /^option name (.+?) type (\w+)(?: default (\S*))?(?: min (-?\d+))?(?: max (-?\d+))?/.exec(line);
    if (!m) return null;
    return { name: m[1], type: m[2], def: m[3], min: m[4] === undefined ? null : +m[4], max: m[5] === undefined ? null : +m[5] };
  }

  function parseInfo(line) {
    if (line.indexOf('info') !== 0 || line.indexOf(' pv ') < 0 || / (lower|upper)bound/.test(line)) return null;
    var d = /depth (\d+)/.exec(line), mp = /multipv (\d+)/.exec(line);
    var sc = /score (cp|mate) ([+-]?\d+)/.exec(line), pv = / pv (.+)$/.exec(line);
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
                  "Instant" (Think time 0) uses this - there is no reason to wait for the search to finish when
                  a usable answer is already on the table. */
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

  /* A UCI `score mate +N` is a mate for the side to move, and lower positive values are sooner.  MultiPV
     normally ranks this correctly already, but selecting it explicitly keeps auto-play's mate-first policy
     stable even if candidate lines arrive in a different order. Returns the original line, or null when no
     engine-verified winning mate is present. */
  function fastestMateLine(lines) {
    var best = null;
    (lines || []).forEach(function (line) {
      if (!line || !line.move || line.type !== 'mate' || !(line.score > 0)) return;
      if (!best || line.score < best.score ||
        (line.score === best.score && (line.depth || 0) > (best.depth || 0))) best = line;
    });
    return best;
  }

  /* ---- what to ask the engine for ----
     opt = { depth, time, autoplay, speed, safetyMs }
       time   -> the think time, in seconds: how long the engine gets to think before it answers *or* plays.
                 Any level, 400 ELO or full engine, is given this whole window - the search is deliberately not
                 cut short by the strength depth, otherwise "think 5s at 800 ELO" would be over in ~30ms.
       time 0 -> first-complete-result mode: stop after a usable answer rather than waiting on a clock.
       depth  -> the strength target (from the ELO preset). When a think time is set it does not cap the search;
                 it becomes `playDepth`, the depth the reported / played lines are taken from. With no think
                 time it is also the search cap, since there is no clock to fill.
       `autoplay` / `speed` are retained for configurations saved by releases before 1.4, where speed also
       constrained the search. The current auto-play path omits both.
     A search is never sent with neither a depth nor a time (a bare "go" would run forever). */
  function searchLimits(opt) {
    opt = opt || {};
    var instant = !(opt.time > 0);
    var target = opt.depth || 0;                                  // 0 = no strength cap: play the deepest line
    var timeMs = instant ? 0 : Math.max(50, Math.round(opt.time * 1000));
    var eager = instant;
    var depth = instant ? target : 0;                             // a think time owns the clock, not the depth
    if (opt.autoplay) {
      // legacy: speed 0 meant "dispatch the first answer", so the ELO depth was the only limit
      if (!(opt.speed > 0)) { eager = true; if (!instant) depth = target; }
      else {
        timeMs = timeMs ? Math.min(timeMs, Math.round(opt.speed * 1000)) : Math.round(opt.speed * 1000);
        depth = 0;
      }
    }
    if (!depth && !timeMs) timeMs = opt.safetyMs > 0 ? opt.safetyMs : 2500;
    return { depth: depth, timeMs: timeMs, eager: eager, playDepth: target };
  }

  /* ---- which depth to answer from ----
     The engine searched as long as the think time allowed and logged every iteration. `targetDepth` is the
     strength cap from the ELO level: the answer is the deepest complete iteration at or below it, so a lower
     level really does play its own (shallower) move even after thinking for the full window. Without a target,
     the deepest complete iteration is the answer. */
  function reportDepth(byDepth, targetDepth) {
    var ds = Object.keys(byDepth).map(Number).sort(function (a, b) { return a - b; });
    if (!ds.length) return null;
    if (!(targetDepth > 0)) return bestDepth(byDepth);
    var within = ds.filter(function (d) { return d <= targetDepth; });
    if (!within.length) return ds[0];                 // never reached the cap: the first iteration is the best it has
    var maxN = 0;
    within.forEach(function (d) { maxN = Math.max(maxN, Object.keys(byDepth[d]).length); });
    if (!maxN) return bestDepth(byDepth);
    var full = within.filter(function (d) { return Object.keys(byDepth[d]).length === maxN; });
    return full[full.length - 1];                     // deepest complete one at or below the cap
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
     What a player of a given rating would pick out of the engine's candidate lines (best move first). The error
     rate is the chance of an actual deviation, so when that roll fires the best move is excluded from the draw.
     rand is injectable so the unit tests can drive both branches deterministically. */
  var ERROR_RATES = { 400: 0.75, 600: 0.60, 800: 0.45, 1000: 0.30, 1200: 0.18, 1500: 0.10, 1800: 0.04, 2000: 0 };
  function eloMove(best, candidates, elo, rand) {
    var list = (candidates || []).filter(function (m) { return !!m; });
    if (!list.length) return best;
    var alternatives = list.filter(function (m) { return m !== best; });
    var chance = ERROR_RATES[elo] || 0;
    rand = rand || Math.random;
    if (alternatives.length && chance > 0 && rand() < chance) {
      var choice = Math.floor(rand() * alternatives.length);
      return alternatives[Math.max(0, Math.min(alternatives.length - 1, choice))] || best;
    }
    return best;
  }

  /* ---- the aggressive hunter ----
     `aggressive` Checkmate style (mateMode 'hunter'): every proven mate is still taken first - including one that
     only the deepest iteration of the search found, which is what `huntPool` exists for - and when there is no
     mate, the move is chosen for pressure: checks first, then baits (a piece offered), then moves that attack the
     enemy king. The engine's own evaluation is the guard rail: a hunter only ever picks a move from inside
     `risk` of the best line it can see, so it attacks with sound moves instead of hanging a queen to look brave. */
  var HUNT_RISK = { sound: 30, balanced: 60, very: 120 };   // centipawns the aggressive pick may give up
  function huntTolerance(risk, bestValue) {
    var tol = HUNT_RISK[risk];
    if (!(tol > 0)) tol = HUNT_RISK.balanced;
    // already clearly winning (+2.5 or more): a flashy attack costs less than it looks, so widen the net a bit
    return bestValue >= 250 ? Math.round(tol * 2) : tol;
  }
  // mate scores are ranked above everything, and a sooner mate beats a later one
  function lineValue(line) {
    if (!line) return -Infinity;
    if (line.type === 'mate') return line.score > 0 ? 100000 - line.score : -100000 + Math.abs(line.score);
    return line.score;
  }
  // what the aggressive pick is worth, in points of pressure: check > bait > attack on the king > capture
  function aggressionScore(t) {
    if (!t) return 0;
    return (t.continuation || 0) + (t.check ? 10 : 0) + (t.bait ? 8 : 0) + (t.kingAttack ? 4 : 0) + (t.capture || t.gain ? 2 : 0);
  }
  // Trace up to five of our moves in the engine's best-defence continuation.
  // This rewards sustained pressure, not a promise the opponent will accept a trap.
  function continuationPressure(fen, line) {
    if (!fen || !line.pv || line.pv[0] !== line.move) return 0;
    var parts = fen.split(' '), board = fenBoardMap(fen), us = parts[1] === 'b' ? 'b' : 'w';
    var ep = parts[3], pressure = 0;
    for (var i = 0; i < Math.min(10, line.pv.length); i++) {
      var move = line.pv[i], pc = board[move.slice(0, 2)];
      var side = i % 2 ? (us === 'w' ? 'b' : 'w') : us;
      if (!pc || sideOf(pc) !== side) break;
      var next = applyMove(board, move, ep);
      if (!next || sideInCheck(next.pieces, side)) break;
      board = next.pieces;
      ep = typeOf(pc) === 'P' && Math.abs(+move[1] - +move[3]) === 2
        ? move[0] + ((+move[1] + +move[3]) / 2) : null;
      if (i > 0 && i % 2 === 0) {
        var enemy = us === 'w' ? 'b' : 'w';
        pressure += (sideInCheck(board, enemy) ? 5 : attacksKingRing(board, us) ? 2 : 0);
      }
    }
    return Math.min(16, pressure);
  }
  // "check + bait (9 pts offered)" - the panel says what the hunter saw, so the move is not a mystery
  function huntNote(t) {
    if (!t) return '';
    var bits = [];
    if (t.check) bits.push('check');
    if (t.continuation) bits.push('continued pressure vs best defence');
    if (t.bait) bits.push('bait' + (t.loss ? ' (' + t.loss + ' pts offered)' : ''));
    else if (t.capture) bits.push(t.gain ? 'wins material' : 'capture');
    if (t.kingAttack && !t.check) bits.push('attack on the king');
    return bits.join(' + ');
  }
  /* One candidate list out of two: the level's own depth first (line 1 of it stays the reference for "the
     engine's best move"), then the deepest iteration the think time reached. A move that appears in both keeps
     the better-informed line - see deeperLine - which is what lets a 400 ELO hunter play a mate that only the
     long search proved, and gives the aggression pick more than a handful of candidates. */
  function huntPool(lines, deepLines, cap) {
    var out = [], at = {}, max = cap || 24;
    [lines, deepLines].forEach(function (arr) {
      (arr || []).forEach(function (l) {
        if (!l || !l.move) return;
        var seen = at[l.move];
        if (seen !== undefined) { out[seen] = deeperLine(out[seen], l); return; }
        if (out.length >= max) return;
        at[l.move] = out.length; out.push(l);
      });
    });
    return out;
  }
  // the same move seen twice: the deeper line carries the better information, and a proven mate is never
  // dropped in favour of a deeper line that only has a centipawn score
  function deeperLine(a, b) {
    if (a.type === 'mate' && a.score > 0) return a;
    if (b.type === 'mate' && b.score > 0) return b;
    return (b.depth || 0) > (a.depth || 0) ? b : a;
  }
  function huntPick(list, fen, opt) {
    var extraMates = Array.isArray(opt && opt.mateLines) ? opt.mateLines : [];
    var mate = fastestMateLine(list.concat(extraMates));
    if (mate) return { uci: mate.move, line: mate, mate: mate, hunt: moveTraits(fen, mate.move), mistake: false };
    // The pool may combine the level's lines with lines from the deepest iteration. Do not let an optimistic
    // shallow score define the risk budget for deeper candidates: use the best evaluation at the deepest depth seen.
    var best = null, bestDepth = -Infinity;
    list.forEach(function (l) {
      var depth = l.depth || 0;
      if (depth > bestDepth || (depth === bestDepth && (!best || lineValue(l) > lineValue(best)))) {
        best = l; bestDepth = depth;
      }
    });
    var floor = lineValue(best) - huntTolerance(opt && opt.huntRisk, lineValue(best));
    var pick = null;
    list.forEach(function (l) {
      var t = moveTraits(fen, l.move);
      if (t) t.continuation = continuationPressure(fen, l);
      var score = aggressionScore(t);
      if (!score || lineValue(l) < floor) return;               // unsound, or nothing aggressive about it
      if (!pick || score > pick.score || (score === pick.score && lineValue(l) > lineValue(pick.line))) {
        pick = { line: l, traits: t, score: score };
      }
    });
    if (!pick) return { uci: list[0].move, line: list[0], mate: null, hunt: moveTraits(fen, list[0].move), mistake: false };
    return { uci: pick.line.move, line: pick.line, mate: null, hunt: pick.traits, mistake: false };
  }

  /* ---- which move to actually play (auto-play and "what would X play?") ----
     lines - the engine's candidate lines for the position, best first (normally the strength-capped depth)
     opt   - { elo, mistakes, mateMode, rand, fen, huntRisk, mateLines }
       mateLines                   : optional positive mate proofs collected from every reported search depth.
                                     They are used only by mate-seeking styles; they never enter the ELO slip draw.
       mateMode 'shortest' (default): a proven mate outranks everything, and among proven mates the smallest
                 positive mate score - the fewest moves - is played. If no mate is proven, the selected-depth
                 top line (or a natural slip when enabled) is used.
       mateMode 'normal'            : regular play, the top line of the search, no mate hunting.
       mateMode 'hunter'            : aggressive. The fewest-move mate is taken first (from all mate proofs); with
                 no mate, the most aggressive sound candidate is played - check, bait, then attack on the king - as
                 long as its evaluation stays within `huntRisk` of the best line. Needs `fen` to see the board;
                 without it the hunter behaves like 'shortest'.
       mistakes on                  : the ELO deviation roll may swap the top line for another candidate, which
                                      is what makes 400-1500 look like a person instead of a machine.
       mistakes off                 : disables that random deviation; search depth and mate style still apply.
     A proven mate is never traded away for a random slip. A hunter is never overruled by that roll either - it is a
     deliberate style, not an accident. Returns { uci, line, mate, mistake, hunt } or null when nothing is legal. */
  function chooseMove(lines, opt) {
    opt = opt || {};
    var list = (lines || []).filter(function (l) { return l && l.move; });
    if (!list.length) return null;
    var mateLines = list.concat(Array.isArray(opt.mateLines) ? opt.mateLines : []);
    if (opt.mateMode === 'hunter') {
      if (opt.fen) return huntPick(list, opt.fen, opt);
      var huntMate = fastestMateLine(mateLines);
      if (huntMate) return { uci: huntMate.move, line: huntMate, mate: huntMate, hunt: null, mistake: false };
    }
    if (opt.mateMode !== 'normal') {
      var mate = fastestMateLine(mateLines);
      if (mate) return { uci: mate.move, line: mate, mate: mate, hunt: null, mistake: false };
    }
    var best = list[0];
    if (opt.mistakes) {
      var moves = list.map(function (l) { return l.move; });
      var picked = eloMove(best.move, moves, opt.elo, opt.rand);
      if (picked && picked !== best.move) {
        var alt = list.filter(function (l) { return l.move === picked; })[0] || best;
        return { uci: picked, line: alt, mate: null, hunt: null, mistake: true };
      }
    }
    return { uci: best.move, line: best, mate: null, hunt: null, mistake: false };
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
    bestDepth: bestDepth, firstDepth: firstDepth, instantDepth: instantDepth, fastestMateLine: fastestMateLine, searchLimits: searchLimits,
    reportDepth: reportDepth, chooseMove: chooseMove,
    goCommand: goCommand, paceWait: paceWait, eloMove: eloMove, ERROR_RATES: ERROR_RATES,
    pieceAttacks: pieceAttacks, attackedBy: attackedBy, sideInCheck: sideInCheck, applyMove: applyMove,
    continuationPressure: continuationPressure, hangingValue: hangingValue, moveTraits: moveTraits, aggressionScore: aggressionScore, huntNote: huntNote,
    huntPool: huntPool, huntPick: huntPick, huntTolerance: huntTolerance, lineValue: lineValue,
    deeperLine: deeperLine, HUNT_RISK: HUNT_RISK };
  root.CTLib = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
