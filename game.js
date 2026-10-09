/* Chess Tutor - game context (pure: no DOM, no chrome.*). Shared by content.js and the node tests.

   Three things a FEN alone cannot give the engine, and that Maximum Strength needs to play a real game:

   1. MOVE HISTORY. A FEN describes one position, not how the game got there, so Stockfish cannot see that a move
      repeats a position for the third time (a draw it should take when losing and avoid when winning). The
      tracker below rebuilds the actual move list from successive board snapshots - every new position must be
      reachable from the previous one by one or two LEGAL moves, or it is a takeback / a new game - and turns it
      into `position startpos moves ...`. The history says whether it is complete for repetition purposes:
      either it starts at the initial position, or its oldest position lies at/before the last irreversible move
      (capture or pawn move, i.e. the halfmove clock), since no earlier position can ever recur.

   2. CLOCKS. Both remaining times, the increment and the side whose clock is running are read separately and
      cross-checked; a measured safety reserve (display resolution + observed move-submission latency) is taken
      off the mover's clock and Stockfish's own time manager allocates the rest. Anything uncertain is an
      explicit fallback with a reason, never a guess.

   3. PONDERING. Whether a ponder search may run, which position it is for, and whether the reply that arrived
      is the one that was predicted (ponderhit) or not (stop + discard).

   The move generator is standard chess only (no Chess960 castling). A position it cannot connect by legal moves
   simply starts a new, explicitly incomplete history - it never invents moves. */
(function (root) {
  'use strict';

  var START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  var FILES = 'abcdefgh';

  // ---------- board state ----------
  // b[sq] with sq = rank * 8 + file (a1 = 0, h8 = 63); pieces are FEN letters, upper case = white.
  function parseFen(fen) {
    if (typeof fen !== 'string') return null;
    var p = fen.trim().split(/\s+/);
    if (p.length < 2) return null;
    var rows = p[0].split('/');
    if (rows.length !== 8) return null;
    var b = new Array(64).fill('');
    for (var i = 0; i < 8; i++) {
      var f = 0, r = 7 - i;
      for (var k = 0; k < rows[i].length; k++) {
        var ch = rows[i][k];
        if (/[1-8]/.test(ch)) f += +ch;
        else if (/[pnbrqkPNBRQK]/.test(ch)) { if (f > 7) return null; b[r * 8 + f] = ch; f++; }
        else return null;
      }
      if (f !== 8) return null;
    }
    if (p[1] !== 'w' && p[1] !== 'b') return null;
    var castling = p[2] && p[2] !== '-' ? p[2].replace(/[^KQkq]/g, '') : '';
    var ep = p[3] && /^[a-h][36]$/.test(p[3]) ? p[3] : null;
    var half = /^\d+$/.test(p[4] || '') ? +p[4] : 0;
    var full = /^\d+$/.test(p[5] || '') && +p[5] > 0 ? +p[5] : 1;
    return { b: b, turn: p[1], castling: castling, ep: ep, half: half, full: full,
      halfKnown: /^\d+$/.test(p[4] || '') };
  }
  function placement(b) {
    var rows = [];
    for (var r = 7; r >= 0; r--) {
      var row = '', empty = 0;
      for (var f = 0; f < 8; f++) {
        var pc = b[r * 8 + f];
        if (!pc) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += pc;
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return rows.join('/');
  }
  function castleStr(c) {
    var s = '';
    ['K', 'Q', 'k', 'q'].forEach(function (x) { if (c.indexOf(x) >= 0) s += x; });
    return s || '-';
  }
  function toFen(st) {
    return placement(st.b) + ' ' + st.turn + ' ' + castleStr(st.castling) + ' ' + (st.ep || '-') + ' ' + st.half + ' ' + st.full;
  }
  var sqName = function (sq) { return FILES[sq & 7] + ((sq >> 3) + 1); };
  var sqIndex = function (n) { return (n.charCodeAt(1) - 49) * 8 + (n.charCodeAt(0) - 97); };
  var isWhite = function (pc) { return pc && pc === pc.toUpperCase(); };
  var colorOf = function (pc) { return pc ? (isWhite(pc) ? 'w' : 'b') : null; };

  var KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  var KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  var ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  // Is `sq` attacked by `side`? (pure geometry + blockers: exactly what legality needs)
  function attacked(b, sq, side) {
    var f = sq & 7, r = sq >> 3, i, nf, nr, pc;
    var up = side === 'w' ? -1 : 1;                       // a white pawn attacks from the rank below
    for (i = -1; i <= 1; i += 2) {
      nf = f + i; nr = r + up;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8 && b[nr * 8 + nf] === (side === 'w' ? 'P' : 'p')) return true;
    }
    for (i = 0; i < 8; i++) {
      nf = f + KNIGHT[i][0]; nr = r + KNIGHT[i][1];
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8 && b[nr * 8 + nf] === (side === 'w' ? 'N' : 'n')) return true;
      nf = f + KING[i][0]; nr = r + KING[i][1];
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8 && b[nr * 8 + nf] === (side === 'w' ? 'K' : 'k')) return true;
    }
    var rays = [[ROOK, 'R', 'Q'], [BISHOP, 'B', 'Q']];
    for (var t = 0; t < 2; t++) {
      var dirs = rays[t][0];
      var a = side === 'w' ? rays[t][1] : rays[t][1].toLowerCase(), q = side === 'w' ? 'Q' : 'q';
      for (i = 0; i < 4; i++) {
        nf = f + dirs[i][0]; nr = r + dirs[i][1];
        while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
          pc = b[nr * 8 + nf];
          if (pc) { if (pc === a || pc === q) return true; break; }
          nf += dirs[i][0]; nr += dirs[i][1];
        }
      }
    }
    return false;
  }
  function kingSq(b, side) {
    var k = side === 'w' ? 'K' : 'k';
    for (var i = 0; i < 64; i++) if (b[i] === k) return i;
    return -1;
  }
  function inCheck(st, side) {
    var k = kingSq(st.b, side || st.turn);
    return k >= 0 && attacked(st.b, k, (side || st.turn) === 'w' ? 'b' : 'w');
  }

  function pseudoMoves(st) {
    var out = [], b = st.b, side = st.turn, them = side === 'w' ? 'b' : 'w';
    function add(from, to, promo) { out.push({ from: from, to: to, promo: promo || null }); }
    for (var sq = 0; sq < 64; sq++) {
      var pc = b[sq];
      if (!pc || colorOf(pc) !== side) continue;
      var f = sq & 7, r = sq >> 3, type = pc.toUpperCase(), i, nf, nr, to;
      if (type === 'P') {
        var dir = side === 'w' ? 1 : -1, startR = side === 'w' ? 1 : 6, lastR = side === 'w' ? 7 : 0;
        var pushes = function (from, dest) {
          if ((dest >> 3) === lastR) ['q', 'r', 'b', 'n'].forEach(function (p) { add(from, dest, p); });
          else add(from, dest);
        };
        nr = r + dir;
        if (nr >= 0 && nr < 8) {
          to = nr * 8 + f;
          if (!b[to]) {
            pushes(sq, to);
            if (r === startR && !b[(r + 2 * dir) * 8 + f]) add(sq, (r + 2 * dir) * 8 + f);
          }
          for (i = -1; i <= 1; i += 2) {
            nf = f + i;
            if (nf < 0 || nf > 7) continue;
            to = nr * 8 + nf;
            if (b[to] && colorOf(b[to]) === them) pushes(sq, to);
            else if (st.ep && sqName(to) === st.ep && !b[to]) add(sq, to);
          }
        }
      } else if (type === 'N' || type === 'K') {
        var steps = type === 'N' ? KNIGHT : KING;
        for (i = 0; i < 8; i++) {
          nf = f + steps[i][0]; nr = r + steps[i][1];
          if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
          to = nr * 8 + nf;
          if (!b[to] || colorOf(b[to]) === them) add(sq, to);
        }
        if (type === 'K') {
          var home = side === 'w' ? 4 : 60, rk = side === 'w' ? 'R' : 'r';
          var ks = side === 'w' ? 'K' : 'k', qs = side === 'w' ? 'Q' : 'q';
          if (sq === home && !attacked(b, home, them)) {
            if (st.castling.indexOf(ks) >= 0 && b[home + 3] === rk && !b[home + 1] && !b[home + 2] &&
              !attacked(b, home + 1, them) && !attacked(b, home + 2, them)) add(home, home + 2);
            if (st.castling.indexOf(qs) >= 0 && b[home - 4] === rk && !b[home - 1] && !b[home - 2] && !b[home - 3] &&
              !attacked(b, home - 1, them) && !attacked(b, home - 2, them)) add(home, home - 2);
          }
        }
      } else {
        var rays = type === 'R' ? ROOK : type === 'B' ? BISHOP : ROOK.concat(BISHOP);
        for (i = 0; i < rays.length; i++) {
          nf = f + rays[i][0]; nr = r + rays[i][1];
          while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
            to = nr * 8 + nf;
            if (b[to]) { if (colorOf(b[to]) === them) add(sq, to); break; }
            add(sq, to);
            nf += rays[i][0]; nr += rays[i][1];
          }
        }
      }
    }
    return out;
  }

  // The position after a (pseudo-legal) move, with castling rights, en passant, halfmove and fullmove updated.
  function makeMove(st, m) {
    var b = st.b.slice(), pc = b[m.from], type = pc.toUpperCase(), side = st.turn;
    var capture = !!b[m.to];
    if (type === 'P' && st.ep && sqName(m.to) === st.ep && (m.from & 7) !== (m.to & 7) && !b[m.to]) {
      b[m.to + (side === 'w' ? -8 : 8)] = '';
      capture = true;
    }
    b[m.to] = m.promo ? (side === 'w' ? m.promo.toUpperCase() : m.promo.toLowerCase()) : pc;
    b[m.from] = '';
    if (type === 'K' && Math.abs(m.to - m.from) === 2) {
      var rookFrom = m.to > m.from ? m.from + 3 : m.from - 4, rookTo = m.to > m.from ? m.from + 1 : m.from - 1;
      b[rookTo] = b[rookFrom]; b[rookFrom] = '';
    }
    var c = st.castling;
    var strip = function (chars) { for (var i = 0; i < chars.length; i++) c = c.replace(chars[i], ''); };
    if (type === 'K') strip(side === 'w' ? 'KQ' : 'kq');
    [[0, 'Q'], [7, 'K'], [56, 'q'], [63, 'k']].forEach(function (x) { if (m.from === x[0] || m.to === x[0]) strip(x[1]); });
    var ep = null;
    if (type === 'P' && Math.abs(m.to - m.from) === 16) ep = sqName((m.from + m.to) >> 1);
    return { b: b, turn: side === 'w' ? 'b' : 'w', castling: c, ep: ep,
      half: type === 'P' || capture ? 0 : st.half + 1, full: st.full + (side === 'b' ? 1 : 0), halfKnown: st.halfKnown };
  }
  function uciOf(m) { return sqName(m.from) + sqName(m.to) + (m.promo || ''); }

  function legalMoveObjs(st) {
    return pseudoMoves(st).filter(function (m) { return !inCheck(makeMove(st, m), st.turn); });
  }
  function legalMoves(fen) {
    var st = typeof fen === 'string' ? parseFen(fen) : fen;
    return st ? legalMoveObjs(st).map(uciOf) : [];
  }
  // A legal UCI move applied to a FEN -> the new FEN, or null when the move is not legal there.
  function playUci(fen, uci) {
    var st = typeof fen === 'string' ? parseFen(fen) : fen;
    if (!st || typeof uci !== 'string') return null;
    var hit = legalMoveObjs(st).filter(function (m) { return uciOf(m) === uci.toLowerCase(); })[0];
    return hit ? toFen(makeMove(st, hit)) : null;
  }
  function perft(fen, depth) {
    var st = typeof fen === 'string' ? parseFen(fen) : fen;
    if (depth === 0) return 1;
    var n = 0, ms = legalMoveObjs(st);
    if (depth === 1) return ms.length;
    for (var i = 0; i < ms.length; i++) n += perft(makeMove(st, ms[i]), depth - 1);
    return n;
  }
  // SAN for a legal move (used only to match a board's move list, so check marks are optional on input)
  function sanOf(st, m, legal) {
    var pc = st.b[m.from], type = pc.toUpperCase();
    if (type === 'K' && Math.abs(m.to - m.from) === 2) return m.to > m.from ? 'O-O' : 'O-O-O';
    var capture = !!st.b[m.to] || (type === 'P' && (m.from & 7) !== (m.to & 7));
    var s = '';
    if (type === 'P') s = (capture ? FILES[m.from & 7] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
    else {
      var rivals = (legal || legalMoveObjs(st)).filter(function (o) {
        return o.to === m.to && o.from !== m.from && st.b[o.from] === pc;
      });
      var dis = '';
      if (rivals.length) {
        var sameFile = rivals.some(function (o) { return (o.from & 7) === (m.from & 7); });
        var sameRank = rivals.some(function (o) { return (o.from >> 3) === (m.from >> 3); });
        dis = !sameFile ? FILES[m.from & 7] : !sameRank ? String((m.from >> 3) + 1) : sqName(m.from);
      }
      s = type + dis + (capture ? 'x' : '') + sqName(m.to);
    }
    return s;
  }
  var cleanSan = function (s) { return String(s).replace(/[+#!?]+$/g, '').replace(/^0-0-0$/, 'O-O-O').replace(/^0-0$/, 'O-O').replace(/e\.?p\.?$/i, '').trim(); };

  /* One entry of a board's move list -> a legal UCI move in `st`, or null. Accepts UCI strings, SAN strings and
     { from, to, promotion } / { san } objects - only so a board's own list can be CHECKED by replaying it. */
  function resolveMove(st, mv) {
    var legal = legalMoveObjs(st);
    var byUci = function (u) {
      u = String(u || '').toLowerCase();
      var exact = legal.filter(function (m) { return uciOf(m) === u; })[0];
      if (exact) return exact;
      // a move list may omit the promotion piece of a queen promotion - only accept when it is unambiguous
      if (/^[a-h][1-8][a-h][1-8]$/.test(u)) {
        var promos = legal.filter(function (m) { return uciOf(m).slice(0, 4) === u; });
        return promos.length === 1 ? promos[0] : null;   // several promotion pieces and none named: refuse
      }
      return null;
    };
    if (mv && typeof mv === 'object') {
      if (typeof mv.from === 'string' && typeof mv.to === 'string') {
        var u = mv.from + mv.to + (mv.promotion ? String(mv.promotion).toLowerCase()[0] : '');
        var hit = byUci(u);
        if (hit) return hit;
      }
      if (typeof mv.san === 'string') mv = mv.san;
      else return null;
    }
    if (typeof mv !== 'string') return null;
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(mv)) { var x = byUci(mv); if (x) return x; }
    var want = cleanSan(mv);
    var bySan = legal.filter(function (m) { return sanOf(st, m, legal) === want; });
    return bySan.length === 1 ? bySan[0] : null;
  }

  // ---------- positions as the repetition rule sees them ----------
  // En passant only counts when a capture is actually legal (FIDE 9.2 / what Stockfish hashes), so a board that
  // writes the ep square after every double push and one that writes it only when capturable agree.
  function effectiveEp(st) {
    if (!st.ep) return '-';
    var to = sqIndex(st.ep);
    var ok = legalMoveObjs(st).some(function (m) {
      return m.to === to && st.b[m.from].toUpperCase() === 'P' && (m.from & 7) !== (m.to & 7);
    });
    return ok ? st.ep : '-';
  }
  function positionKey(fen) {
    var st = typeof fen === 'string' ? parseFen(fen) : fen;
    if (!st) return null;
    return placement(st.b) + ' ' + st.turn + ' ' + castleStr(st.castling) + ' ' + effectiveEp(st);
  }
  /* Does a position we DERIVED (by applying legal moves) match what the board shows? Placement and side to move
     always; castling rights and en passant too when the board's own FEN reported them ('board'). A DOM-only
     snapshot guesses castling and has no ep, so those fields are not compared for it. */
  function matchesObserved(derived, observed, src) {
    var a = parseFen(derived), o = parseFen(observed);
    if (!a || !o) return false;
    if (placement(a.b) !== placement(o.b) || a.turn !== o.turn) return false;
    if (src !== 'board') return true;
    return castleStr(a.castling) === castleStr(o.castling) && effectiveEp(a) === effectiveEp(o);
  }
  function isStartPosition(fen) { return positionKey(fen) === positionKey(START_FEN); }

  // ---------- the move-history tracker ----------
  /* h = { root, rootSrc, moves: [uci], fens: [fen after each ply, fens[0] = root], complete, source, resets }
     Every field is rebuilt (never mutated) so a snapshot handed to a search cannot change underneath it. */
  function finish(h) {
    var cur = parseFen(h.fens[h.fens.length - 1]);
    var startRoot = isStartPosition(h.root) && parseFen(h.root).half === 0;
    // Complete for repetition purposes when the oldest position we have is at/before the last irreversible
    // move: the current halfmove clock counts the plies since then, and they are all in the list.
    var trustedClock = h.rootSrc === 'board' || h.rootSrc === 'replay';
    h.complete = !!(startRoot || (trustedClock && cur && (h.fens.length - 1) - cur.half >= 0));
    h.plies = h.moves.length;
    return h;
  }
  function newHistory(fen, src, resets, source) {
    var st = parseFen(fen);
    if (!st) return null;
    var norm = toFen(st);
    return finish({ root: norm, rootSrc: src || 'board', moves: [], fens: [norm], source: source || 'observed',
      resets: resets || 0 });
  }
  function extend(h, moves) {
    var fens = h.fens.slice(), ms = h.moves.slice();
    moves.forEach(function (x) { ms.push(x.uci); fens.push(x.fen); });
    return finish({ root: h.root, rootSrc: h.rootSrc, moves: ms, fens: fens, source: h.source, resets: h.resets });
  }
  /* Advance the history to a newly observed board position.
     Returns { h, change } with change one of:
       'same'   - nothing moved
       'move'   - one legal move connects the positions (the normal case, including a repetition)
       'moves2' - two plies landed between snapshots (e.g. an instant premove reply)
       'back'   - the board returned to an earlier position of this game that is NOT one move away (takeback /
                  stepping back through an analysis board): the history is truncated there
       'reset'  - not connected: a new game, a jump, or an unreadable step. A fresh, honest history starts. */
  function advanceHistory(h, fen, src) {
    var st = parseFen(fen);
    if (!st) return { h: h, change: 'invalid' };
    if (!h) return { h: newHistory(fen, src), change: 'reset' };
    var last = h.fens[h.fens.length - 1];
    if (matchesObserved(last, fen, src)) return { h: h, change: 'same' };
    var lastSt = parseFen(last);
    var first = legalMoveObjs(lastSt), i, j;
    // A repetition IS reachable by one move, so the forward search runs before the takeback check.
    for (i = 0; i < first.length; i++) {
      var s1 = makeMove(lastSt, first[i]), f1 = toFen(s1);
      if (matchesObserved(f1, fen, src)) return { h: extend(h, [{ uci: uciOf(first[i]), fen: f1 }]), change: 'move' };
    }
    var twoPly = [];
    for (i = 0; i < first.length && twoPly.length < 2; i++) {
      var a = makeMove(lastSt, first[i]);
      if (placement(a.b) === placement(st.b)) continue;
      var second = legalMoveObjs(a);
      for (j = 0; j < second.length; j++) {
        var f2 = toFen(makeMove(a, second[j]));
        if (matchesObserved(f2, fen, src)) {
          twoPly.push([{ uci: uciOf(first[i]), fen: toFen(a) }, { uci: uciOf(second[j]), fen: f2 }]);
          if (twoPly.length > 1) break;
        }
      }
    }
    // Two different two-ply routes to the same position (transposition): the order matters for repetition
    // bookkeeping only through the intermediate position, so ambiguity is not guessed at.
    if (twoPly.length === 1) return { h: extend(h, twoPly[0]), change: 'moves2' };
    for (i = h.fens.length - 2; i >= 0; i--) {
      if (matchesObserved(h.fens[i], fen, src)) {
        return { h: finish({ root: h.root, rootSrc: h.rootSrc, moves: h.moves.slice(0, i), fens: h.fens.slice(0, i + 1),
          source: h.source, resets: h.resets }), change: 'back' };
      }
    }
    return { h: newHistory(fen, src, (h.resets || 0) + 1), change: 'reset' };
  }
  /* A board's own move list, accepted only if replaying it from its start position reaches EXACTLY the
     position the board shows now. Anything that does not replay is ignored (returns null). */
  function historyFromMoves(startFen, moves, currentFen) {
    if (!Array.isArray(moves) || moves.length > 2000) return null;
    var st = parseFen(startFen || START_FEN);
    if (!st) return null;
    var h = { root: toFen(st), rootSrc: startFen ? 'replay' : 'replay', moves: [], fens: [toFen(st)], source: 'board list', resets: 0 };
    for (var i = 0; i < moves.length; i++) {
      var m = resolveMove(st, moves[i]);
      if (!m) return null;
      st = makeMove(st, m);
      h.moves.push(uciOf(m)); h.fens.push(toFen(st));
    }
    if (!matchesObserved(h.fens[h.fens.length - 1], currentFen, 'board')) return null;
    return finish(h);
  }

  /* The UCI `position` command for a history: the initial position plus every move when the game started there,
     otherwise the earliest known FEN plus every move since. Only if that would not fit the transport (16 KB per
     native message / command) is it shortened - losslessly - to start at the last irreversible move, which is
     as far back as Stockfish's repetition detection ever looks. `extra` appends moves (a ponder guess). */
  var MAX_POSITION_CMD = 15000;
  function positionCommand(h, extra, maxLen) {
    if (!h) return null;
    var moves = h.moves.concat(extra || []), rootFen = h.root, limit = maxLen || MAX_POSITION_CMD;
    var build = function (rf, ms) {
      var base = isStartPosition(rf) && parseFen(rf).half === 0 && parseFen(rf).full === 1 ? 'position startpos' : 'position fen ' + rf;
      return base + (ms.length ? ' moves ' + ms.join(' ') : '');
    };
    var cmd = build(rootFen, moves);
    if (cmd.length <= limit) return cmd;
    for (var k = h.fens.length - 1; k > 0; k--) {
      if (parseFen(h.fens[k]).half === 0) {
        cmd = build(h.fens[k], moves.slice(k));
        return cmd.length <= limit ? cmd : null;
      }
    }
    return null;
  }
  // "42 plies from the start position · repetition-aware" - what the panel tells the user about the history
  function historyLabel(h) {
    if (!h) return 'no move history';
    var from = isStartPosition(h.root) ? 'from the start position' : 'from a mid-game position';
    var src = h.source === 'board list' ? ' (board move list, verified by replay)' : '';
    return h.plies + ' pl' + (h.plies === 1 ? 'y' : 'ies') + ' ' + from + src + ' \u00B7 ' +
      (h.complete ? 'repetition-aware' : 'repetitions before the first seen position unknown');
  }

  // ---------- clocks ----------
  function clockMs(text) {
    var m = String(text).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (!m || +m[3] >= 60 || (m[1] && +m[2] >= 60)) return null;
    return ((+(m[1] || 0) * 3600 + +m[2] * 60 + +m[3]) * 1000) + +(m[4] || '').padEnd(3, '0');
  }
  // how coarse a clock reading is: "4:59" is whole seconds, "0:09.4" tenths
  function clockResolution(text) {
    var m = String(text).trim().match(/\.(\d{1,3})$/);
    return m ? Math.pow(10, 3 - m[1].length) : 1000;
  }
  // PGN TimeControl tag (seconds): "180+2", "600", "-", "?", "1/86400" (daily) -> { baseMs, incMs } or null
  function parsePgnTimeControl(tc) {
    var m = String(tc || '').trim().match(/^(\d+(?:\.\d+)?)(?:\+(\d+(?:\.\d+)?))?$/);
    if (!m) return null;
    return { baseMs: Math.round(+m[1] * 1000), incMs: Math.round(+(m[2] || 0) * 1000) };
  }
  // A site's time-control label (minutes): "3 | 2", "3+2", "10 min", "1 min", "30 sec", "15 | 10"
  function parseTimeControlLabel(text) {
    var t = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
    var m = t.match(/^(\d+(?:\.\d+)?) ?(?:min)? ?[|+] ?(\d+)(?: ?(?:s|sec))?$/);
    if (m) return { baseMs: Math.round(+m[1] * 60000), incMs: +m[2] * 1000 };
    m = t.match(/^(\d+(?:\.\d+)?) ?min$/);
    if (m) return { baseMs: Math.round(+m[1] * 60000), incMs: 0 };
    m = t.match(/^(\d+) ?sec$/);
    if (m) return { baseMs: +m[1] * 1000, incMs: 0 };
    return null;
  }
  /* Which clock is running: exactly one clock flagged active by the page, otherwise the one clock that went
     down between two readings taken shortly apart while the other did not move. null = cannot tell. */
  function activeClock(sample, prev) {
    if (!sample) return null;
    if (sample.whiteActive !== sample.blackActive) return sample.whiteActive ? 'w' : 'b';
    if (sample.whiteActive && sample.blackActive) return null;
    if (!prev || !(sample.ts - prev.ts > 0) || sample.ts - prev.ts > 5000) return null;
    var dw = prev.white - sample.white, db = prev.black - sample.black;
    if (dw > 0 && db === 0) return 'w';
    if (db > 0 && dw === 0) return 'b';
    return null;
  }
  /* Increment, from what the page declares and what the clocks were seen to do.
       declared: [{ source, incMs }]   e.g. the game's PGN TimeControl tag, the time-control label
       observed: [{ estMs, tolMs }]    own clock after a move minus before it, plus the time spent
     Two declared values that disagree, or a declared value contradicted by two observations, make the
     increment UNKNOWN (incMs null). Without a declaration, three tight observations agreeing on the same whole
     second are accepted. Unknown is not guessed: the caller then treats it as zero, the conservative bound. */
  function resolveIncrement(declared, observed) {
    declared = (declared || []).filter(function (d) { return d && Number.isFinite(d.incMs) && d.incMs >= 0; });
    observed = (observed || []).filter(function (o) { return o && Number.isFinite(o.estMs) && Number.isFinite(o.tolMs); });
    var vals = declared.map(function (d) { return d.incMs; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    if (vals.length > 1) return { incMs: null, source: null, note: 'time-control sources disagree (' + declared.map(function (d) { return d.source + ' +' + d.incMs / 1000 + 's'; }).join(', ') + ')' };
    if (vals.length === 1) {
      var d = vals[0];
      var against = observed.filter(function (o) { return Math.abs(o.estMs - d) > o.tolMs; });
      if (against.length >= 2) return { incMs: null, source: null, note: 'clock jumps contradict the declared +' + d / 1000 + 's' };
      var agree = observed.length - against.length;
      return { incMs: d, source: declared[0].source, note: '+' + d / 1000 + 's (' + declared[0].source + (agree ? ', ' + agree + ' observed' : '') + ')' };
    }
    var tight = observed.filter(function (o) { return o.tolMs <= 400; });
    if (tight.length >= 3) {
      var secs = tight.map(function (o) { return Math.round(o.estMs / 1000); });
      if (secs.every(function (s) { return s === secs[0] && s >= 0; })) return { incMs: secs[0] * 1000, source: 'observed', note: '+' + secs[0] + 's (observed ' + tight.length + 'x)' };
    }
    return { incMs: null, source: null, note: 'increment unknown' };
  }
  /* The safety reserve kept back from the mover's clock: how stale the display can be (its resolution) plus the
     move-submission latency that was actually measured (bestmove -> the board accepted the move), with headroom.
     Before anything is measured a fixed 500 ms stands in, and says so. */
  function safetyReserve(latencies, resolutionMs) {
    var recent = (latencies || []).filter(function (x) { return Number.isFinite(x) && x >= 0; }).slice(-8);
    var lat = recent.length ? Math.min(5000, Math.max(250, Math.ceil(Math.max.apply(null, recent) * 1.5) + 100)) : 500;
    return { ms: lat + (Number.isFinite(resolutionMs) ? resolutionMs : 1000), latencyMs: lat, measured: recent.length > 0,
      samples: recent.length };
  }
  /* The Maximum Strength search limits.
       opt.time       Think time (seconds) - the fallback, never less than one second
       opt.clocks     { white, black, whiteRes, blackRes, whiteActive, blackActive, ts, error } (one reading)
       opt.prev       the previous reading (to see which clock ticks, if the page does not flag it)
       opt.mover      side to move in the position being searched ('w' / 'b')
       opt.expectActive  whose clock must be running now: the mover normally, the OPPONENT when pondering
       opt.increment  resolveIncrement() result
       opt.latencies  measured submission latencies (ms)
       opt.now        current time, for the age of the reading
       opt.ponder     build a `go ponder` search
     Returns { maximum, timeMs, clocks?, ponder?, clockNote, clockOk }. */
  function clockLimits(opt) {
    opt = opt || {};
    var lim = { maximum: true, depth: 0, playDepth: 0, eager: false, timeMs: Math.max(1000, Math.round((opt.time || 0) * 1000)) };
    var fall = function (why) {
      lim.clockOk = false;
      lim.clockNote = 'Think time ' + (lim.timeMs / 1000) + 's (clock fallback: ' + why + ')';
      return lim;
    };
    var c = opt.clocks;
    if (!c) return fall('no clock reading');
    if (c.error) return fall(c.error);
    if (![c.white, c.black].every(function (n) { return Number.isFinite(n) && n >= 0; })) return fall('clock unreadable');
    if (c.white === 0 || c.black === 0) return fall('a clock shows 0:00');
    var active = activeClock(c, opt.prev);
    if (!active) return fall('cannot tell whose clock is running');
    if (active !== (opt.expectActive || opt.mover)) return fall('running clock (' + active + ') does not match the side to move');
    var age = Math.max(0, (opt.now || c.ts || 0) - (c.ts || 0));
    var moverRes = opt.mover === 'w' ? c.whiteRes : c.blackRes;
    var reserve = safetyReserve(opt.latencies, moverRes);
    var t = { w: c.white, b: c.black };
    t[active] -= age;                                         // the running clock kept running since the read
    t[opt.mover] -= reserve.ms;
    var inc = opt.increment && Number.isFinite(opt.increment.incMs) ? opt.increment.incMs : null;
    lim.timeMs = 0;
    lim.clockOk = true;
    lim.clocks = { white: Math.max(1, Math.round(t.w)), black: Math.max(1, Math.round(t.b)), winc: inc || 0, binc: inc || 0 };
    lim.reserve = reserve;
    lim.incKnown = inc !== null;
    if (opt.ponder) lim.ponder = true;
    lim.clockNote = 'Stockfish time manager, reserve ' + reserve.ms + ' ms (' +
      (reserve.measured ? 'measured latency ' + reserve.latencyMs + ' ms over ' + reserve.samples + ' moves' : 'latency not measured yet') +
      ' + display ' + (moverRes || 1000) + ' ms) \u00B7 increment ' +
      (inc !== null ? opt.increment.note : ((opt.increment && opt.increment.note) || 'unknown') + ' \u2192 0 (conservative)');
    return lim;
  }
  function goCommand(lim) {
    if (lim.clocks) {
      return 'go' + (lim.ponder ? ' ponder' : '') + ' wtime ' + Math.round(lim.clocks.white) + ' btime ' + Math.round(lim.clocks.black) +
        ' winc ' + Math.round(lim.clocks.winc || 0) + ' binc ' + Math.round(lim.clocks.binc || 0);
    }
    return 'go' + (lim.ponder ? ' ponder' : '') + (lim.depth ? ' depth ' + lim.depth : '') + (lim.timeMs ? ' movetime ' + lim.timeMs : '');
  }

  // ---------- pondering ----------
  /* May a ponder search run? Every condition is explicit and the first one that fails is the reason shown.
     ctx = { enabled, maximum, autoplay, native, hostAllows, engineOption, historyComplete, clocksOk } */
  function ponderGate(ctx) {
    ctx = ctx || {};
    if (!ctx.enabled) return { ok: false, reason: 'pondering off' };
    if (!ctx.maximum) return { ok: false, reason: 'Maximum Strength only' };
    if (!ctx.autoplay) return { ok: false, reason: 'auto-play is off' };
    if (!ctx.native) return { ok: false, reason: 'needs the native backend' };
    if (!ctx.hostAllows) return { ok: false, reason: 'native host does not allow it (install with --allow-ponder)' };
    if (!ctx.engineOption) return { ok: false, reason: 'engine has no Ponder option' };
    if (!ctx.historyComplete) return { ok: false, reason: 'move history incomplete' };
    if (!ctx.clocksOk) return { ok: false, reason: 'clock data uncertain' };
    return { ok: true, reason: '' };
  }
  /* The move to ponder on: the engine's own `bestmove ... ponder X`, else the second move of the final PV.
     It must be legal after our move, or there is nothing to ponder. */
  function ponderMove(fenAfterOurMove, fromBestmove, pv) {
    var cand = fromBestmove || (Array.isArray(pv) && pv.length > 1 ? pv[1] : null);
    return cand && playUci(fenAfterOurMove, cand) ? cand : null;
  }

  var api = { START_FEN: START_FEN, parseFen: parseFen, toFen: toFen, legalMoves: legalMoves, playUci: playUci,
    perft: perft, resolveMove: resolveMove, positionKey: positionKey, matchesObserved: matchesObserved,
    isStartPosition: isStartPosition, newHistory: newHistory, advanceHistory: advanceHistory,
    historyFromMoves: historyFromMoves, positionCommand: positionCommand, historyLabel: historyLabel,
    MAX_POSITION_CMD: MAX_POSITION_CMD, inCheck: function (fen) { var s = parseFen(fen); return !!s && inCheck(s); },
    sanOf: function (fen, uci) {
      var st = parseFen(fen); if (!st) return null;
      var legal = legalMoveObjs(st), m = legal.filter(function (x) { return uciOf(x) === uci; })[0];
      return m ? sanOf(st, m, legal) : null;
    },
    clockMs: clockMs, clockResolution: clockResolution, parsePgnTimeControl: parsePgnTimeControl,
    parseTimeControlLabel: parseTimeControlLabel, activeClock: activeClock, resolveIncrement: resolveIncrement,
    safetyReserve: safetyReserve, clockLimits: clockLimits, goCommand: goCommand,
    ponderGate: ponderGate, ponderMove: ponderMove };
  root.CTGame = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
