/* Chess Tutor - TROLL MODE (pure logic: no DOM, no chrome.*). Shared by content.js and the node tests.

   Everything here is a joke layer that sits ON TOP of the engine and never inside it. Three families:

   1. DIRECTIVES - "one dumb rule, played completely sincerely". Each one filters the legal move list down to
      the moves that obey a single deranged constraint, and the move is then picked from what survives. The
      default is to play the BEST move that obeys, because a pawn storm that pushes the best pawn is a character,
      while a random pawn push is just noise.

   2. RAGE - adaptive griefing. Not a rule but a gate: when you are winning on the board AND have at least as
      much time as the opponent, the play style switches from "win fast" to "win annoyingly" and picks from a
      bag of denial tactics. Board alone is not enough: being annoying takes time, so the clock decides.

   3. COMMENTARY / PRANKS - text and panel tricks that troll the user and nobody else. Every taunt in this file
      is rendered in the user's own panel; nothing here talks to an opponent, and nothing here hides what the
      extension is doing.

   A directive that has no legal move left (no pawns to push, no dark squares to reach) is SUSPENDED for that
   move: the engine's real move is played and the panel says so. The breakdown is the joke, so it is announced
   rather than swallowed. */
(function (root) {
  'use strict';

  var FILES = 'abcdefgh';

  // ---------- square helpers (algebraic names, the same dialect lib.js speaks) ----------
  function fileOf(sq) { return sq.charCodeAt(0) - 97; }          // a -> 0
  function rankOf(sq) { return sq.charCodeAt(1) - 49; }          // 1 -> 0
  function sqAt(f, r) { return FILES[f] + (r + 1); }
  function onBoard(f, r) { return f >= 0 && f < 8 && r >= 0 && r < 8; }
  function cheb(a, b) { return Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b))); }
  // a1 is a dark square: (file + rank) even -> dark
  function isDark(sq) { return (fileOf(sq) + rankOf(sq)) % 2 === 0; }
  function isLight(sq) { return !isDark(sq); }
  // how far a square is up the board FOR THE GIVEN SIDE (0 = own back rank, 7 = promotion rank)
  function advanceOf(sq, side) { var r = rankOf(sq) + 1; return side === 'w' ? r : 9 - r; }
  function ownHalf(sq, side) { return advanceOf(sq, side) <= 4; }
  function enemyHalf(sq, side) { return advanceOf(sq, side) >= 5; }
  function backRank(side) { return side === 'w' ? 1 : 8; }
  function promoRank(side) { return side === 'w' ? 8 : 1; }
  function rankNum(sq) { return rankOf(sq) + 1; }
  function quadrantOf(sq) {
    var f = fileOf(sq), r = rankOf(sq);
    if (f <= 3 && r <= 3) return 0;
    if (f >= 4 && r <= 3) return 1;
    if (f >= 4 && r >= 4) return 2;
    return 3;
  }
  var WORTH = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  function worthOf(pc) { return pc ? (WORTH[pc.toLowerCase()] || 0) : 0; }
  function typeOf(pc) { return pc ? pc.toUpperCase() : ''; }
  function sideOfPc(pc) { return pc ? (pc === pc.toUpperCase() ? 'w' : 'b') : null; }
  function other(side) { return side === 'w' ? 'b' : 'w'; }

  var G = function () { return root.CTGame; };
  var L = function () { return root.CTLib; };

  function infoOf(uci, pieces) {
    var from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci[4] || null;
    var pc = pieces[from] || '';
    return {
      uci: uci, from: from, to: to, promo: promo, piece: pc, type: typeOf(pc), side: sideOfPc(pc),
      df: fileOf(to) - fileOf(from), dr: rankOf(to) - rankOf(from),
      adf: Math.abs(fileOf(to) - fileOf(from)), adr: Math.abs(rankOf(to) - rankOf(from)),
      isPawn: typeOf(pc) === 'P', isKing: typeOf(pc) === 'K', isKnight: typeOf(pc) === 'N',
      isBishop: typeOf(pc) === 'B', isQueen: typeOf(pc) === 'Q',
      capture: !!pieces[to],
      straight: fileOf(to) === fileOf(from) || rankOf(to) === rankOf(from),
      diagonal: Math.abs(fileOf(to) - fileOf(from)) === Math.abs(rankOf(to) - rankOf(from)),
      castle: typeOf(pc) === 'K' && Math.abs(fileOf(to) - fileOf(from)) === 2
    };
  }

  /* One move's working context. `state` is a plain object the caller keeps between moves: directives that
     need to remember something (which file the monorail runs on, how far the queen's tour has got) keep it
     there, so the module itself stays pure and testable. */
  function makeContext(fen, opts) {
    opts = opts || {};
    var g = G(), l = L();
    if (!g || !l) return null;
    var st = g.parseFen(fen);
    if (!st) return null;
    var side = st.turn === 'w' ? 'w' : 'b';
    var pieces = l.fenBoardMap(fen);
    var moves = g.legalMoves(fen) || [];
    var infos = moves.map(function (u) { return infoOf(u, pieces); });
    var byUci = {};
    infos.forEach(function (i) { byUci[i.uci] = i; });
    var lines = opts.lines || [];
    var lineScore = {};
    lines.forEach(function (ln) { if (ln && ln.move) lineScore[ln.move] = l.lineValue(ln); });
    var afterCache = {}, replyCache = {};

    var ctx = {
      fen: fen, st: st, pieces: pieces, side: side, opp: other(side),
      moves: moves, infos: infos, byUci: byUci, lines: lines, ep: st.ep,
      state: opts.state || {}, rng: opts.rand || Math.random,
      oppLastUci: opts.oppLastUci || null,
      ply: (st.full - 1) * 2 + (side === 'b' ? 1 : 0),
      inCheck: !!g.inCheck && g.inCheck(fen)
    };
    ctx.info = function (u) { return byUci[u] || infoOf(u, pieces); };
    ctx.after = function (u) {
      if (afterCache[u]) return afterCache[u];
      var f = g.playUci(fen, u);
      var out = f ? { fen: f, pieces: l.fenBoardMap(f), st: g.parseFen(f) } : null;
      afterCache[u] = out;
      return out;
    };
    ctx.replies = function (u) {
      if (replyCache[u] != null) return replyCache[u];
      var a = ctx.after(u);
      var n = a ? (g.legalMoves(a.fen) || []).length : 0;
      replyCache[u] = n;
      return n;
    };
    // does this move give check? (the side to move in the resulting position is the opponent)
    ctx.checks = function (u) { var a = ctx.after(u); return !!(a && g.inCheck(a.fen)); };
    /* Would the opponent be able to mate us immediately after this move? "In check" is not mate, so a reply
       that leaves us in check but with an escape is fine - only a check with no legal answer counts. The
       legal-move list is only generated for replies that actually give check, which is rare, so this stays
       cheap enough to run across a whole move list. */
    ctx.allowsMateIn1 = function (u) {
      var a = ctx.after(u);
      if (!a) return false;
      var theirs = g.legalMoves(a.fen) || [];
      for (var i = 0; i < theirs.length; i++) {
        var f2 = g.playUci(a.fen, theirs[i]);
        if (f2 && g.inCheck(f2) && !(g.legalMoves(f2) || []).length) return true;
      }
      return false;
    };
    ctx.hangingAfter = function (u) {
      var a = ctx.after(u);
      if (!a) return 0;
      return l.newlyHangingValue(pieces, a.pieces, side) || 0;
    };
    ctx.attackedAfter = function (u, sq) {
      var a = ctx.after(u);
      return !!(a && l.attackedBy(a.pieces, sq, ctx.opp));
    };
    ctx.defendedAfter = function (u, sq) {
      var a = ctx.after(u);
      return !!(a && l.attackedBy(a.pieces, sq, side));
    };
    ctx.enemyPiecesAfter = function (u) {
      var a = ctx.after(u), out = [];
      if (!a) return out;
      for (var sq in a.pieces) if (sideOfPc(a.pieces[sq]) === ctx.opp) out.push(sq);
      return out;
    };
    ctx.ownPiecesAfter = function (u) {
      var a = ctx.after(u), out = [];
      if (!a) return out;
      for (var sq in a.pieces) if (sideOfPc(a.pieces[sq]) === side) out.push(sq);
      return out;
    };
    ctx.kingSq = function (piecesIn, who) {
      var want = (who || side) === 'w' ? 'K' : 'k';
      for (var sq in piecesIn) if (piecesIn[sq] === want) return sq;
      return null;
    };
    ctx.enemyKing = function () { return ctx.kingSq(pieces, ctx.opp); };
    // engine value of a move, from OUR point of view at the moment of choosing (higher = better for us)
    ctx.scoreOf = function (u) {
      var v = lineScore[u];
      return v == null ? null : v;
    };
    return ctx;
  }

  // ---------- ranking ----------
  // 'best' (default) plays the strongest move that obeys the rule - a sincere maniac, not a random one.
  function rankMoves(ctx, list, mode) {
    var out = list.slice();
    var sc = function (u) { var v = ctx.scoreOf(u); return v == null ? null : v; };
    if (mode === 'random') {
      for (var i = out.length - 1; i > 0; i--) {
        var j = Math.floor(ctx.rng() * (i + 1)), t = out[i]; out[i] = out[j]; out[j] = t;
      }
      return out;
    }
    var dir = mode === 'worst' ? 1 : -1;
    out.sort(function (a, b) {
      var va = sc(a), vb = sc(b);
      if (va == null && vb == null) return a < b ? -1 : a > b ? 1 : 0;
      if (va == null) return 1;                 // unranked moves go last in 'best', first in 'worst'
      if (vb == null) return -1;
      if (va !== vb) return dir * (va - vb);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return out;
  }

  // =====================================================================================
  //  1. DIRECTIVES - one dumb rule, played sincerely
  // =====================================================================================
  // Each entry: { id, name, group, blurb, filter(ctx) -> uci[], rank?(ctx, list) -> uci[] }
  // A filter returning [] means "the rule has no legal move here" -> SUSPENDED for one move.

  var DIRECTIVES = [
    // ---------------- pawn family ----------------
    {
      id: 'pawn-storm', name: 'Pawn storm', group: 'pawn',
      blurb: 'push a pawn every move, any pawn',
      filter: function (c) { return c.infos.filter(function (m) { return m.isPawn; }).map(function (m) { return m.uci; }); }
    },
    {
      id: 'rook-pawn-rampage', name: 'Rook pawn rampage', group: 'pawn',
      blurb: 'only the a- and h-pawns may move; everything else is furniture',
      filter: function (c) {
        return c.infos.filter(function (m) { return m.isPawn && (m.from[0] === 'a' || m.from[0] === 'h'); })
          .map(function (m) { return m.uci; });
      }
    },
    {
      id: 'pawn-pacifism', name: 'Pawn pacifism', group: 'pawn',
      blurb: 'never move a pawn; win without a single pawn move',
      filter: function (c) { return c.infos.filter(function (m) { return !m.isPawn; }).map(function (m) { return m.uci; }); }
    },
    {
      id: 'great-wall', name: 'The Great Wall', group: 'pawn',
      blurb: 'no pawn passes the 3rd rank; shuffle behind it forever',
      filter: function (c) {
        return c.infos.filter(function (m) { return !m.isPawn || advanceOf(m.to, c.side) <= 3; })
          .map(function (m) { return m.uci; });
      }
    },
    {
      id: 'phalanx', name: 'Phalanx', group: 'pawn',
      blurb: 'only a pawn standing beside another pawn may move - safety in numbers',
      filter: function (c) {
        return c.infos.filter(function (m) {
          if (!m.isPawn) return false;
          var f = fileOf(m.from), r = rankOf(m.from);
          var a = onBoard(f - 1, r) && typeOf(c.pieces[sqAt(f - 1, r)]) === 'P';
          var b = onBoard(f + 1, r) && typeOf(c.pieces[sqAt(f + 1, r)]) === 'P';
          return a || b;
        }).map(function (m) { return m.uci; });
      }
    },
    {
      id: 'leapfrog', name: 'Leapfrog', group: 'pawn',
      blurb: 'only ever the most backward pawn; relentlessly, one at a time',
      filter: function (c) {
        var pawns = c.infos.filter(function (m) { return m.isPawn; });
        if (!pawns.length) return [];
        var worst = Math.min.apply(null, pawns.map(function (m) { return advanceOf(m.from, c.side); }));
        return pawns.filter(function (m) { return advanceOf(m.from, c.side) === worst; })
          .map(function (m) { return m.uci; });
      }
    },

    // ---------------- geometry ----------------
    {
      id: 'dark-square', name: 'Dark-square devotion', group: 'geometry',
      blurb: 'only ever land on dark squares; pieces born wrong freeze permanently',
      filter: function (c) { return c.infos.filter(function (m) { return isDark(m.to); }).map(function (m) { return m.uci; }); }
    },
    {
      id: 'light-square', name: 'Light-square devotion', group: 'geometry',
      blurb: 'only ever land on light squares',
      filter: function (c) { return c.infos.filter(function (m) { return isLight(m.to); }).map(function (m) { return m.uci; }); }
    },
    {
      id: 'homebody', name: 'Homebody', group: 'geometry',
      blurb: 'never cross the midline; defend a country you were never attacked in',
      filter: function (c) {
        return c.infos.filter(function (m) { return ownHalf(m.from, c.side) && ownHalf(m.to, c.side); })
          .map(function (m) { return m.uci; });
      }
    },
    {
      id: 'monorail', name: 'Monorail', group: 'geometry',
      blurb: 'one file, chosen at random; every move stays inside it',
      filter: function (c) {
        if (c.state.file == null) {
          var counts = [0, 0, 0, 0, 0, 0, 0, 0], best = 0;
          for (var sq in c.pieces) if (sideOfPc(c.pieces[sq]) === c.side) counts[fileOf(sq)]++;
          for (var i = 1; i < 8; i++) if (counts[i] > counts[best]) best = i;
          c.state.file = best;
        }
        var f = c.state.file;
        return c.infos.filter(function (m) { return fileOf(m.from) === f && fileOf(m.to) === f; })
          .map(function (m) { return m.uci; });
      }
    },
    {
      id: 'elevator', name: 'Elevator', group: 'geometry',
      blurb: 'no diagonals ever; ranks and files only, bishops are decorative',
      filter: function (c) {
        return c.infos.filter(function (m) { return !m.isKnight && m.straight; }).map(function (m) { return m.uci; });
      }
    },
    {
      id: 'diagonal-zealot', name: 'Diagonal zealot', group: 'geometry',
      blurb: 'no straight lines ever; rooks are decorative',
      filter: function (c) {
        return c.infos.filter(function (m) { return !m.isKnight && m.diagonal; }).map(function (m) { return m.uci; });
      }
    },
    {
      id: 'bank-rank', name: 'Bank rank', group: 'geometry',
      blurb: 'nothing leaves the back rank until there is literally nothing else',
      filter: function (c) {
        var br = backRank(c.side);
        var home = c.infos.filter(function (m) { return rankNum(m.from) === br; });
        return (home.length ? home : c.infos).map(function (m) { return m.uci; });
      }
    },
    {
      id: 'corner-office', name: 'Corner office', group: 'geometry',
      blurb: 'every move gets closer to a distant corner, as the crow flies',
      filter: function (c) {
        if (!c.state.corner) {
          var corners = c.side === 'w' ? ['a8', 'h1'] : ['a1', 'h8'];
          c.state.corner = corners[Math.floor(c.rng() * corners.length) % corners.length];
        }
        var target = c.state.corner;
        var before = {};
        c.infos.forEach(function (m) { before[m.uci] = cheb(m.from, target); });
        var best = Math.min.apply(null, c.infos.map(function (m) { return cheb(m.to, target); }));
        return c.infos.filter(function (m) { return cheb(m.to, target) <= Math.max(best, before[m.uci] - 1); })
          .map(function (m) { return m.uci; });
      }
    },
    {
      id: 'checkerboard', name: 'Checkerboard', group: 'geometry',
      blurb: 'only pieces standing on light squares may move',
      filter: function (c) { return c.infos.filter(function (m) { return isLight(m.from); }).map(function (m) { return m.uci; }); }
    },

    // ---------------- relationships ----------------
    {
      id: 'leash-law', name: 'Leash law', group: 'relations',
      blurb: 'never end a move without a friendly piece adjacent; nobody goes anywhere alone',
      filter: function (c) {
        return c.moves.filter(function (u) {
          var m = c.info(u), friends = c.ownPiecesAfter(u);
          return friends.some(function (sq) { return sq !== m.to && cheb(sq, m.to) <= 1; });
        });
      }
    },
    {
      id: 'social-distancing', name: 'Social distancing', group: 'relations',
      blurb: 'never end a move beside a friendly piece; maximum personal space',
      filter: function (c) {
        return c.moves.filter(function (u) {
          var m = c.info(u), friends = c.ownPiecesAfter(u);
          return !friends.some(function (sq) { return sq !== m.to && cheb(sq, m.to) <= 1; });
        });
      }
    },
    {
      id: 'wingman', name: 'Wingman', group: 'relations',
      blurb: 'every move lands next to the queen; she is never alone',
      filter: function (c) {
        var q = null;
        for (var sq in c.pieces) if (c.pieces[sq] === (c.side === 'w' ? 'Q' : 'q')) { q = sq; break; }
        if (!q) return [];
        return c.moves.filter(function (u) {
          var m = c.info(u);
          if (m.piece === (c.side === 'w' ? 'Q' : 'q')) return true;
          var friends = c.ownPiecesAfter(u);
          return friends.some(function (s) { return s !== m.to && s !== m.from && cheb(s, m.to) <= 1 &&
            c.pieces[s] === (c.side === 'w' ? 'Q' : 'q'); });
        });
      }
    },
    {
      id: 'tag-team', name: 'Tag team', group: 'relations',
      blurb: 'two pieces, chosen at random; you alternate between them, strictly, forever',
      filter: function (c) {
        if (!c.state.pair || !Array.isArray(c.state.pair)) {
          var froms = [];
          c.infos.forEach(function (m) { if (froms.indexOf(m.from) < 0) froms.push(m.from); });
          if (froms.length < 2) return c.moves.slice();
          var a = froms[Math.floor(c.rng() * froms.length)];
          var rest = froms.filter(function (f) { return f !== a; });
          c.state.pair = [a, rest[Math.floor(c.rng() * rest.length)]];
          c.state.turn = 0;
        }
        var want = c.state.pair[(c.state.turn || 0) % 2];
        var hit = c.infos.filter(function (m) { return m.from === want; }).map(function (m) { return m.uci; });
        return hit.length ? hit : c.moves.slice();
      }
    },
    {
      id: 'monkey-see', name: 'Monkey see, monkey do', group: 'relations',
      blurb: 'mirror the opponent\'s last move onto your side whenever it is legal',
      filter: function (c) {
        if (!c.oppLastUci || c.oppLastUci.length < 4) return [];
        var f = c.oppLastUci[0], r = c.oppLastUci[1], tf = c.oppLastUci[2], tr = c.oppLastUci[3];
        var mirror = f + String(9 - (+r)) + tf + String(9 - (+tr)) + (c.oppLastUci[4] || '');
        var hit = c.infos.filter(function (m) { return m.uci === mirror; }).map(function (m) { return m.uci; });
        if (hit.length) return hit;
        // same shape, anywhere: a mirrored move by any piece of ours
        var df = tf.charCodeAt(0) - f.charCodeAt(0), dr = (+tr) - (+r), mdr = -dr;
        return c.infos.filter(function (m) {
          return (m.to.charCodeAt(0) - m.from.charCodeAt(0)) === df &&
            (rankOf(m.to) - rankOf(m.from)) === mdr;
        }).map(function (m) { return m.uci; });
      }
    },

    // ---------------- personality ----------------
    {
      id: 'berserker', name: 'Berserker', group: 'personality',
      blurb: 'if a capture exists, take it; any capture, it does not matter which',
      filter: function (c) {
        var caps = c.infos.filter(function (m) { return m.capture; });
        return (caps.length ? caps : c.infos).map(function (m) { return m.uci; });
      }
    },
    {
      id: 'pacifist', name: 'Pacifist', group: 'personality',
      blurb: 'never capture, not even a free queen, not even mate-adjacent',
      filter: function (c) { return c.infos.filter(function (m) { return !m.capture; }).map(function (m) { return m.uci; }); }
    },
    {
      id: 'check-junkie', name: 'Check junkie', group: 'personality',
      blurb: 'give check every single move if it is physically possible',
      filter: function (c) {
        var ch = c.moves.filter(function (u) { return c.checks(u); });
        return ch.length ? ch : c.moves.slice();
      }
    },
    {
      id: 'full-retreat', name: 'Full retreat', group: 'personality',
      blurb: 'only move pieces backwards',
      filter: function (c) {
        return c.infos.filter(function (m) { return advanceOf(m.to, c.side) < advanceOf(m.from, c.side); })
          .map(function (m) { return m.uci; });
      }
    },
    {
      id: 'all-gas', name: 'All gas, no brakes', group: 'personality',
      blurb: 'always move the most advanced piece further forward',
      filter: function (c) {
        var top = Math.max.apply(null, c.infos.map(function (m) { return advanceOf(m.from, c.side); }));
        var movers = c.infos.filter(function (m) { return advanceOf(m.from, c.side) === top; });
        var fwd = movers.filter(function (m) { return advanceOf(m.to, c.side) > advanceOf(m.from, c.side); });
        return (fwd.length ? fwd : movers).map(function (m) { return m.uci; });
      }
    },
    {
      id: 'turtle', name: 'Turtle', group: 'personality',
      blurb: 'always move the piece closest to your own back rank',
      filter: function (c) {
        var low = Math.min.apply(null, c.infos.map(function (m) { return advanceOf(m.from, c.side); }));
        return c.infos.filter(function (m) { return advanceOf(m.from, c.side) === low; })
          .map(function (m) { return m.uci; });
      }
    },
    {
      id: 'bull', name: 'Bull in a china shop', group: 'personality',
      blurb: 'every move enters enemy territory if that is possible',
      filter: function (c) {
        var inThere = c.infos.filter(function (m) { return enemyHalf(m.to, c.side); });
        return (inThere.length ? inThere : c.infos).map(function (m) { return m.uci; });
      }
    },
    {
      id: 'tempo-terrorist', name: 'Tempo terrorist', group: 'personality',
      blurb: 'always leave the opponent the fewest legal replies',
      filter: function (c) { return c.moves.slice(); },
      rank: function (c, list) {
        return list.slice().sort(function (a, b) {
          var ra = c.replies(a), rb = c.replies(b);
          if (ra !== rb) return ra - rb;
          var va = c.scoreOf(a), vb = c.scoreOf(b);
          if (va == null || vb == null) return 0;
          return vb - va;
        });
      }
    },

    // ---------------- piece fixation ----------------
    {
      id: 'knights-only', name: 'Knights of the Round Table', group: 'fixation',
      blurb: 'knights only; the king moves when it is legally forced',
      filter: function (c) {
        var kn = c.infos.filter(function (m) { return m.isKnight; });
        if (kn.length) return kn.map(function (m) { return m.uci; });
        return c.infos.filter(function (m) { return m.isKing; }).map(function (m) { return m.uci; });
      }
    },
    {
      id: 'long-walk', name: 'The Long Walk', group: 'fixation',
      blurb: 'the king walks to the far side of the board; escorted, unharmed, ideally',
      filter: function (c) {
        var kk = c.infos.filter(function (m) { return m.isKing; });
        return kk.map(function (m) { return m.uci; });
      },
      rank: function (c, list) {
        var want = promoRank(c.side);
        return list.slice().sort(function (a, b) {
          var ma = c.info(a), mb = c.info(b);
          var da = Math.abs(rankNum(ma.to) - want), db = Math.abs(rankNum(mb.to) - want);
          if (da !== db) return da - db;
          return (c.scoreOf(b) || 0) - (c.scoreOf(a) || 0);
        });
      }
    },
    {
      id: 'queens-tour', name: 'Queen\'s world tour', group: 'fixation',
      blurb: 'the queen visits all four quadrants, in order; she has an itinerary',
      filter: function (c) {
        var q = c.infos.filter(function (m) { return m.isQueen; });
        if (!q.length) return [];
        var start = c.state.quad == null ? quadrantOf(q[0].from) : c.state.quad;
        for (var step = 0; step < 4; step++) {
          var want = (start + step) % 4;
          var hit = q.filter(function (m) { return quadrantOf(m.to) === want; });
          if (hit.length) { c.state.quad = (want + 1) % 4; return hit.map(function (m) { return m.uci; }); }
        }
        return q.map(function (m) { return m.uci; });
      }
    },
    {
      id: 'bishop-simp', name: 'Bishop simp', group: 'fixation',
      blurb: 'bishops only; the king moves when it is legally forced',
      filter: function (c) {
        var bs = c.infos.filter(function (m) { return m.isBishop; });
        if (bs.length) return bs.map(function (m) { return m.uci; });
        return c.infos.filter(function (m) { return m.isKing; }).map(function (m) { return m.uci; });
      }
    },

    // ---------------- the deliberate-disaster family ----------------
    {
      id: 'bongcloud', name: 'Bongcloud', group: 'chaos',
      blurb: '1.e4 e5 2.Ke2, and the king keeps walking',
      filter: function (c) {
        var open = c.side === 'w' ? ['e2e4'] : ['e7e5'];
        if (c.ply < 4) {
          var o = c.infos.filter(function (m) { return open.indexOf(m.uci) >= 0; });
          if (o.length) return o.map(function (m) { return m.uci; });
        }
        var k = c.infos.filter(function (m) { return m.isKing; });
        return (k.length ? k : c.infos).map(function (m) { return m.uci; });
      }
    },
    {
      id: 'blunder-chicken', name: 'Blunder chicken', group: 'chaos',
      blurb: 'second best, then third, ratcheting worse - until it panics',
      filter: function (c) { return c.moves.slice(); },
      rank: function (c, list) {
        var n = c.state.plays || 0;
        var ordered = rankMoves(c, list, 'best');
        if (!ordered.length) return ordered;
        var idx = Math.min(n, ordered.length - 1);
        // panics when the ratchet has run out of road: back to the best move, counter reset next pick
        var pick = ordered[idx];
        return [pick].concat(ordered.filter(function (u) { return u !== pick; }));
      }
    },
    {
      id: 'worst-legal', name: 'Worst legal move', group: 'chaos',
      blurb: 'the engine\'s lowest-scored legal move; it only refuses moves that lose to mate in one',
      filter: function (c) {
        var safe = c.moves.filter(function (u) { return !c.allowsMateIn1(u); });
        return safe.length ? safe : c.moves.slice();
      },
      rank: function (c, list) { return rankMoves(c, list, 'worst'); }
    },
    {
      id: 'roll-for-it', name: 'Roll for it', group: 'chaos',
      blurb: 'uniformly random legal move, announced with total confidence',
      filter: function (c) { return c.moves.slice(); },
      rank: function (c, list) { return rankMoves(c, list, 'random'); }
    },
    {
      id: 'magnet-mode', name: 'Magnet mode', group: 'chaos',
      blurb: 'every move gets closer to the enemy king',
      filter: function (c) {
        var ek = c.enemyKing();
        if (!ek) return c.moves.slice();
        return c.infos.filter(function (m) {
          var before = cheb(m.from, ek), after = cheb(m.to, ek);
          return after < before || (m.isKing && after <= before);
        }).map(function (m) { return m.uci; });
      }
    },
    {
      id: 'salute-mode', name: 'Salute mode', group: 'chaos',
      blurb: 'one brilliant move, then the rest of the game is thrown',
      filter: function (c) { return c.moves.slice(); },
      rank: function (c, list) {
        return rankMoves(c, list, (c.state.plays || 0) === 0 ? 'best' : 'worst');
      }
    },
    {
      id: 'time-troll', name: 'Time troll', group: 'chaos', think: 'oscillate',
      blurb: 'instant for ten moves, then thirty seconds on move eleven',
      filter: function (c) { return c.moves.slice(); }
    }
  ];

  var DIRECTIVE_BY_ID = {};
  DIRECTIVES.forEach(function (d) { DIRECTIVE_BY_ID[d.id] = d; });

  var DIRECTIVE_GROUPS = [
    { id: 'pawn', name: 'Pawn family' },
    { id: 'geometry', name: 'Geometry' },
    { id: 'relations', name: 'Relationships' },
    { id: 'personality', name: 'Personality' },
    { id: 'fixation', name: 'Piece fixation' },
    { id: 'chaos', name: 'Deliberate disasters' }
  ];

  function directiveMoves(id, ctx) {
    var d = DIRECTIVE_BY_ID[id];
    if (!d || !ctx) return null;
    var allowed = d.filter(ctx) || [];
    var seen = {}, out = [];
    allowed.forEach(function (u) { if (ctx.moves.indexOf(u) >= 0 && !seen[u]) { seen[u] = 1; out.push(u); } });
    return out;
  }

  /* Pick a move under a directive. `sincerity` is how the survivor is chosen: 'best' (default) plays the
     strongest legal move that still obeys, which is the funny one. An empty survivor list means the rule has
     no legal move here: the move is marked suspended and the caller falls back to the engine. */
  function pickDirective(id, ctx, opts) {
    opts = opts || {};
    var d = DIRECTIVE_BY_ID[id];
    if (!d || !ctx) return null;
    var allowed = directiveMoves(id, ctx);
    var suspended = false;
    if (!allowed || !allowed.length) { allowed = ctx.moves.slice(); suspended = true; }
    if (!allowed.length) return null;
    var ordered = d.rank ? d.rank(ctx, allowed) : rankMoves(ctx, allowed, opts.sincerity || 'best');
    if (!ordered || !ordered.length) return null;
    var uci = ordered[0];
    ctx.state.plays = (ctx.state.plays || 0) + 1;
    return {
      uci: uci, directive: id, name: d.name, group: d.group, blurb: d.blurb,
      suspended: suspended, pool: allowed, ordered: ordered
    };
  }

  // =====================================================================================
  //  2. RAGE - adaptive griefing: win on the board AND on the clock, then refuse to engage
  // =====================================================================================

  var RAGE_DEFAULTS = {
    evalThreshold: 250,   // centipawns, our point of view: +2.5
    clockMargin: 0,       // ms of slack; 0 = "my clock is at least as big as theirs"
    minPlies: 0           // grace period before denial may start
  };

  /* The Switch. Being winning alone does not unlock it: annoying someone takes time, so the clock is half
     the condition. Any missing input fails closed and says why, the same way the tutor's clock handling
     does everywhere else - no guess becomes a tactic. */
  function rageGate(s) {
    s = s || {};
    var cfg = Object.assign({}, RAGE_DEFAULTS, s.cfg || {});
    var score = typeof s.score === 'number' ? s.score : null;
    if (s.mate) score = 100000;                                  // a forced mate counts as winning
    if (score == null) return { on: false, reason: 'no evaluation to judge' };
    if (score < cfg.evalThreshold) {
      return { on: false, reason: 'only ' + (score / 100).toFixed(1) + ' up - not enough to start being annoying' };
    }
    if (s.ply != null && s.ply < cfg.minPlies) return { on: false, reason: 'too early' };
    var mine = s.myClockMs, theirs = s.oppClockMs;
    if (mine == null || theirs == null) {
      return { on: false, reason: 'winning, but the clocks are unknown - no clock, no siege' };
    }
    if (mine < theirs - cfg.clockMargin) {
      return { on: false, reason: 'winning, but behind on time (' + fmtClock(mine) + ' vs ' + fmtClock(theirs) + ')' };
    }
    return { on: true, reason: 'up ' + (score / 100).toFixed(1) + ' with ' + fmtClock(mine) + ' vs ' + fmtClock(theirs) };
  }
  function fmtClock(ms) {
    if (ms == null) return '?:??';
    var t = Math.max(0, Math.round(ms / 1000));
    var m = Math.floor(t / 60), s = t % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* Frustration Index: how little the opponent has been allowed to happen. Every component is a thing they
     were denied, scored against how often it would normally occur across the game so far. */
  function frustrationIndex(st) {
    st = st || {};
    var plies = Math.max(1, st.plies || 1);
    var parts = [];
    var expect = function (per) { return Math.max(1, plies / per); };
    parts.push(clamp01(1 - (st.oppCaptures || 0) / expect(12)));        // captures they managed
    parts.push(clamp01(1 - (st.oppChecks || 0) / expect(8)));           // checks they landed
    parts.push(clamp01(1 - (st.oppTrades || 0) / expect(20)));          // trades completed
    parts.push(clamp01(1 - (st.oppEntries || 0) / expect(5)));          // entries into our half
    if (st.oppLegalAvg != null) parts.push(clamp01(1 - st.oppLegalAvg / 38));
    var sum = parts.reduce(function (a, b) { return a + b; }, 0);
    return Math.round(100 * sum / parts.length);
  }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function frustrationWord(idx) {
    if (idx >= 90) return 'absolute';
    if (idx >= 75) return 'severe';
    if (idx >= 55) return 'notable';
    if (idx >= 35) return 'mild';
    return 'none yet';
  }

  /* Tilt detector. A collapse in the opponent's average move time is the visible signature of someone who
     has stopped thinking and started emoting. Reported, never acted on. */
  function tiltRead(times) {
    if (!Array.isArray(times) || times.length < 4) return { ready: false, drop: 0, tilted: false, note: '' };
    var recent = times.slice(-3), prior = times.slice(0, -3);
    var ra = avg(recent), pa = avg(prior);
    if (!pa) return { ready: false, drop: 0, tilted: false, note: '' };
    var drop = (pa - ra) / pa;
    var tilted = drop >= 0.35;
    return {
      ready: true, drop: drop, tilted: tilted,
      recentAvg: ra, priorAvg: pa,
      note: tilted
        ? 'opponent\'s average move time dropped ' + Math.round(drop * 100) + '% (' + (ra / 1000).toFixed(1) + 's vs ' + (pa / 1000).toFixed(1) + 's). Notable.'
        : ''
    };
  }
  function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }

  // Each rage tactic: { id, name, group, blurb, filter(ctx), rank?(ctx,list), think?: 'instant'|'max'|null }
  var RAGE_TACTICS = [
    // ---- denial ----
    {
      id: 'teflon', name: 'Teflon', group: 'denial',
      blurb: 'never end a move on a square they attack; nothing is ever touchable',
      filter: function (c) {
        return c.moves.filter(function (u) {
          var m = c.info(u);
          if (c.attackedAfter(u, m.to)) return false;
          return (c.hangingAfter(u) || 0) === 0;
        });
      }
    },
    {
      id: 'trade-refusal', name: 'Trade refusal', group: 'denial',
      blurb: 'never capture, never trade - I do not want your pieces',
      filter: function (c) { return c.infos.filter(function (m) { return !m.capture; }).map(function (m) { return m.uci; }); }
    },
    {
      id: 'material-hoarding', name: 'Material hoarding', group: 'denial',
      blurb: 'refuse all simplification; keep every piece on the board',
      filter: function (c) {
        var quiet = c.infos.filter(function (m) { return !m.capture; });
        return (quiet.length ? quiet : c.infos).map(function (m) { return m.uci; });
      }
    },
    {
      id: 'zebra-cage', name: 'Zebra cage', group: 'denial',
      blurb: 'stay at least two squares from every enemy piece; no contact, ever',
      filter: function (c) {
        return c.moves.filter(function (u) {
          var m = c.info(u), foes = c.enemyPiecesAfter(u);
          return !foes.some(function (sq) { return cheb(sq, m.to) < 2; });
        });
      }
    },
    {
      id: 'the-tease', name: 'The Tease', group: 'denial',
      blurb: 'offer a piece, and when they commit to it, slide it away',
      filter: function (c) {
        // 1. anything of ours that is actually hanging gets pulled back to safety - the slide-away
        var rescues = c.moves.filter(function (u) {
          var m = c.info(u);
          if (m.type === 'K') return false;
          var hangingNow = L().attackedBy(c.pieces, m.from, c.opp) && !L().attackedBy(c.pieces, m.from, c.side);
          return hangingNow && !c.attackedAfter(u, m.to);
        });
        if (rescues.length) return rescues;
        // 2. otherwise dangle something: a square they attack that we still defend, so it is never really loose
        var bait = c.moves.filter(function (u) {
          var m = c.info(u);
          if (m.type === 'K' || m.capture) return false;
          return c.attackedAfter(u, m.to) && c.defendedAfter(u, m.to) && (c.hangingAfter(u) || 0) === 0;
        });
        return bait.length ? bait : c.moves.filter(function (u) { return (c.hangingAfter(u) || 0) === 0; });
      }
    },
    {
      id: 'squatters-rights', name: 'Squatter\'s rights', group: 'denial',
      blurb: 'sit on the squares their plan needs',
      filter: function (c) {
        var held = c.moves.filter(function (u) {
          var m = c.info(u);
          return enemyHalf(m.to, c.side) && c.defendedAfter(u, m.to) && (c.hangingAfter(u) || 0) === 0;
        });
        return held.length ? held : c.moves.filter(function (u) { return (c.hangingAfter(u) || 0) === 0; });
      }
    },
    {
      id: 'fortress', name: 'No-contact fortress', group: 'denial',
      blurb: 'withdraw behind the midline and shuffle; completely winning, completely unreachable',
      filter: function (c) {
        var home = c.infos.filter(function (m) { return ownHalf(m.to, c.side); });
        return (home.length ? home : c.infos).map(function (m) { return m.uci; });
      }
    },
    {
      id: 'wall-of-berlin', name: 'Wall of Berlin', group: 'denial',
      blurb: 'no pawn breaks, ever; the position is sealed',
      filter: function (c) {
        var solid = c.moves.filter(function (u) {
          var m = c.info(u);
          if (!m.isPawn) return true;
          if (m.capture) return false;                                    // a capture opens the structure
          return !c.attackedAfter(u, m.to);                                // so does a push onto a pawn's square
        });
        return solid.length ? solid : c.moves.slice();
      }
    },

    // ---- clock warfare ----
    {
      id: 'clock-siege', name: 'Clock siege', group: 'clock', think: 'instant',
      blurb: 'fast, safe, pointless moves that force them to think; burns their clock, not yours',
      filter: function (c) {
        var quiet = c.moves.filter(function (u) {
          var m = c.info(u);
          return !m.capture && !c.checks(u) && (c.hangingAfter(u) || 0) === 0;
        });
        return quiet.length ? quiet : c.moves.filter(function (u) { return (c.hangingAfter(u) || 0) === 0; });
      }
    },
    {
      id: 'the-freeze', name: 'The Freeze', group: 'clock', think: 'max',
      blurb: 'maximum think time on every move, including the forced recapture',
      filter: function (c) { return c.moves.slice(); }
    },
    {
      id: 'denial-speed', name: 'Denial by speed', group: 'clock', think: 'instant',
      blurb: 'move instantly, every move; deny them even the satisfaction of a pause',
      filter: function (c) { return c.moves.slice(); }
    },
    {
      id: 'tic-tock', name: 'Tick-tock', group: 'clock',
      blurb: 'they watch their clock while yours sits there',
      filter: function (c) { return c.moves.slice(); }
    },

    // ---- slow-win / humiliation ----
    {
      id: 'long-goodbye', name: 'The Long Goodbye', group: 'slow',
      blurb: 'the slowest forced mate; never mate in one when mate in nine will do',
      filter: function (c) { return c.moves.slice(); },
      rank: function (c, list) {
        var winning = list.filter(function (u) {
          var v = c.scoreOf(u);
          return v != null && v > 0 && v < 90000;                          // 90000+ is a mate score
        });
        if (winning.length) return rankMoves(c, winning, 'worst');
        var mates = list.filter(function (u) { var v = c.scoreOf(u); return v != null && v >= 90000; });
        if (mates.length) {
          return mates.sort(function (a, b) { return (c.scoreOf(a) || 0) - (c.scoreOf(b) || 0); });
        }
        return rankMoves(c, list, 'worst');
      }
    },
    {
      id: 'the-yawn', name: 'The Yawn', group: 'slow',
      blurb: 'the single least committal legal move; nothing ever happens, ever',
      filter: function (c) {
        var quiet = c.moves.filter(function (u) {
          var m = c.info(u);
          return !m.capture && !c.checks(u) && ownHalf(m.to, c.side) && (c.hangingAfter(u) || 0) === 0;
        });
        return quiet.length ? quiet : c.moves.slice();
      },
      rank: function (c, list) {
        // the move that changes the evaluation least is the most boring one available
        var vals = list.map(function (u) { return c.scoreOf(u); }).filter(function (v) { return v != null; });
        if (!vals.length) return list;
        var mid = vals.slice().sort(function (a, b) { return a - b; })[Math.floor(vals.length / 2)];
        return list.slice().sort(function (a, b) {
          var va = c.scoreOf(a), vb = c.scoreOf(b);
          if (va == null || vb == null) return 0;
          return Math.abs(va - mid) - Math.abs(vb - mid);
        });
      }
    },
    {
      id: 'lap-of-honour', name: 'Lap of honour', group: 'slow',
      blurb: 'underpromote to a knight, then promote all eight pawns before mating',
      filter: function (c) {
        var promos = c.moves.filter(function (u) { return u.length === 5; });
        if (promos.length) {
          var knights = promos.filter(function (u) { return u[4] === 'n'; });
          return knights.length ? knights : promos;
        }
        var pawns = c.infos.filter(function (m) { return m.isPawn; });
        if (!pawns.length) return c.moves.slice();
        var top = Math.max.apply(null, pawns.map(function (m) { return advanceOf(m.from, c.side); }));
        return pawns.filter(function (m) { return advanceOf(m.from, c.side) === top; }).map(function (m) { return m.uci; });
      }
    },
    {
      id: 'the-escort', name: 'The Escort', group: 'slow',
      blurb: 'the king personally walks a passed pawn in while everything else stays still',
      filter: function (c) {
        var pawn = mostAdvancedPassedPawn(c);
        if (!pawn) return c.moves.slice();
        var pushers = c.infos.filter(function (m) { return m.from === pawn && advanceOf(m.to, c.side) > advanceOf(m.from, c.side); });
        if (pushers.length) return pushers.map(function (m) { return m.uci; });
        // the pawn cannot advance yet (or is blocked): the king walks over to it instead
        var king = c.infos.filter(function (m) { return m.isKing; });
        if (!king.length) return c.moves.slice();
        return king.slice().sort(function (a, b) {
          return cheb(a.to, pawn) - cheb(b.to, pawn);
        }).map(function (m) { return m.uci; });
      }
    },
    {
      id: 'the-carousel', name: 'The Carousel', group: 'slow',
      blurb: 'shuffle the same pieces on a three-move cycle, forever',
      filter: function (c) {
        var cyc = c.state.cycle;
        if (cyc && cyc.length) {
          var live = cyc.filter(function (u) { return c.moves.indexOf(u) >= 0; });
          if (live.length) {
            var i = (c.state.cycleAt || 0) % live.length;
            c.state.cycleAt = i + 1;
            return [live[i]];
          }
        }
        // rebuild: three quiet moves that stay home, so the cycle can repeat without ever being a repetition
        var quiet = c.infos.filter(function (m) {
          return !m.isPawn && !m.isKing && !m.capture && ownHalf(m.from, c.side) && ownHalf(m.to, c.side);
        }).map(function (m) { return m.uci; });
        if (quiet.length < 2) return c.moves.slice();
        c.state.cycle = quiet.slice(0, 3);
        c.state.cycleAt = 1;
        return [quiet[0]];
      }
    }
  ];

  function mostAdvancedPassedPawn(c) {
    var mine = [], foes = [];
    for (var sq in c.pieces) {
      var pc = c.pieces[sq];
      if (typeOf(pc) !== 'P') continue;
      (sideOfPc(pc) === c.side ? mine : foes).push(sq);
    }
    var passed = mine.filter(function (sq) {
      var f = fileOf(sq), adv = advanceOf(sq, c.side);
      return !foes.some(function (o) {
        return Math.abs(fileOf(o) - f) <= 1 && advanceOf(o, c.side) > adv;
      });
    });
    if (!passed.length) return null;
    return passed.sort(function (a, b) { return advanceOf(b, c.side) - advanceOf(a, c.side); })[0];
  }

  var RAGE_BY_ID = {};
  RAGE_TACTICS.forEach(function (t) { RAGE_BY_ID[t.id] = t; });
  var RAGE_GROUPS = [
    { id: 'denial', name: 'Denial' },
    { id: 'clock', name: 'Clock warfare' },
    { id: 'slow', name: 'Slow win' }
  ];

  /* Which tactic fits the moment. Clock tactics only when there is a real clock gap, humiliation only when
     the position is already hopeless for them, denial otherwise - and it never repeats the same one twice
     running, because a single tactic played forever is a directive, not a brain. */
  /* Which tactic fits the moment. A big clock gap is the loudest signal there is, so it wins outright:
     humiliation tactics need time on YOUR clock, and grinding them down needs time off THEIRS, so mixing
     the two would waste the lead. Denial is the default; the slow win only unlocks once the position is
     already hopeless for them. */
  var HUMILIATION = ['long-goodbye', 'lap-of-honour', 'the-escort', 'the-carousel', 'the-yawn'];
  function chooseTactic(c, s) {
    s = s || {};
    var denial = RAGE_TACTICS.filter(function (t) { return t.group === 'denial'; }).map(function (t) { return t.id; });
    var clock = ['clock-siege', 'the-freeze', 'denial-speed', 'tic-tock'];
    var lead = (s.myClockMs != null && s.oppClockMs != null) ? s.myClockMs - s.oppClockMs : 0;
    var score = s.mate ? 100000 : (s.score || 0);
    var pool;
    if (lead > 10000) pool = clock;
    else if (score >= 600) pool = HUMILIATION;
    else if (score >= 400) pool = denial.concat(['the-yawn', 'the-carousel']);
    else pool = denial.concat(lead > 0 ? ['clock-siege', 'tic-tock'] : []);
    var prev = s.state && s.state.lastTactic;
    var fresh = pool.filter(function (id) { return id !== prev; });
    pool = fresh.length ? fresh : pool;
    return pool[Math.floor(c.rng() * pool.length) % pool.length];
  }

  function ragePick(ctx, s) {
    s = s || {};
    var gate = rageGate(s);
    if (!gate.on) return { on: false, gate: gate, uci: null };
    var id = (s.tactic && s.tactic !== 'auto' && RAGE_BY_ID[s.tactic]) ? s.tactic : chooseTactic(ctx, s);
    var t = RAGE_BY_ID[id];
    if (!t) return { on: false, gate: gate, uci: null };
    var st = s.state || (s.state = {});
    var allowed = (t.filter(ctx) || []).filter(function (u) { return ctx.moves.indexOf(u) >= 0; });
    var suspended = false;
    if (!allowed.length) { allowed = ctx.moves.slice(); suspended = true; }
    if (!allowed.length) return { on: false, gate: gate, uci: null };
    var ordered = t.rank ? t.rank(ctx, allowed) : rankMoves(ctx, allowed, 'best');
    if (!ordered || !ordered.length) return { on: false, gate: gate, uci: null };
    st.lastTactic = id;
    return {
      on: true, gate: gate, uci: ordered[0], tactic: id, name: t.name, group: t.group,
      blurb: t.blurb, think: t.think || null, suspended: suspended, pool: allowed, ordered: ordered
    };
  }

  // ---------- telemetry lines (all rendered in the user's own panel, aimed at nobody) ----------
  function counterLine(st) {
    var n = (st && st.oppCaptures) || 0, plies = (st && st.plies) || 0;
    return 'Pieces they have captured: ' + n + ' \\u00B7 moves played: ' + plies +
      (n === 0 && plies > 10 ? ' \\u00B7 they have taken nothing' : '');
  }
  function contactLine(st) {
    return 'You have been in check ' + ((st && st.oppChecks) || 0) + ' times \\u00B7 they have been in check ' +
      ((st && st.myChecks) || 0) + ' times';
  }
  function distanceLine(pieces, ctx) {
    if (!ctx || !pieces) return '';
    var king = ctx.kingSq(pieces, ctx.side);
    if (!king) return '';
    var best = 99, foes = [];
    for (var sq in pieces) if (sideOfPc(pieces[sq]) === ctx.opp) foes.push(sq);
    foes.forEach(function (sq) { best = Math.min(best, cheb(sq, king)); });
    if (best === 99) return '';
    return 'Closest enemy piece to your king: ' + best + ' square' + (best === 1 ? '' : 's') +
      ' \\u00B7 personal space ' + (best >= 3 ? 'maintained' : best >= 2 ? 'under review' : 'violated');
  }
  function postGameLine(st) {
    var idx = frustrationIndex(st);
    return 'Won. Frustration index peaked at ' + Math.max(idx, (st && st.peakFrustration) || 0) +
      '%. They captured ' + ((st && st.oppCaptures) || 0) + ' piece' + (((st && st.oppCaptures) || 0) === 1 ? '' : 's') + '.' +
      ((st && st.myClockMs != null && st.oppClockMs != null) ? ' Time left: ' + fmtClock(st.myClockMs) + ' vs ' + fmtClock(st.oppClockMs) + '.' : '');
  }

  // =====================================================================================
  //  3. COMMENTARY, PRANKS AND TEXT POOLS
  // =====================================================================================

  var LOADING_LINES = [
    'defragmenting the knights',
    're-teaching the bishops to move diagonally',
    'explaining en passant to the pawns',
    'warming up the evaluation function',
    'polishing the king safety tables',
    'auditing the transposition table',
    'unrolling the opening book',
    'inflating the rooks',
    'negotiating with the hash table',
    'verifying that a knight really does move like that',
    'deleting the bongcloud variations',
    'loading 41% again, for authenticity',
    'sharpening the pawns',
    'asking the queen to calm down',
    'counting to 64 twice'
  ];

  // Cosmetic only: the label changes, the control behind it does not.
  var GASLIGHT = {
    'Think time': ['Vibes', 'Contemplation window', 'How long to stare', 'Think time (allegedly)'],
    'Play level': ['Aura', 'Virtue', 'Swagger', 'Play level (unverified)'],
    'Depth': ['Commitment', 'Seriousness', 'Depth (emotional)'],
    'Checkmate style': ['Moral compass', 'Intent', 'Checkmate style (vibes)'],
    'Hunter risk': ['Recklessness', 'Confidence', 'Hunter risk (uninsured)'],
    'Natural mistakes': ['Humanity', 'Character', 'Natural mistakes (allegedly)'],
    'Auto-play': ['Auto-pilot', 'Hands-free mode', 'Auto-play (do not tell anyone)'],
    'Auto-play ELO': ['Auto-play swagger', 'Auto-play aura'],
    'Show moves for': ['Whose side am I on', 'Allegiance'],
    'Memory (hash)': ['Short-term memory', 'Memory (hash, allegedly)'],
    'Panel opacity': ['Transparency (literal)', 'Honesty'],
    'Move dispatch': ['Move dispatch (eventually)'],
    'Best move': ['Best move (probably)'],
    'Top 3 moves': ['Top 3 (unranked)'],
    'Auto-analyze': ['Auto-worry'],
    'Position (FEN)': ['Position (allegedly)']
  };

  var JUDGMENT = {
    crushing: [
      'You are up a queen and still thinking. Respectfully, send it.',
      'The engine has stopped caring. It is just watching now.',
      'This position was decided several moves ago. You are reading the credits.'
    ],
    winning: [
      'Comfortably winning. Try not to think about it too hard.',
      'Good news: you are winning. Bad news: you still have to convert it.',
      'Up material. The hard part starts now.'
    ],
    level: [
      'Perfectly balanced, as all things should be. Neither of you deserves this.',
      'Dead level. Someone will have to have an idea eventually.'
    ],
    losing: [
      'You are losing, but with dignity. That is worth something.',
      'Down material. The engine believes in you. It is the only one.',
      'This is a defensive position. That is a generous way to put it.'
    ],
    lost: [
      'The engine has quietly begun planning for the next game.',
      'This is lost. What remains is a question of style.',
      'Resignation is a move too, technically.'
    ]
  };

  var CONFIDENCE_LIES = [
    'calculating...', 'thinking hard', 'almost certain', 'reasonably sure',
    'surely', 'cannot be certain', 'no idea', 'statistically fine', 'do not quote me'
  ];

  // Fake confidence for random picks.
  var ROLL_LINES = [
    'Calculated.', 'Obvious, really.', 'There was never another move.',
    'I saw this eight moves ago.', 'Trust me.', 'Engine-approved. Allegedly.',
    'Deliberate.', 'That is called a plan.'
  ];

  var SUSPEND_LINES = [
    'DIRECTIVE SUSPENDED', 'the rule has run out', 'no legal way to obey',
    'briefly a normal chess player'
  ];

  function pick(arr, rng) {
    if (!arr || !arr.length) return '';
    var r = rng || Math.random;
    return arr[Math.floor(r() * arr.length) % arr.length];
  }

  function judgmentFor(cp, rng) {
    var band = cp >= 900 ? 'crushing' : cp >= 250 ? 'winning' : cp >= -150 ? 'level' : cp >= -600 ? 'losing' : 'lost';
    return pick(JUDGMENT[band], rng);
  }

  // The confidence meter is a lie on purpose: high when the engine is winning, low when you are.
  function confidenceFor(cp, rng) {
    if (cp == null) return pick(CONFIDENCE_LIES, rng);
    if (cp >= 900) return '99%';
    if (cp >= 400) return String(88 + Math.floor((rng || Math.random)() * 10)) + '%';
    if (cp >= 100) return String(60 + Math.floor((rng || Math.random)() * 15)) + '%';
    if (cp >= -100) return '51%';
    if (cp >= -400) return String(12 + Math.floor((rng || Math.random)() * 20)) + '%';
    return String(2 + Math.floor((rng || Math.random)() * 6)) + '%';
  }

  // ---------- commentary voices ----------
  // v: { san, piece, capture, check, mate, eval, elo, moveNumber, blunder, captures, rng }
  var COMMENTARY = {
    commentator: function (v) {
      var r = v.rng || Math.random, out;
      if (v.mate) out = 'AND THAT IS MATE! ' + pick(['The crowd is on its feet!', 'Absolutely scenes!', 'They are throwing hats in here!'], r);
      else if (v.blunder) out = pick([
        'Oh no. OH NO. That is a blunder of the highest order.',
        'He has simply given it away! The commentary box is in shock!',
        'That move will be on the highlight reel for all the wrong reasons!'
      ], r);
      else if (v.capture) out = 'AND HE TAKES IT! ' + pick(['Contact! Finally, contact!', 'Wood off the board!', 'No prisoners!'], r);
      else if (v.check) out = 'CHECK! ' + pick(['The king is disturbed!', 'Forced! Absolutely forced!', 'No time to think!'], r);
      else if (v.eval >= 500) out = pick(['Total domination. This is a masterclass.', 'They have run out of moves and ideas.', 'Clinic. Absolute clinic.'], r);
      else if (v.eval <= -500) out = pick(['Desperation now. Pure desperation.', 'Anything to stay in the game.', 'Survival mode engaged.'], r);
      else out = pick([
        'A quiet move. The tension is unbearable.',
        'Positional. Very positional. Someone wake me when it opens up.',
        'Both players circling. Nobody wants to blink.'
      ], r);
      return out;
    },
    grandpa: function (v) {
      var r = v.rng || Math.random, out;
      if (v.blunder) out = pick([
        'In my day we called that a mistake and we learned from it.',
        'Back in 1974 that move got you a talking to.',
        'I have seen better moves in a nursing home.'
      ], r);
      else if (v.capture) out = pick(['Now we are playing chess. Proper chess.', 'Trading? At this hour?'], r);
      else if (v.check) out = pick(['Check. He will not like that.', 'Chasing the king again. No patience, any of you.'], r);
      else if (v.mate) out = 'Checkmate. Took you long enough.';
      else out = pick([
        'Back in my day we castled. None of this king-walking nonsense.',
        'Develop your pieces. I have said it a thousand times.',
        'Control the centre. It is not a new idea, it is just a good one.',
        'Nobody plays the Ruy Lopez any more. Disgraceful.'
      ], r);
      return out;
    },
    armchair: function (v) {
      var r = v.rng || Math.random;
      var grade;
      if (v.mate) grade = 'A+. Decisive.';
      else if (v.blunder) grade = pick(['F. See me after class.', 'D-. No.', 'Incomplete. Try again.'], r);
      else if (v.capture) grade = pick(['B. Takes stuff.', 'B+. Practical.', 'A-. Ruthless.'], r);
      else if (v.check) grade = pick(['B+. Aggressive.', 'A-. Initiative.'], r);
      else grade = pick([
        'B+. Solid. Boring, but solid.',
        'C. Nothing happens. Nothing ever happens.',
        'B-. Reasonable. Forgettable.',
        'A. Positional. Nobody will understand it.'
      ], r);
      return grade;
    },
    sarcastic: function (v) {
      var t = v.evalText || '0.0';
      var r = v.rng || Math.random;
      if (v.mate) return 'mate';
      if (v.eval >= 900) return t + ' (and yet, here we are)';
      if (v.eval >= 400) return t + ' (someone has to convert this)';
      if (v.eval >= 100) return t + ' (a modest advantage)';
      if (v.eval > -100) return t + ' (both of you)';
      if (v.eval > -400) return t + ' (this is fine)';
      return t + ' (nothing to see here)';
    },
    eloShame: function (v) {
      if (v.moveElo == null || v.elo == null) return '';
      if (v.moveElo >= v.elo) return '';
      return 'That move was rated ' + v.moveElo + '. You are rated ' + v.elo + '. Math is math.';
    }
  };

  var TAUNTS = [
    'no contact made', 'still nothing taken', 'they have swung at air',
    'untouchable, so far', 'denied again', 'not a single piece',
    'the position is sealed', 'plenty of time, apparently'
  ];

  /* A think-time override, in milliseconds, for the directive/tactic that owns the move. Null means "leave the
     search window alone". 'oscillate' is the Time troll: instant for ten plies, then a long, pointed stare. */
  function thinkMs(kind, baseMs, ply) {
    var p = ply == null ? 0 : ply;
    if (kind === 'instant') return 100;
    if (kind === 'max') return Math.max(baseMs || 0, 10000);
    if (kind === 'oscillate') return p < 10 ? 100 : 30000;
    return null;
  }
  function directiveThink(id) { var d = DIRECTIVE_BY_ID[id]; return d && d.think ? d.think : null; }

  var api = {
    // helpers
    thinkMs: thinkMs, directiveThink: directiveThink,
    fileOf: fileOf, rankOf: rankOf, sqAt: sqAt, cheb: cheb, isDark: isDark, isLight: isLight,
    advanceOf: advanceOf, ownHalf: ownHalf, enemyHalf: enemyHalf, backRank: backRank, promoRank: promoRank,
    quadrantOf: quadrantOf, worthOf: worthOf, typeOf: typeOf, sideOfPc: sideOfPc, other: other,
    infoOf: infoOf, fmtClock: fmtClock, pick: pick,
    // directives
    makeContext: makeContext, rankMoves: rankMoves, directiveMoves: directiveMoves, pickDirective: pickDirective,
    DIRECTIVES: DIRECTIVES, DIRECTIVE_BY_ID: DIRECTIVE_BY_ID, DIRECTIVE_GROUPS: DIRECTIVE_GROUPS,
    // rage
    RAGE_TACTICS: RAGE_TACTICS, RAGE_BY_ID: RAGE_BY_ID, RAGE_GROUPS: RAGE_GROUPS, RAGE_DEFAULTS: RAGE_DEFAULTS,
    rageGate: rageGate, ragePick: ragePick, chooseTactic: chooseTactic,
    frustrationIndex: frustrationIndex, frustrationWord: frustrationWord, tiltRead: tiltRead,
    counterLine: counterLine, contactLine: contactLine, distanceLine: distanceLine, postGameLine: postGameLine,
    // text
    LOADING_LINES: LOADING_LINES, GASLIGHT: GASLIGHT, JUDGMENT: JUDGMENT, CONFIDENCE_LIES: CONFIDENCE_LIES,
    ROLL_LINES: ROLL_LINES, SUSPEND_LINES: SUSPEND_LINES, TAUNTS: TAUNTS,
    judgmentFor: judgmentFor, confidenceFor: confidenceFor, COMMENTARY: COMMENTARY
  };
  root.CTTroll = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
