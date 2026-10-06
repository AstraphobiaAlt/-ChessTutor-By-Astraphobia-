/* Runs in the page's own JS world (manifest "world": "MAIN") so it can ask chess.com's board object for the
   exact FEN (side to move, castling rights, en passant) and, when auto-play is on, hand it a move.
   The extension's content script asks via postMessage.
   Reading is always safe. Writing only ever happens for a request the content script made because the user
   switched auto-play on, and every move is checked against the board's own legal move list first, so a stale
   or ill-formed move is refused instead of guessed at. */
(function () {
  if (window.__ctBridge) return;
  window.__ctBridge = true;
  var boardOf = function () { return document.querySelector('wc-chess-board') || document.querySelector('chess-board'); };
  var reply = function (out) { window.postMessage(out, '*'); };

  // game.move() as chess.com itself uses it: from/to/promotion with userGenerated so a live game accepts it.
  function doMove(uci) {
    var b = boardOf(), g = b && b.game;
    if (!g || typeof g.move !== 'function') return { ok: false, reason: 'board has no move API' };
    var from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci[4] || null, san = null;
    try {
      if (typeof g.getLegalMoves === 'function') {          // refuse anything the board does not consider legal
        var legal = g.getLegalMoves() || [], pick = null;
        for (var i = 0; i < legal.length; i++) {
          var m = legal[i];
          if (m && m.from === from && m.to === to && (!promo || !m.promotion || m.promotion === promo)) { pick = m; break; }
        }
        if (!pick) return { ok: false, reason: 'not a legal move here' };
        if (pick.promotion) promo = pick.promotion;         // engine moves carry it, but never send a bare promotion
        san = pick.san || null;
      }
    } catch (_) {}
    var obj = { from: from, to: to, animate: false, userGenerated: true };
    if (promo) obj.promotion = promo;
    try {
      var r = g.move(obj);
      if (r && typeof r.then === 'function') r.then(null, function () {});
      if (r === false) return { ok: false, reason: 'move rejected' };
      return { ok: true, san: san };
    } catch (e) {
      try {                                        // last API shape some builds want: the plain SAN/UCI string
        var r2 = g.move(uci);
        if (r2 && typeof r2.then === 'function') r2.then(null, function () {});
        return r2 === false ? { ok: false, reason: 'move rejected' } : { ok: true, san: san };
      } catch (_) { return { ok: false, reason: 'move threw: ' + (e && e.message ? e.message : 'error') }; }
    }
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data) return;
    if (e.data.ctReq === 1) {
      var out = { ctRes: 1, id: e.data.id, ok: false, fen: null };
      try {
        var b = boardOf(), g = b && b.game;
        if (g && typeof g.getFEN === 'function') {
          var f = g.getFEN();
          if (typeof f === 'string' && f.split(' ').length >= 4) { out.fen = f; out.ok = true; }
        }
      } catch (_) {}
      reply(out);
    } else if (e.data.ctMoveReq === 1) {
      var res = { ok: false, reason: 'bad move' };
      try { res = doMove(String(e.data.uci || '')); } catch (err) { res = { ok: false, reason: 'bridge error' }; }
      reply({ ctMoveRes: 1, id: e.data.id, ok: !!res.ok, san: res.san || null, reason: res.reason || null });
    }
  });
})();
