/* Tests for Troll mode (troll.js).
   Run with:  node tests/troll.test.js

   Troll mode is a joke layer, but the promises it makes are real ones and they are pinned down here:

   DIRECTIVES
     - every directive only ever returns LEGAL moves for the position it was given
     - a rule with no legal move left is SUSPENDED for that move and the engine's own move is played instead
     - the default pick is the BEST move that obeys the rule (a sincere maniac, not a random one)
     - stateful rules (monorail, tag team, queen's tour, carousel) remember things between moves

   RAGE
     - the gate needs BOTH a winning position and at least as much time as the opponent; it fails closed and
       says why, so a missing clock can never turn into a tactic
     - every tactic only ever returns a legal move
     - the Frustration Index and the tilt detector are computed from counts, never guessed

   TEXT
     - the sarcastic eval keeps the real number (it only adds a comment), and the confidence meter lies on
       purpose: high when the engine is winning, low when the player is
*/
'use strict';
const G = require('../game.js');
const L = require('../lib.js');
const T = require('../troll.js');

let checks = 0, failures = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.error('FAIL: ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
const MIDDLE = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5';
const TACTICS = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
const KINGS = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
const ROOKS = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
const CAPTURE = '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1';
// White's rook is the only piece that could defend the back rank, and the h2 pawn stops it getting
// there along the file: Rh5-h6 therefore allows Ra1#, while the g-pawn push opens an escape square.
const BACKRANK = 'r5k1/8/8/7R/8/8/5PPP/6K1 w - - 0 1';
const QTAKE = '4k3/8/8/8/8/3q4/4P3/4K3 w - - 0 1';
const QUEENFREE = '4k3/8/8/8/8/8/8/3QK3 w - - 0 1';

// deterministic RNG so a failure is reproducible
function seeded(seed) { let s = seed || 1; return function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
const ctxOf = (fen, opts) => T.makeContext(fen, Object.assign({ rand: seeded(7), state: {} }, opts || {}));
const fileOfSq = s => s[0];
const rankOfSq = s => +s[1];

// =====================================================================================
//  registry integrity
// =====================================================================================
const ids = T.DIRECTIVES.map(d => d.id);
eq(new Set(ids).size, ids.length, 'every directive id is unique');
eq(T.DIRECTIVES.length, 39, 'the directive registry holds the full menu (39 rules)');
T.DIRECTIVES.forEach(d => {
  ok(typeof d.filter === 'function', d.id + ' has a filter');
  ok(!!d.name && !!d.blurb, d.id + ' has a name and a description');
  ok(T.DIRECTIVE_GROUPS.some(g => g.id === d.group), d.id + ' belongs to a known group');
});
const rageIds = T.RAGE_TACTICS.map(t => t.id);
eq(new Set(rageIds).size, rageIds.length, 'every rage tactic id is unique');
T.RAGE_TACTICS.forEach(t => {
  ok(typeof t.filter === 'function', t.id + ' has a filter');
  ok(T.RAGE_GROUPS.some(g => g.id === t.group), t.id + ' belongs to a known group');
});

// =====================================================================================
//  the property that matters most: a directive can only ever return legal moves
// =====================================================================================
const PROBE_FENS = [START, AFTER_E4, MIDDLE, TACTICS, KINGS, ROOKS, CAPTURE, QUEENFREE];
T.DIRECTIVES.forEach(d => {
  PROBE_FENS.forEach(fen => {
    const ctx = ctxOf(fen, { oppLastUci: 'e7e5' });
    const list = T.directiveMoves(d.id, ctx);
    ok(Array.isArray(list), d.id + ' returns a list for ' + fen.slice(0, 12));
    list.forEach(u => ok(ctx.moves.indexOf(u) >= 0, d.id + ' only returns legal moves (' + u + ')'));
    const pick = T.pickDirective(d.id, ctx, { sincerity: 'best' });
    if (ctx.moves.length) {
      ok(pick && ctx.moves.indexOf(pick.uci) >= 0, d.id + ' picks a legal move in ' + fen.slice(0, 12));
      ok(pick.suspended === (list.length === 0), d.id + ' is suspended exactly when the rule has no legal move');
    }
  });
});

// =====================================================================================
//  pawn family
// =====================================================================================
(function pawnFamily() {
  const c = ctxOf(START);
  const storm = T.directiveMoves('pawn-storm', c);
  ok(storm.length > 0, 'pawn storm has moves in the start position');
  ok(storm.every(u => T.typeOf(c.pieces[u.slice(0, 2)]) === 'P'), 'pawn storm only pushes pawns');

  ok(T.directiveMoves('pawn-pacifism', c).every(u => T.typeOf(c.pieces[u.slice(0, 2)]) !== 'P'),
    'pawn pacifism never moves a pawn');
  ok(T.directiveMoves('rook-pawn-rampage', c).every(u => 'ah'.indexOf(u[0]) >= 0),
    'rook pawn rampage only moves the a- and h-pawns');
  ok(T.directiveMoves('great-wall', c).every(u =>
    T.typeOf(c.pieces[u.slice(0, 2)]) !== 'P' || rankOfSq(u.slice(2, 4)) <= 3),
    'the Great Wall keeps every pawn on or below the third rank');
  ok(T.directiveMoves('phalanx', c).every(u => T.typeOf(c.pieces[u.slice(0, 2)]) === 'P'),
    'the phalanx only moves pawns');
  ok(T.directiveMoves('leapfrog', c).every(u => T.typeOf(c.pieces[u.slice(0, 2)]) === 'P'),
    'leapfrog only moves pawns');
  ok(T.directiveMoves('pawn-pacifism', ctxOf(MIDDLE)).length > 0,
    'pawn pacifism still has moves once pieces are developed');
})();

// =====================================================================================
//  geometry
// =====================================================================================
(function geometry() {
  const c = ctxOf(START);
  ok(T.directiveMoves('dark-square', c).every(u => T.isDark(u.slice(2, 4))), 'dark-square devotion only lands on dark squares');
  ok(T.directiveMoves('light-square', c).every(u => T.isLight(u.slice(2, 4))), 'light-square devotion only lands on light squares');
  ok(T.directiveMoves('homebody', c).every(u => T.advanceOf(u.slice(0, 2), 'w') <= 4 && T.advanceOf(u.slice(2, 4), 'w') <= 4),
    'the homebody never crosses the midline');
  ok(T.directiveMoves('checkerboard', c).every(u => T.isLight(u.slice(0, 2))), 'checkerboard only moves pieces standing on light squares');
  ok(T.directiveMoves('elevator', c).every(u => T.typeOf(c.pieces[u.slice(0, 2)]) !== 'N'), 'the elevator never moves a knight');
  ok(T.directiveMoves('bank-rank', c).every(u => rankOfSq(u.slice(0, 2)) === 1), 'bank rank only moves pieces off the back rank');
  eq(T.directiveMoves('diagonal-zealot', c).length, 0, 'the diagonal zealot has nothing legal in the start position');
  eq(T.pickDirective('diagonal-zealot', ctxOf(START), {}).suspended, true,
    'a rule with no legal move is suspended instead of silently ignored');

  // monorail picks one file and stays on it - and remembers which one
  const st = {};
  const c1 = T.makeContext(START, { state: st, rand: seeded(3) });
  const rail = T.directiveMoves('monorail', c1);
  ok(rail.every(u => fileOfSq(u) === 'a'), 'the monorail runs on one file (most own pieces, ties go to the a-file)');
  const c2 = T.makeContext(START, { state: st, rand: seeded(3) });
  ok(T.directiveMoves('monorail', c2).every(u => fileOfSq(u) === 'a'), 'the monorail remembers its file between moves');
  const c3 = T.makeContext(MIDDLE, { state: {}, rand: seeded(3) });
  const rail3 = T.directiveMoves('monorail', c3);
  ok(rail3.every(u => fileOfSq(u.slice(0, 2)) === fileOfSq(u.slice(2, 4))), 'every monorail move starts and ends on the same file');
})();

// =====================================================================================
//  relationships
// =====================================================================================
(function relations() {
  const c = ctxOf(START);
  ok(T.directiveMoves('leash-law', c).every(u => c.ownPiecesAfter(u).some(s => s !== u.slice(2, 4) && T.cheb(s, u.slice(2, 4)) <= 1)),
    'leash law always ends beside a friendly piece');
  ok(T.directiveMoves('social-distancing', c).every(u => !c.ownPiecesAfter(u).some(s => s !== u.slice(2, 4) && T.cheb(s, u.slice(2, 4)) <= 1)),
    'social distancing never ends beside a friendly piece');
  ok(T.directiveMoves('social-distancing', c).length > 0, 'social distancing still finds something (the rook pawns reach the fourth rank)');

  const q = ctxOf(QUEENFREE);
  const wing = T.directiveMoves('wingman', q);
  ok(wing.length > 0, 'the wingman has moves next to a free queen');
  ok(wing.every(u => u.slice(0, 2) === 'd1' || T.cheb(u.slice(2, 4), 'd1') <= 1),
    'every wingman move is a queen move or lands next to the queen');

  const st = {};
  const t1 = T.makeContext(MIDDLE, { state: st, rand: seeded(11) });
  const tag = T.directiveMoves('tag-team', t1);
  ok(tag.length > 0 && tag.every(u => u.slice(0, 2) === tag[0].slice(0, 2)), 'tag team only ever moves one of its two pieces');

  const m = ctxOf(START, { oppLastUci: 'e7e5' });
  eq(T.directiveMoves('monkey-see', m).indexOf('e2e4') >= 0, true, 'monkey see mirrors the opponent\'s e7-e5 as e2-e4');
})();

// =====================================================================================
//  personality
// =====================================================================================
(function personality() {
  const cap = ctxOf(CAPTURE);
  eq(T.pickDirective('berserker', cap, {}).uci, 'e4d5', 'the berserker takes the only capture available');
  ok(T.directiveMoves('pacifist', cap).every(u => !cap.info(u).capture), 'the pacifist refuses every capture');
  ok(T.pickDirective('pacifist', cap, {}).uci !== 'e4d5', 'the pacifist does not take the pawn either');

  const chk = ctxOf(ROOKS);
  const junkie = T.pickDirective('check-junkie', chk, {});
  ok(chk.checks(junkie.uci), 'the check junkie finds the check (Ra8+)');

  eq(T.directiveMoves('full-retreat', ctxOf(START)).length, 0, 'full retreat has nothing to retreat in the start position');
  const ret = T.directiveMoves('full-retreat', ctxOf(MIDDLE));
  ok(ret.every(u => T.advanceOf(u.slice(2, 4), 'w') < T.advanceOf(u.slice(0, 2), 'w')), 'full retreat only ever moves backwards');

  const gas = T.directiveMoves('all-gas', ctxOf(START));
  ok(gas.every(u => T.typeOf(T.makeContext(START, { state: {} }).pieces[u.slice(0, 2)]) === 'P'), 'all gas moves the most advanced pieces (the pawns)');
  ok(T.directiveMoves('turtle', ctxOf(START)).every(u => rankOfSq(u.slice(0, 2)) === 1), 'the turtle moves the pieces closest to its own back rank');

  const tt = ctxOf(MIDDLE);
  const best = T.pickDirective('tempo-terrorist', tt, {});
  const minReplies = Math.min.apply(null, tt.moves.map(u => tt.replies(u)));
  eq(tt.replies(best.uci), minReplies, 'the tempo terrorist leaves the opponent the fewest legal replies');

  const magCtx = ctxOf(ROOKS);
  const mag = T.directiveMoves('magnet-mode', magCtx);
  ok(mag.length > 0, 'magnet mode has moves towards the enemy king');
  ok(mag.every(u => T.cheb(u.slice(2, 4), 'e8') < T.cheb(u.slice(0, 2), 'e8') ||
    (T.typeOf(magCtx.pieces[u.slice(0, 2)]) === 'K' && T.cheb(u.slice(2, 4), 'e8') <= T.cheb(u.slice(0, 2), 'e8'))),
    'magnet mode never moves away from the enemy king');
})();

// =====================================================================================
//  piece fixation
// =====================================================================================
(function fixation() {
  const c = ctxOf(START);
  ok(T.directiveMoves('knights-only', c).every(u => T.typeOf(c.pieces[u.slice(0, 2)]) === 'N'), 'knights of the round table only moves knights');
  eq(T.directiveMoves('bishop-simp', c).length, 0, 'the bishop simp is stuck in the start position and says so');

  const walk = T.pickDirective('long-walk', ctxOf(KINGS), {});
  eq(rankOfSq(walk.uci.slice(2, 4)), 2, 'the long walk takes the king one step towards the far side');

  const q = ctxOf(QUEENFREE);
  const tour = T.directiveMoves('queens-tour', q);
  ok(tour.every(u => u.slice(0, 2) === 'd1'), 'the queen\'s world tour only moves the queen');
  ok(tour.every(u => T.quadrantOf(u.slice(2, 4)) === 0), 'the tour starts in the quadrant the queen is already in');
})();

// =====================================================================================
//  deliberate disasters
// =====================================================================================
(function chaos() {
  eq(T.pickDirective('bongcloud', ctxOf(START), {}).uci, 'e2e4', 'the bongcloud opens 1.e4');
  const afterOpen = ctxOf(AFTER_E4);
  eq(T.pickDirective('bongcloud', afterOpen, {}).uci, 'e7e5', 'and answers 1...e5');

  // chicken / salute / worst all read the engine's own ranking
  const lines = [{ move: 'a1a8', type: 'cp', score: 300 }, { move: 'a1a2', type: 'cp', score: 200 },
    { move: 'a1a3', type: 'cp', score: 100 }];
  const ranked = fen => T.makeContext(fen, { lines: lines, state: { plays: 0 }, rand: seeded(5) });
  eq(T.pickDirective('blunder-chicken', ranked(ROOKS), {}).uci, 'a1a8', 'blunder chicken starts with the best move');
  eq(T.pickDirective('blunder-chicken', T.makeContext(ROOKS, { lines: lines, state: { plays: 1 }, rand: seeded(5) }), {}).uci,
    'a1a2', 'and ratchets one step worse on the next move');
  eq(T.pickDirective('worst-legal', ranked(ROOKS), {}).uci, 'a1a3', 'worst legal move plays the lowest-scored line');
  eq(T.pickDirective('salute-mode', ranked(ROOKS), {}).uci, 'a1a8', 'salute mode plays its one brilliant move first');
  eq(T.pickDirective('salute-mode', T.makeContext(ROOKS, { lines: lines, state: { plays: 3 }, rand: seeded(5) }), {}).uci,
    'a1a3', 'and throws the rest of the game');

  const roll = T.pickDirective('roll-for-it', ranked(ROOKS), {});
  ok(G.legalMoves(ROOKS).indexOf(roll.uci) >= 0, 'roll for it still plays a legal move');

  // a move that hands the opponent mate in one is never played by worst-legal
  const br = ctxOf(BACKRANK);
  eq(br.allowsMateIn1('h5h6'), true, 'Rh5-h6 lets the black rook mate on a1');
  eq(br.allowsMateIn1('g2g3'), false, 'the g-pawn push opens an escape square, so it does not');
  eq(T.directiveMoves('worst-legal', br).indexOf('h5h6'), -1, 'worst legal move refuses a move that loses to mate in one');

  eq(T.directiveThink('time-troll'), 'oscillate', 'the time troll owns a think-time override');
  eq(T.directiveThink('pawn-storm'), null, 'an ordinary directive leaves the think time alone');
})();

// =====================================================================================
//  think-time overrides
// =====================================================================================
(function thinking() {
  eq(T.thinkMs(null, 5000, 3), null, 'no override means no override');
  eq(T.thinkMs('instant', 5000, 3), 100, 'instant is 100 ms');
  eq(T.thinkMs('max', 2000, 3), 10000, 'max is at least ten seconds');
  eq(T.thinkMs('max', 30000, 3), 30000, 'and never shorter than the configured think time');
  eq(T.thinkMs('oscillate', 5000, 3), 100, 'the time troll is instant early on');
  eq(T.thinkMs('oscillate', 5000, 10), 30000, 'and stares for thirty seconds from move eleven');
})();

// =====================================================================================
//  the Rage Brain: the gate
// =====================================================================================
(function gate() {
  const on1 = T.rageGate({ score: 900, myClockMs: 60000, oppClockMs: 30000 });
  eq(on1.on, true, 'winning on the board and ahead on the clock switches the Rage Brain on');

  const off1 = T.rageGate({ score: 100, myClockMs: 60000, oppClockMs: 30000 });
  eq(off1.on, false, 'being only a pawn up is not enough');
  ok(/not enough/.test(off1.reason), 'and it says why: ' + off1.reason);

  const off2 = T.rageGate({ score: 900, myClockMs: 20000, oppClockMs: 30000 });
  eq(off2.on, false, 'winning while behind on the clock does not switch it on');
  ok(/behind on time/.test(off2.reason), 'and it says why: ' + off2.reason);

  const off3 = T.rageGate({ score: 900, myClockMs: null, oppClockMs: 30000 });
  eq(off3.on, false, 'an unknown clock fails closed');
  ok(/clocks are unknown/.test(off3.reason), 'and it says why: ' + off3.reason);

  eq(T.rageGate({ score: 900, myClockMs: 30000, oppClockMs: 30000 }).on, true,
    'level clocks are enough - the condition is at least as much time, not more');
  eq(T.rageGate({ mate: true, myClockMs: 30000, oppClockMs: 20000 }).on, true, 'a forced mate counts as winning');
  eq(T.rageGate({}).on, false, 'no evaluation at all fails closed');
  eq(T.rageGate({ score: 900, myClockMs: 60000, oppClockMs: 30000, ply: 2, cfg: { minPlies: 10 } }).on, false,
    'the grace period is respected when one is configured');
  eq(T.rageGate({ score: 900, myClockMs: 60000, oppClockMs: 59000, cfg: { clockMargin: 5000 } }).on, true,
    'the clock margin is applied to the comparison');
})();

// =====================================================================================
//  the Rage Brain: tactics
// =====================================================================================
(function tactics() {
  const s = { score: 900, mate: false, myClockMs: 60000, oppClockMs: 30000, state: {} };
  T.RAGE_TACTICS.forEach(t => {
    PROBE_FENS.forEach(fen => {
      const ctx = ctxOf(fen);
      const r = T.ragePick(ctx, Object.assign({}, s, { tactic: t.id, state: {} }));
      eq(r.on, true, t.id + ' fires when the gate is open (' + fen.slice(0, 12) + ')');
      ok(ctx.moves.indexOf(r.uci) >= 0, t.id + ' returns a legal move (' + r.uci + ')');
      ok(r.suspended === false || r.suspended === true, t.id + ' reports whether it had to break character');
    });
  });

  // teflon: nothing lands on a square they can take
  const br = ctxOf(BACKRANK);
  const teflon = T.ragePick(br, Object.assign({}, s, { tactic: 'teflon', state: {} }));
  eq(teflon.uci === 'h5d5', false, 'teflon refuses the square the black rook covers');

  // trade refusal: the free queen stays on the board
  const qt = ctxOf(QTAKE);
  const refusal = T.ragePick(qt, Object.assign({}, s, { tactic: 'trade-refusal', state: {} }));
  ok(refusal.uci !== 'e2d3', 'trade refusal does not take the queen (' + refusal.uci + ')');
  const hoard = T.ragePick(qt, Object.assign({}, s, { tactic: 'material-hoarding', state: {} }));
  ok(hoard.uci !== 'e2d3', 'material hoarding refuses the simplification too');

  // clock tactics carry their timing
  eq(T.ragePick(ctxOf(MIDDLE), Object.assign({}, s, { tactic: 'clock-siege', state: {} })).think, 'instant',
    'clock siege plays instantly');
  eq(T.ragePick(ctxOf(MIDDLE), Object.assign({}, s, { tactic: 'the-freeze', state: {} })).think, 'max',
    'the freeze takes the maximum think time');
  eq(T.ragePick(ctxOf(MIDDLE), Object.assign({}, s, { tactic: 'teflon', state: {} })).think, null,
    'an ordinary tactic does not touch the clock');

  // the slow win needs the engine's own ranking
  const lines = [{ move: 'e1d1', type: 'cp', score: 0 }, { move: 'e1d2', type: 'cp', score: 10 },
    { move: 'e1e2', type: 'cp', score: 50 }, { move: 'e1f1', type: 'cp', score: -10 },
    { move: 'e1f2', type: 'cp', score: -50 }];
  const kc = T.makeContext(KINGS, { lines: lines, state: {}, rand: seeded(2) });
  eq(T.ragePick(kc, Object.assign({}, s, { tactic: 'long-goodbye', state: {} })).uci, 'e1d2',
    'the long goodbye plays the slowest move that is still winning');
  eq(T.ragePick(kc, Object.assign({}, s, { tactic: 'the-yawn', state: {} })).uci, 'e1d1',
    'the yawn plays the move that changes the evaluation least');

  // auto mode never repeats the same tactic twice running
  const auto = {};
  const picks = [];
  for (let i = 0; i < 12; i++) {
    const r = T.ragePick(ctxOf(MIDDLE), Object.assign({}, s, { tactic: 'auto', state: auto }));
    picks.push(r.name);
  }
  let repeats = 0;
  for (let i = 1; i < picks.length; i++) if (picks[i] === picks[i - 1]) repeats++;
  eq(repeats, 0, 'auto never picks the same tactic twice in a row (' + picks.slice(0, 4).join(', ') + ')');
  ok(new Set(picks).size > 1, 'and it does vary (' + new Set(picks).size + ' different tactics in 12 moves)');

  // with a real clock gap the brain reaches for the clock tactics
  const gap = {};
  const gapPicks = [];
  for (let i = 0; i < 8; i++) {
    const r = T.ragePick(ctxOf(MIDDLE), { score: 900, myClockMs: 90000, oppClockMs: 8000, tactic: 'auto', state: gap });
    gapPicks.push(T.RAGE_BY_ID[r.tactic].group);
  }
  ok(gapPicks.every(g => g === 'clock'), 'a 80 second clock gap unlocks clock warfare only');
})();

// =====================================================================================
//  frustration index, tilt, telemetry
// =====================================================================================
(function index() {
  const sealed = T.frustrationIndex({ plies: 40, oppCaptures: 0, oppChecks: 0, oppTrades: 0, oppEntries: 0, oppLegalAvg: 12 });
  ok(sealed >= 85, 'a game in which they managed nothing scores high (' + sealed + '%)');
  const open = T.frustrationIndex({ plies: 40, oppCaptures: 5, oppChecks: 6, oppTrades: 3, oppEntries: 12, oppLegalAvg: 34 });
  ok(open < 40, 'a game in which they did plenty scores low (' + open + '%)');
  ok(T.frustrationIndex({}) >= 0 && T.frustrationIndex({}) <= 100, 'the index is always a percentage');
  eq(T.frustrationWord(95), 'absolute', 'the index has words as well as numbers');

  const tilt = T.tiltRead([5000, 5200, 4800, 5100, 900, 800, 700]);
  eq(tilt.ready, true, 'the tilt detector needs four moves before it says anything');
  eq(tilt.tilted, true, 'a collapse in average move time is read as tilt');
  ok(tilt.drop >= 0.35, 'the drop is reported (' + Math.round(tilt.drop * 100) + '%)');
  ok(/dropped/.test(tilt.note), 'and it says so: ' + tilt.note);
  eq(T.tiltRead([1000, 1200]).ready, false, 'two moves is not enough to call anything');
  eq(T.tiltRead([4000, 4000, 4000, 4000, 4100, 3900, 4000]).tilted, false, 'a steady opponent is not tilted');

  const line = T.counterLine({ plies: 47, oppCaptures: 0 });
  ok(/captured: 0/.test(line) && /47/.test(line), 'the counter reads out: ' + line);
  ok(/in check/.test(T.contactLine({ oppChecks: 0, myChecks: 11 })), 'the contact report reads out');
  const dist = T.distanceLine(L.fenBoardMap(START), T.makeContext(START, { state: {} }));
  ok(/Closest enemy piece/.test(dist), 'the distance tracker reads out: ' + dist);
  ok(/Frustration index peaked/.test(T.postGameLine({ plies: 60, oppCaptures: 0, peakFrustration: 94, myClockMs: 124000, oppClockMs: 3000 })),
    'the post-game summary reads out');
  eq(T.fmtClock(65000), '1:05', 'clocks are formatted for humans');
})();

// =====================================================================================
//  commentary, sarcasm, and the confidence meter that lies
// =====================================================================================
(function text() {
  eq(T.COMMENTARY.sarcastic({ evalText: '+2.3', eval: 230, rng: seeded(1) }), '+2.3 (a modest advantage)',
    'the sarcastic eval keeps the real number and adds a comment');
  ok(/\+9\.0/.test(T.COMMENTARY.sarcastic({ evalText: '+9.0', eval: 900, rng: seeded(1) })), 'it keeps the number when crushing too');
  ok(T.COMMENTARY.sarcastic({ evalText: '0.0', eval: 0, rng: seeded(1) }).indexOf('0.0') === 0, 'the number always comes first');

  ok(/412/.test(T.COMMENTARY.eloShame({ elo: 1200, moveElo: 412 })) && /1200/.test(T.COMMENTARY.eloShame({ elo: 1200, moveElo: 412 })),
    'ELO shaming quotes both numbers');
  eq(T.COMMENTARY.eloShame({ elo: 1200, moveElo: 1500 }), '', 'and says nothing when the move was better than the player');

  eq(T.confidenceFor(950, seeded(1)), '99%', 'confidence is total when the engine is winning');
  const winning = T.confidenceFor(600, seeded(1));
  ok(/^[0-9]+%$/.test(winning) && parseInt(winning, 10) >= 88, 'confidence is high for the side that is up (' + winning + ')');
  const losing = T.confidenceFor(-600, seeded(1));
  ok(/^[0-9]+%$/.test(losing) && parseInt(losing, 10) <= 32, 'and collapses for the side that is down (' + losing + ')');

  ok(T.judgmentFor(1200, seeded(1)).length > 0, 'judgment has something to say when crushing');
  ok(T.judgmentFor(-1200, seeded(1)).length > 0, 'and when lost');

  const v = { san: 'Nf3', piece: 'N', capture: false, check: false, mate: false, eval: 0, rng: seeded(4) };
  ['commentator', 'grandpa', 'armchair'].forEach(voice => {
    ok(typeof T.COMMENTARY[voice](v) === 'string' && T.COMMENTARY[voice](v).length > 0, voice + ' has something to say');
  });
  ok(/mate/i.test(T.COMMENTARY.commentator({ san: 'Qh5#', mate: true, eval: 100000, rng: seeded(4) })), 'the commentator calls the mate');
  ok(/F\.|D-|Incomplete/.test(T.COMMENTARY.armchair({ blunder: true, eval: -800, rng: seeded(4) })), 'the armchair GM fails the blunder');

  ok(T.LOADING_LINES.length >= 10, 'the loading theater has enough material to be worth running');
  ok(T.GASLIGHT['Think time'].length > 0, 'gaslight mode has alternative labels for the real controls');
})();

// =====================================================================================
//  helpers
// =====================================================================================
(function helpers() {
  eq(T.fileOf('e4'), 4, 'files are zero-based');
  eq(T.rankOf('e4'), 3, 'ranks are zero-based');
  eq(T.cheb('a1', 'a8'), 7, 'Chebyshev distance on a file');
  eq(T.cheb('a1', 'b2'), 1, 'Chebyshev distance diagonally');
  eq(T.isDark('a1'), true, 'a1 is dark');
  eq(T.isLight('h1'), true, 'h1 is light');
  eq(T.advanceOf('e2', 'w'), 2, 'white measures advancement from its own back rank');
  eq(T.advanceOf('e7', 'b'), 2, 'black measures it the other way');
  eq(T.ownHalf('d4', 'w'), true, 'd4 is white\'s half');
  eq(T.enemyHalf('d5', 'w'), true, 'd5 is not');
  eq(T.quadrantOf('a1'), 0, 'a1 is quadrant zero');
  eq(T.quadrantOf('h8'), 2, 'h8 is quadrant two');
  eq(T.other('w'), 'b', 'the other side');
  eq(T.typeOf('q'), 'Q', 'piece types ignore colour');
  eq(T.sideOfPc('q'), 'b', 'and colour is read separately');
  const inf = T.infoOf('e2e4', L.fenBoardMap(START));
  eq(inf.type, 'P', 'move info knows the piece');
  eq(inf.straight, true, 'and that e2-e4 is a straight move');
  eq(inf.diagonal, false, 'and not a diagonal one');
  eq(T.infoOf('b1c3', L.fenBoardMap(START)).isKnight, true, 'knight moves are recognised');
})();

// =====================================================================================
//  a suspended rule never leaves the engine without a move
// =====================================================================================
(function suspension() {
  const c = ctxOf(START);
  const p = T.pickDirective('full-retreat', c, {});
  eq(p.suspended, true, 'full retreat is suspended in the start position');
  ok(c.moves.indexOf(p.uci) >= 0, 'and the fallback is a legal move rather than nothing');
  eq(T.directiveMoves('nonexistent-rule', c), null, 'an unknown directive id is not a directive');
  eq(T.pickDirective('nonexistent-rule', c, {}), null, 'and picks nothing');
})();

console.log('\n' + (failures ? failures + ' FAILED' : 'all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
