/* Tests for engine limits, immediate auto-play rules, and mate selection.
   Run with: node tests/autoplay.test.js
   These pin down the user-visible promises:
     - Think time is how long the engine searches before it answers AND before auto-play moves, at every ELO
     - Think time 0 uses the first complete result
     - the answer is read from the level's depth, so a long think time does not quietly make 800 ELO play like 3200
     - a normal result is internally consistent (one settled depth)
     - every search has a finite UCI limit
     - auto-play has no extra pace wait: it thinks for the configured time, then dispatches
     - checkmate style decides whether the shortest proven mate is taken; natural mistakes decide whether a low
       level may swap its best line for another candidate
*/
'use strict';
const L = require('../lib.js');

let checks = 0, failures = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; console.error('FAIL: ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

// ---- 1. a normal search reports the deepest depth that has every line
const dump = {
  1: { 1: { depth: 1, multipv: 1, move: 'e2e4' } },
  2: { 1: { depth: 2, multipv: 1, move: 'e2e4' } },
  3: { 1: { depth: 3, multipv: 1, move: 'e2e4' }, 2: { depth: 3, multipv: 2, move: 'd2d4' } },
  4: { 1: { depth: 4, multipv: 1, move: 'g1f3' } }
};
// depth 3 is the deepest one carrying the full set (both lines); the lone depth-4 line is a half-filled
// iteration, so reporting depth 3 keeps all reported lines from the same depth
eq(L.bestDepth(dump), 3, 'the deepest depth holding every line wins over a deeper half-filled one');
eq(L.bestDepth({}), null, 'no lines at all -> no depth');
eq(L.bestDepth({ 1: {}, 2: {} }), null, 'empty depths -> no depth');

// ---- 2. MultiPV: the answer comes from one depth only - the deepest one holding the full set requested
const mpv3 = {
  1: { 1: { move: 'e2e4' }, 2: { move: 'd2d4' }, 3: { move: 'g1f3' } },
  2: { 1: { move: 'e2e4' }, 2: { move: 'd2d4' }, 3: { move: 'g1f3' } },
  3: { 1: { move: 'e2e4' }, 2: { move: 'd2d4' } }        // depth 3 is still being filled in
};
eq(L.bestDepth(mpv3), 2, 'the deepest depth with all three lines is reported, not the half-filled one');
eq(L.firstDepth(mpv3, 3), 1, 'the first complete MultiPV set is depth 1');
eq(L.firstDepth(mpv3, 5), null, 'a depth with fewer lines than asked for is not "complete"');

// ---- 3. instant: the first complete result is the answer, no waiting for the search to finish
eq(L.instantDepth(mpv3, 3), 1, 'instant takes the first full set and never waits for a deeper one');
eq(L.instantDepth({ 1: { 1: { move: 'a' } }, 2: { 1: { move: 'b' } } }, 2), 1,
  'instant takes the depth the engine has moved past when MultiPV cannot be satisfied');
eq(L.instantDepth({ 1: { 1: { move: 'e2e4' } } }, 2), null, 'one lone depth is not an answer yet when more lines were asked for');

// ---- 4. forced position: fewer legal moves than MultiPV, so the depth below the newest one is the answer
const forced = {
  1: { 1: { move: 'h7h8q' }, 2: { move: 'h7g8q' } },      // only two moves exist, MultiPV asked for five
  2: { 1: { move: 'h7h8q' }, 2: { move: 'h7g8q' } }
};
eq(L.instantDepth(forced, 5), 1, 'a depth the engine has already moved past is as complete as it will get');
eq(L.instantDepth({ 1: { 1: { move: 'h7h8q' } } }, 5), null, 'still waiting on the very first depth');

// ---- 5. what to ask the engine for: Think time is the clock, the ELO level is the strength cap
const base = { depth: 7, time: 8, autoplay: false, speed: 0, safetyMs: 2500 };
let lim = L.searchLimits(base);
eq(lim.depth, 0, 'a think time owns the clock: the level depth does not cap the search');
eq(lim.timeMs, 8000, 'the think time becomes the movetime');
eq(lim.playDepth, 7, 'the level depth is kept as the depth to play from');
eq(lim.eager, false, 'a normal search waits for the engine to finish');
ok(L.goCommand(lim).indexOf('depth') < 0, 'with a think time no depth limit is sent, so the time is really used');
eq(L.goCommand(lim), 'go movetime 8000', '400 ELO or 2500 ELO, the engine gets the whole window');

// the promise the user asked for: 5 seconds means 5 seconds at a low level too, not "as long as depth 1 takes"
for (const [eloDepth, elo] of [[1, 400], [3, 800], [7, 1200], [22, 2500], [0, 3200]]) {
  const l = L.searchLimits({ depth: eloDepth, time: 5, safetyMs: 2500 });
  eq(l.timeMs, 5000, 'ELO ' + elo + ' thinks for the full 5s');
  eq(L.goCommand(l), 'go movetime 5000', 'ELO ' + elo + ' sends the same clock as any other level');
  eq(l.playDepth, eloDepth, 'ELO ' + elo + ' still answers from depth ' + eloDepth);
}

lim = L.searchLimits(Object.assign({}, base, { time: 0 }));
eq(lim.depth, 7, 'think time 0 goes back to a depth-bounded instant search');
eq(lim.timeMs, 0, 'max time 0 sends no movetime at all');
eq(lim.eager, true, 'max time 0 is instant: first result, then stop');
ok(L.goCommand(lim).indexOf('movetime') < 0, 'instant does not ask the engine to sit on a clock');

// Current auto-play intentionally does NOT pass a speed field. It searches with its ELO depth and Max time,
// then content.js dispatches the chosen move without a pace timer. Old saved options remain supported below.
lim = L.searchLimits({ depth: 18, time: 8, safetyMs: 2500 });
eq(lim.timeMs, 8000, 'current auto-play search keeps its Max time cap');
eq(lim.eager, false, 'current auto-play waits for its configured result so it can recognize deeper mates');

// ---- 5a. which depth the answer is read from: the level's, so a long think time does not make 800 ELO strong
const dump5 = {
  1: { 1: { move: 'a1a2' } },
  2: { 1: { move: 'a1a2' }, 2: { move: 'b1b2' } },
  3: { 1: { move: 'a1a2' }, 2: { move: 'b1b2' }, 3: { move: 'c1c2' } },
  7: { 1: { move: 'h1h2' }, 2: { move: 'g1g2' }, 3: { move: 'f1f2' } },      // what the engine found later
  8: { 1: { move: 'h1h2' }, 2: { move: 'g1g2' } }                             // half-filled iteration
};
eq(L.reportDepth(dump5, 3), 3, 'the 800 ELO lines are read from depth 3 even though the search went deeper');
eq(L.reportDepth(dump5, 2), 2, 'the level depth is a ceiling, not a target to overshoot');
eq(L.reportDepth(dump5, 0), 7, 'no strength cap: the deepest complete iteration is the answer');
eq(L.reportDepth(dump5, 1), 1, 'a 400 ELO level plays the depth-1 line after the full think time');
eq(L.reportDepth(dump5, 6), 3, 'if the cap falls between iterations, the deepest complete one below it is used');
eq(L.reportDepth({ 5: { 1: { move: 'a1a2' } }, 6: { 1: { move: 'b1b2' } } }, 2), 5,
  'a search that never reached the cap still answers with its first depth');
eq(L.reportDepth({}, 5), null, 'no lines -> no depth');
{
  const d = L.reportDepth(dump5, 3);
  eq(Object.keys(dump5[d]).length, 3, 'the reported depth carries every line, so arrows never mix depths');
}

// ---- 5b. what to actually play: checkmate style + natural mistakes
const eq2 = (pick, uci, msg) => {
  const got = pick && typeof pick === 'object' ? pick.uci : pick;
  ok(got === uci, msg + ' (got ' + JSON.stringify(got) + ', want ' + uci + ')');
};
const pickLines = [
  { move: 'e2e4', type: 'cp', score: 40, depth: 7 },
  { move: 'd2d4', type: 'cp', score: 35, depth: 7 },
  { move: 'g1f3', type: 'cp', score: 30, depth: 7 }
];
const matePick = [
  { move: 'e2e4', type: 'cp', score: 900, depth: 7 },
  { move: 'd2d4', type: 'mate', score: 3, depth: 7 },       // shortest proven mate, but not line 1
  { move: 'a2a4', type: 'mate', score: 5, depth: 7 }
];
// checkmate style
eq2(L.chooseMove(matePick, { elo: 1200, mistakes: false, mateMode: 'shortest', rand: () => 0.5 }).uci, 'd2d4',
  'fewest moves: the shortest proven mate beats a big evaluation and the search order');
eq2(L.chooseMove(matePick, { elo: 1200, mistakes: false, mateMode: 'normal', rand: () => 0.5 }).uci, 'e2e4',
  'regular: the top line of the search, no mate hunting');
eq2(L.chooseMove(pickLines, { elo: 1200, mistakes: false, mateMode: 'shortest', rand: () => 0.5 }).uci, 'e2e4',
  'no mate on the board: mate mode changes nothing');
ok(L.chooseMove(matePick, { elo: 1200, mistakes: false, mateMode: 'shortest' }).mate !== null,
  'the chosen mate line is reported, so the panel can say why it was played');
eq2(L.chooseMove([{ move: 'a2a4', type: 'mate', score: -2, depth: 8 }, { move: 'b2b4', type: 'cp', score: -50, depth: 8 }],
  { elo: 3200, mistakes: false, mateMode: 'shortest' }).uci, 'a2a4',
  'a mate for the opponent is not a winning mate, so the top line stays');
// natural mistakes
eq2(L.chooseMove(pickLines, { elo: 400, mistakes: true, mateMode: 'normal', rand: () => 0.01 }).uci, 'e2e4',
  'a low level with mistakes on still plays the engine move when the roll is clean');
eq(L.chooseMove(pickLines, { elo: 400, mistakes: true, mateMode: 'normal', rand: () => 0.5 }).mistake, true,
  'a 400 ELO slip is flagged, so the panel can say it was a mistake');
ok(L.chooseMove(pickLines, { elo: 400, mistakes: true, mateMode: 'normal', rand: () => 0.5 }).uci !== 'e2e4',
  'a low level with mistakes on does move away from the best line');
eq(L.chooseMove(pickLines, { elo: 400, mistakes: false, mateMode: 'normal', rand: () => 0.5 }).mistake, false,
  'with mistakes off nothing is flagged as a slip');
eq2(L.chooseMove(pickLines, { elo: 400, mistakes: false, mateMode: 'normal', rand: () => 0.0 }).uci, 'e2e4',
  'mistakes off: even 400 ELO plays its best line');
eq2(L.chooseMove(pickLines, { elo: 3200, mistakes: true, mateMode: 'normal', rand: () => 0.0 }).uci, 'e2e4',
  'full engine strength has no error rate, so mistakes on changes nothing there');
ok(matePick.map(l => l.move).includes(L.chooseMove(matePick, { elo: 400, mistakes: true, mateMode: 'shortest', rand: () => 0.5 }).uci),
  'a proven mate is never thrown away for a random slip');
eq(L.chooseMove([], { elo: 400, mistakes: true }), null, 'no legal lines -> nothing to choose');

// Legacy saved speed fields still parse predictably, rather than breaking an upgraded installation.
lim = L.searchLimits(Object.assign({}, base, { autoplay: true, speed: 0 }));
eq(lim.eager, true, 'legacy speed 0 stays compatible with former instant behavior');
lim = L.searchLimits(Object.assign({}, base, { autoplay: true, speed: 0.3 }));
eq(lim.timeMs, 300, 'legacy speed still caps a legacy search');
eq(lim.eager, false, 'a legacy paced search still waits for its own result');
lim = L.searchLimits(Object.assign({}, base, { autoplay: true, speed: 3, time: 0.5 }));
eq(lim.timeMs, 500, 'Max time stays the upper bound when it is smaller than a legacy play speed');
lim = L.searchLimits(Object.assign({}, base, { autoplay: true, speed: 5, time: 0 }));
eq(lim.eager, true, 'Max time 0 wins over a legacy slower play speed');

// ---- 6. never a bare "go": a search with no depth limit and no time cap would run forever
lim = L.searchLimits(Object.assign({}, base, { depth: 0, time: 0 }));
ok(lim.depth || lim.timeMs, 'no depth limit + no time cap still gets a safety cap');
eq(lim.timeMs, 2500, 'the safety cap is used as the movetime');
for (const opt of [
  { depth: 0, time: 0 }, { depth: 0, time: 60 }, { depth: 24, time: 0 },
  { depth: 0, time: 0, autoplay: true, speed: 0 }, { depth: 0, time: 0, autoplay: true, speed: 2 }
]) {
  const l = L.searchLimits(opt), go = L.goCommand(l);
  ok(/^go (depth \d+|movetime \d+)/.test(go) || /^go depth \d+ movetime \d+$/.test(go),
    'go command always carries a limit: ' + JSON.stringify([opt, go]));
}
eq(L.goCommand({ depth: 12, timeMs: 0 }), 'go depth 12', 'depth-only search');
eq(L.goCommand({ depth: 0, timeMs: 250 }), 'go movetime 250', 'time-only search');

// ---- 7. legacy pacing helper (not used by the current immediate auto-play path)
eq(L.paceWait(0, 0), 0, 'zero legacy speed = no wait at all');
eq(L.paceWait(0, 5000), 0, 'zero legacy speed = no wait even after a long search');
eq(L.paceWait(1000, 0), 1000, 'a legacy 1s rhythm waits when the engine was instant');
eq(L.paceWait(1000, 600), 400, 'the legacy wait is measured from when the board was first read');
eq(L.paceWait(1000, 1000), 0, 'a search that already took the legacy rhythm gets no extra wait');
eq(L.paceWait(1000, 5000), 0, 'a slow search is never slowed down further');

// ---- 8. ELO variation remains available to the separate "What would X play?" button
const lines = [{ move: 'e2e4' }, { move: 'd2d4' }, { move: 'g1f3' }];
const moves = lines.map(l => l.move);
eq(L.eloMove('e2e4', moves, 1200, () => 0.99), 'e2e4', 'an accurate roll plays the engine move');
eq(L.eloMove('e2e4', moves, 1200, () => 0.01), moves[0], 'a slip still plays one of the engine lines');
ok(moves.includes(L.eloMove('e2e4', moves, 400, () => 0.5)), 'the low-level slip picks a candidate line');
eq(L.eloMove('e2e4', moves, 3200, () => 0.001), 'e2e4', 'full engine strength never slips');
eq(L.eloMove('e2e4', moves, 2000, () => 0), 'e2e4', '2000+ has no error rate in the table');
eq(L.eloMove('e2e4', [], 400, () => 0), 'e2e4', 'no candidates -> the engine move');
eq(L.eloMove('e2e4', [null, undefined], 400, () => 0), 'e2e4', 'junk candidates are ignored');
// the whole rule, end to end: an instant answer from depth 1 feeds the level pick exactly like a finished search
const instantLines = Object.keys(mpv3[L.instantDepth(mpv3, 3)]).map(k => mpv3[1][k]);
eq(instantLines.length, 3, 'instant answer carries every line of that depth');
ok(instantLines.map(l => l.move).includes(L.eloMove(instantLines[0].move, instantLines.map(l => l.move), 800, () => 0.5)),
  'the level pick works on an instant answer too');

// ---- 9. auto-play mate policy: only a positive UCI mate score is a mate for the side to move; choose the
// shortest such score even when it was not supplied as MultiPV line one.
const mateLines = [
  { move: 'a2a4', type: 'mate', score: 5, depth: 22 },
  { move: 'h2h4', type: 'mate', score: -1, depth: 30 }, // opponent has a mate; never choose it
  { move: 'e2e4', type: 'cp', score: 900, depth: 24 },
  { move: 'd2d4', type: 'mate', score: 3, depth: 20 }
];
eq(L.fastestMateLine(mateLines).move, 'd2d4', 'shortest winning mate wins over candidate ordering');
eq(L.fastestMateLine([{ move: 'a2a4', type: 'mate', score: -2 }]), null,
  'an opponent mating score is not mistaken for a winning mate');
eq(L.fastestMateLine([{ move: 'a2a4', type: 'cp', score: 999 }]), null,
  'a non-mate evaluation does not create a false mate');
eq(L.fastestMateLine([
  { move: 'a2a4', type: 'mate', score: 3, depth: 10 },
  { move: 'b2b4', type: 'mate', score: 3, depth: 16 }
]).move, 'b2b4', 'a deeper line breaks a same-distance mate tie');

console.log((failures ? 'FAILED ' : 'OK ') + checks + ' checks, ' + failures + ' failures');
process.exit(failures ? 1 : 0);
