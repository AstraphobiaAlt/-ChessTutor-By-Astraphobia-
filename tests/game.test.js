/* game.js: legal moves, the move-history tracker, history-aware position commands, the clock adapter and the
   ponder gate. Pure node, no dependencies:  node tests/game.test.js */
'use strict';
const G = require('../game.js');

let checks = 0, failures = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.error('FAIL: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

// ---------- legal move generation (perft reference counts) ----------
[
  [G.START_FEN, [20, 400, 8902]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039]],   // castling, ep, pins
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812]],                         // ep discovered check
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],   // promotions
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486]]
].forEach(([fen, counts]) => counts.forEach((n, i) => eq(G.perft(fen, i + 1), n, 'perft ' + (i + 1) + ' ' + fen)));

// FEN bookkeeping after moves
eq(G.playUci(G.START_FEN, 'e2e4'), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', 'double push sets ep, keeps clocks');
eq(G.playUci(G.START_FEN, 'e2e5'), null, 'illegal move refused');
eq(G.playUci('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 3 10', 'e1g1'), 'r3k2r/8/8/8/8/8/8/R4RK1 b kq - 4 10', 'castling moves the rook, drops rights');
eq(G.playUci('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 3 10', 'a8a1'), '4k2r/8/8/8/8/8/8/r3K2R w Kk - 0 11', 'capturing a rook removes its castling right');
eq(G.positionKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'),
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -', 'an ep square nobody can capture on is not part of the position');

// ---------- history tracker ----------
const fenAfter = (moves, from) => moves.reduce((f, m) => G.playUci(f, m), from || G.START_FEN);
{
  let h = null, r;
  r = G.advanceHistory(h, G.START_FEN, 'board'); h = r.h;
  eq(r.change, 'reset', 'first sighting starts a history');
  ok(h.complete, 'the initial position is a complete history');
  eq(G.positionCommand(h), 'position startpos', 'start position command');
  r = G.advanceHistory(h, G.START_FEN, 'board');
  eq(r.change, 'same', 'the same board again changes nothing');
  ok(r.h === h, 'and returns the same snapshot');
  const line = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1'];
  const seen = [];
  for (let i = 0; i < line.length; i++) {
    r = G.advanceHistory(h, fenAfter(line.slice(0, i + 1)), 'board'); h = r.h; seen.push(r.change);
  }
  eq(seen, line.map(() => 'move'), 'every knight shuffle (including repeating positions) is a single move');
  eq(G.positionCommand(h), 'position startpos moves ' + line.join(' '), 'the engine gets start position plus every move');
  ok(h.complete && /repetition-aware/.test(G.historyLabel(h)), 'and is labelled repetition-aware: ' + G.historyLabel(h));

  // two plies between readings (an instant premove reply)
  r = G.advanceHistory(h, fenAfter(line.concat(['f6g8', 'e2e4'])), 'board');
  eq(r.change, 'moves2', 'two plies landing between readings are both recovered');
  eq(r.h.moves.slice(-2), ['f6g8', 'e2e4'], 'in order');
  h = r.h;
  // a takeback to an earlier position that is not one move away (after e4, the pawn cannot go back). The
  // position occurred several times in the shuffle: the LATEST occurrence is where the game was.
  r = G.advanceHistory(h, fenAfter(line.slice(0, 3)), 'board');
  eq(r.change, 'back', 'stepping back is a truncation, not a new game');
  eq(r.h.moves, line, 'history truncated at the latest occurrence of that position (the 3rd repetition, not the 1st)');
  // a different game on the same tab
  r = G.advanceHistory(h, 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', 'board');
  eq(r.change, 'reset', 'an unconnected position starts a fresh history');
  ok(!r.h.complete, 'mid-game root with a running halfmove clock is NOT complete');
  eq(G.positionCommand(r.h), 'position fen r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', 'it is sent as FEN');
  // ...but becomes complete once the window since the last irreversible move is covered
  let mid = r.h;
  mid = G.advanceHistory(mid, G.playUci(mid.fens[0], 'f1c4'), 'board').h;
  ok(!mid.complete, 'still incomplete one quiet move later');
  mid = G.advanceHistory(mid, G.playUci(mid.fens[1], 'g8f6'), 'board').h;
  mid = G.advanceHistory(mid, G.playUci(mid.fens[2], 'd2d4'), 'board').h;    // pawn move: halfmove clock 0
  ok(mid.complete, 'after a pawn move every relevant position is known');
  // DOM-only root: castling was guessed, the clock invented - never claimed complete (unless the start position)
  const dom = G.advanceHistory(null, 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1', 'dom').h;
  ok(!dom.complete, 'a DOM-derived halfmove clock is not trusted');
  // board castling rights disagree with the derived ones -> do not silently continue a wrong history
  const derived = G.advanceHistory(null, 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'board').h;
  r = G.advanceHistory(derived, 'r3k2r/8/8/8/8/8/8/R2K3R b kq - 1 1', 'board');
  eq(r.change, 'move', 'Kd1 connects');
  r = G.advanceHistory(derived, 'r3k2r/8/8/8/8/8/8/R2K3R b KQkq - 1 1', 'board');
  eq(r.change, 'reset', 'a board claiming castling rights the history says are gone is not glued on');
}

// the tracker builds exactly the command tests/native_test.py proves Stockfish needs to see the repetition draw
{
  const rootFen = '6k1/5ppp/8/8/8/8/5PPP/3Q2K1 w - - 0 1';
  const shuffle = ['g1h1', 'g8h8', 'h1g1', 'h8g8', 'g1h1', 'g8h8', 'h1g1'];
  let h = G.advanceHistory(null, rootFen, 'board').h, fen = rootFen;
  shuffle.forEach(m => { h = G.advanceHistory(h, fen = G.playUci(fen, m), 'board').h; });
  eq(fen, '7k/5ppp/8/8/8/8/5PPP/3Q2K1 b - - 7 4', 'board after the king shuffle');
  eq(G.positionCommand(h), 'position fen ' + rootFen + ' moves ' + shuffle.join(' '), 'history command for the repetition check');
  ok(h.complete, 'complete: the root follows an irreversible move (halfmove clock 0)');
}

// lossless trimming only when the command would not fit the transport
{
  let h = G.newHistory(G.START_FEN, 'board');
  const pawns = [];
  'abcdefgh'.split('').forEach(f => pawns.push(f + '2' + f + '3', f + '7' + f + '6'));
  'abcd'.split('').forEach(f => pawns.push(f + '3' + f + '4', f + '6' + f + '5'));
  const cycle = ['b1d2', 'b8d7', 'd2b1', 'd7b8'];
  let fen = G.START_FEN;
  pawns.concat(cycle).forEach(m => { h = G.advanceHistory(h, fen = G.playUci(fen, m), 'board').h; });
  eq(h.plies, 28, 'long game followed');
  const full = G.positionCommand(h);
  ok(full.startsWith('position startpos moves a2a3 a7a6') && full.endsWith('d7b8'), 'normally sent in full');
  const trimmed = G.positionCommand(h, null, 120);
  eq(trimmed, 'position fen ' + h.fens[24] + ' moves ' + cycle.join(' '),
    'too long: starts at the last irreversible move (all Stockfish needs for repetitions)');
  eq(G.positionCommand(h, ['e1e2']).slice(-5), ' e1e2', 'a ponder guess is appended');
}

// a board's own move list: accepted only if it replays to the exact current position
{
  const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O'];
  const now = fenAfter(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1']);
  const h = G.historyFromMoves(null, moves, now);
  ok(h && h.complete, 'a SAN list from the start replays and is complete');
  eq(h && h.moves[8], 'e1g1', 'castling resolved to UCI');
  eq(h && h.source, 'board list', 'labelled as the board list');
  ok(G.historyFromMoves(null, [{ from: 'e2', to: 'e4' }, 'e7e5', 'Nf3+'], fenAfter(['e2e4', 'e7e5', 'g1f3'])), 'objects, UCI and decorated SAN mix');
  eq(G.historyFromMoves(null, moves.slice(0, -1), now), null, 'a list that stops short does not match the board: ignored');
  eq(G.historyFromMoves(null, ['e4', 'Ke7??'], now), null, 'an illegal entry voids the list');
  const promo = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
  ok(G.historyFromMoves(promo, ['a8=Q'], 'Q7/7k/8/8/8/8/8/K7 b - - 0 1'), 'SAN promotion from a set-up position');
  eq(G.historyFromMoves(promo, ['a7a8'], 'N7/7k/8/8/8/8/8/K7 b - - 0 1'), null, 'a promotion with no piece named is never guessed');
}

// ---------- clocks ----------
eq(G.clockMs('5:03'), 303000, 'm:ss');
eq(G.clockMs('0:01.5'), 1500, 'tenths');
eq(G.clockMs('1:02:03.045'), 3723045, 'h:mm:ss.mmm');
['', '5', '5:99', 'Time 3:00', '-1:00', '1:99:00', '3 days'].forEach(t => eq(G.clockMs(t), null, 'unreadable ' + JSON.stringify(t)));
eq([G.clockResolution('4:59'), G.clockResolution('0:09.4'), G.clockResolution('0:09.40')], [1000, 100, 10], 'display resolution');
eq(G.parsePgnTimeControl('180+2'), { baseMs: 180000, incMs: 2000 }, 'PGN 180+2');
eq(G.parsePgnTimeControl('600'), { baseMs: 600000, incMs: 0 }, 'PGN without increment');
['-', '?', '1/86400', '', null].forEach(t => eq(G.parsePgnTimeControl(t), null, 'PGN unknown ' + t));
eq(G.parseTimeControlLabel('3 | 2'), { baseMs: 180000, incMs: 2000 }, 'label 3 | 2');
eq(G.parseTimeControlLabel('10 min'), { baseMs: 600000, incMs: 0 }, 'label 10 min');
eq(G.parseTimeControlLabel('30 sec'), { baseMs: 30000, incMs: 0 }, 'label 30 sec');
eq(G.parseTimeControlLabel('3 days'), null, 'daily is not a clock');

const sample = (o) => Object.assign({ white: 180000, black: 175000, whiteRes: 1000, blackRes: 1000, whiteActive: true, blackActive: false, ts: 1000 }, o);
eq(G.activeClock(sample({})), 'w', 'marker class decides');
eq(G.activeClock(sample({ whiteActive: false })), null, 'no marker, no history: unknown');
eq(G.activeClock(sample({ whiteActive: false, black: 170000, ts: 3000 }), sample({ whiteActive: false, ts: 1000 })), 'b', 'the ticking clock decides');
eq(G.activeClock(sample({ whiteActive: false, ts: 9000 }), sample({ whiteActive: false, white: 190000, ts: 1000 })), null, 'readings too far apart');
eq(G.activeClock(sample({ blackActive: true })), null, 'both flagged: unknown');

// increment: declared, contradicted, observed, unknown
eq(G.resolveIncrement([{ source: 'game TimeControl', incMs: 2000 }], []).incMs, 2000, 'declared increment used');
eq(G.resolveIncrement([{ source: 'a', incMs: 2000 }, { source: 'b', incMs: 0 }], []).incMs, null, 'disagreeing declarations -> unknown');
eq(G.resolveIncrement([{ source: 'a', incMs: 2000 }], [{ estMs: 120, tolMs: 1300 }]).incMs, 2000, 'one odd observation is tolerated');
eq(G.resolveIncrement([{ source: 'a', incMs: 5000 }], [{ estMs: 120, tolMs: 1300 }, { estMs: -200, tolMs: 1300 }]).incMs, null,
  'two observations contradicting the declaration -> unknown');
eq(G.resolveIncrement([], [{ estMs: 1980, tolMs: 300 }, { estMs: 2050, tolMs: 300 }, { estMs: 2010, tolMs: 400 }]).incMs, 2000, 'three tight observations agree');
eq(G.resolveIncrement([], [{ estMs: 1980, tolMs: 1300 }, { estMs: 2050, tolMs: 1300 }, { estMs: 2010, tolMs: 1300 }]).incMs, null, 'coarse observations are not enough');
eq(G.resolveIncrement([], []).note, 'increment unknown', 'nothing known');

eq(G.safetyReserve([], 1000), { ms: 1500, latencyMs: 500, measured: false, samples: 0 }, 'unmeasured reserve');
eq(G.safetyReserve([40, 60, 80], 100).ms, 350, 'small measured latency: 250 ms floor + 100 ms display');
eq(G.safetyReserve([400, 900], 1000).ms, 1450 + 1000, 'reserve grows with the worst recent latency');
eq(G.safetyReserve([1e6], 0).latencyMs, 5000, 'and is capped');

const base = { time: 2, clocks: sample({}), mover: 'w', increment: { incMs: 2000, note: '+2s (game TimeControl)' }, latencies: [100], now: 1050 };
{
  const lim = G.clockLimits(base);
  ok(lim.clockOk, 'certain clocks are used');
  // white: 180000 - 50 ms since the reading - (250 + 1000) reserve; black as read (not running)
  eq(G.goCommand(lim), 'go wtime 178700 btime 175000 winc 2000 binc 2000', 'go command with real increment and measured reserve');
  ok(/measured latency 250 ms over 1 moves/.test(lim.clockNote), 'note explains the reserve: ' + lim.clockNote);
  const unk = G.clockLimits(Object.assign({}, base, { increment: { incMs: null, note: 'increment unknown' } }));
  eq(G.goCommand(unk), 'go wtime 178700 btime 175000 winc 0 binc 0', 'unknown increment is the conservative zero');
  ok(/increment unknown \u2192 0 \(conservative\)/.test(unk.clockNote), 'and says so: ' + unk.clockNote);
  const fb = G.clockLimits(Object.assign({}, base, { mover: 'b' }));
  eq(G.goCommand(fb), 'go movetime 2000', 'running clock is not the side to move: fall back');
  ok(/does not match the side to move/.test(fb.clockNote) && fb.clockOk === false, 'fallback is explicit: ' + fb.clockNote);
  eq(G.goCommand(G.clockLimits(Object.assign({}, base, { clocks: { error: 'no white clock found' } }))), 'go movetime 2000', 'missing clock');
  eq(G.goCommand(G.clockLimits(Object.assign({}, base, { clocks: sample({ whiteActive: false }) }))), 'go movetime 2000', 'unknown running side');
  eq(G.goCommand(G.clockLimits(Object.assign({}, base, { clocks: sample({ black: 0 }) }))), 'go movetime 2000', 'flagged clock');
  eq(G.goCommand(G.clockLimits({ time: 0 })), 'go movetime 1000', 'no clocks: Think time, one second minimum');
  eq(G.goCommand(G.clockLimits(Object.assign({}, base, { clocks: sample({ white: 900 }) }))), 'go wtime 1 btime 175000 winc 2000 binc 2000',
    'a clock below the reserve still sends a positive time (engine moves at once)');
  // pondering: our side (white) is to move in the pondered position, the opponent's (black) clock is running
  const p = G.clockLimits(Object.assign({}, base, { clocks: sample({ whiteActive: false, blackActive: true }), mover: 'w', expectActive: 'b', ponder: true }));
  eq(G.goCommand(p), 'go ponder wtime 178750 btime 174950 winc 2000 binc 2000', 'go ponder: reserve on our clock, age on the running one');
}

// ---------- ponder gate ----------
const gate = { enabled: true, maximum: true, autoplay: true, native: true, hostAllows: true, engineOption: true, historyComplete: true, clocksOk: true };
ok(G.ponderGate(gate).ok, 'every condition met');
[['enabled', 'pondering off'], ['maximum', 'Maximum Strength only'], ['autoplay', 'auto-play is off'], ['native', 'needs the native backend'],
  ['hostAllows', 'native host does not allow it (install with --allow-ponder)'], ['engineOption', 'engine has no Ponder option'],
  ['historyComplete', 'move history incomplete'], ['clocksOk', 'clock data uncertain']].forEach(([k, why]) => {
  const g = G.ponderGate(Object.assign({}, gate, { [k]: false }));
  ok(!g.ok && g.reason === why, k + ' blocks pondering: ' + g.reason);
});
const afterE4 = G.playUci(G.START_FEN, 'e2e4');
eq(G.ponderMove(afterE4, 'e7e5', null), 'e7e5', 'engine ponder move used');
eq(G.ponderMove(afterE4, null, ['e2e4', 'c7c5']), 'c7c5', 'else the PV reply');
eq(G.ponderMove(afterE4, 'e2e4', null), null, 'an illegal guess is never pondered');

console.log((failures ? 'FAILED ' : 'OK ') + checks + ' checks, ' + failures + ' failures');
process.exit(failures ? 1 : 0);
