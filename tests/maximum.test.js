'use strict';
const assert = require('node:assert/strict');
const L = require('../lib.js');
const G = require('../game.js');
// lib.js re-exports the single search-command builder from game.js
assert.equal(L.goCommand({ depth: 12, timeMs: 0 }), 'go depth 12');
assert.equal(L.goCommand(G.clockLimits({ time: 0 })), 'go movetime 1000');
const max = G.clockLimits({ time: 0 });
assert.equal(max.playDepth, 0);
assert.equal(max.eager, false);
assert.equal(max.clockOk, false);
const clocks = { white: 300000, black: 200000, whiteRes: 1000, blackRes: 1000, whiteActive: true, blackActive: false, ts: 5 };
assert.equal(L.goCommand(G.clockLimits({ time: 5, clocks, mover: 'w', now: 5, increment: { incMs: 0, note: '+0s' } })),
  'go wtime 298500 btime 200000 winc 0 binc 0');
assert.equal(L.goCommand(G.clockLimits({ time: 5, clocks: Object.assign({}, clocks, { white: NaN }), mover: 'w' })), 'go movetime 5000');
assert.equal(L.goCommand(G.clockLimits({ time: 5, clocks: Object.assign({}, clocks, { white: 0 }), mover: 'w' })), 'go movetime 5000');
console.log('Maximum Strength clock/limit tests passed');
