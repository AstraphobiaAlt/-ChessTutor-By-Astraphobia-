/* Integration test for the panel wiring: it loads the real lib.js + content.js into a jsdom document that
   mimics a chess.com board, talks to a fake UCI engine, and checks what the settings actually do:
     - Think time is the search window at EVERY level (400 ELO + 5s really sends `go movetime 5000`)
     - the move is still read from the level's depth, so the think time does not turn 400 ELO into full engine
     - Think time 0 stays instant (`go depth N`, stopped as soon as a complete answer exists)
     - auto-play dispatches as soon as that search is back; there is no extra pacing timer
     - Checkmate style decides between the fewest-move mate and the regular top line
     - Natural mistakes decides whether a low level swaps its best line for another candidate, and never while a
       proven mate is on the board
     - the new controls are in the panel and are persisted through chrome.storage
   Run with: node tests/panel-logic.test.js       (needs jsdom once: npm install --no-save jsdom)
   Without jsdom installed the file skips itself, so the offline unit tests still run. */
'use strict';
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('SKIP tests/panel-logic.test.js (jsdom not installed - npm install --no-save jsdom)');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MOVE_POOL = ['e2e4', 'd2d4', 'g1f3', 'b1c3', 'a1a2'];      // MultiPV lines, best first

let checks = 0, failures = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.error('FAIL: ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
async function until(pred, ms = 4000) {
  const t0 = Date.now();
  for (; ;) {
    let v;
    try { v = pred(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await tick(5);
  }
}

// the DOM layout chess.com renders: .piece.<colour><type>.square-<file><rank>, file 1 = a
function boardHtml() {
  const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  const cells = [];
  for (let r = 1; r <= 8; r++) for (let f = 1; f <= 8; f++) {
    let pc = null;
    if (r === 1 || r === 2) pc = 'w' + (r === 1 ? back[f - 1] : 'p');
    else if (r === 7 || r === 8) pc = 'b' + (r === 8 ? back[f - 1] : 'p');
    if (pc) cells.push('<div class="piece ' + pc + ' square-' + f + r + '"></div>');
  }
  return '<wc-chess-board class="board">' + cells.join('') + '</wc-chess-board>';
}

/* A UCI engine that answers from `plan`: it searches `plan.depths` iterations with MultiPV lines, and puts a
   `mate in plan.mateScore` score on line `plan.mateOn` of the deepest iteration only - exactly the shape of a
   real search that only proves the mate late. */
function makeEngine(win, frameWin, log, plan) {
  // a real engine answers in a later task, and the tutor registers its UCI waiters after sending, so the fake
  // must never reply synchronously
  const line = l => setTimeout(() => {
    win.dispatchEvent(new win.MessageEvent('message', { data: { ct: true, line: l }, source: frameWin }));
  }, 0);
  return {
    mpv: 1,
    handle(cmd) {
      log.cmds.push(cmd);
      if (cmd === 'uci') {
        line('id name Stockfish 18');
        ['Hash type spin default 16 min 16 max 1024',
          'Threads type spin default 1 min 1 max 8',
          'MultiPV type spin default 1 min 1 max 500',
          'Skill Level type spin default 20 min 0 max 20',
          'Move Overhead type spin default 10 min 0 max 5000',
          'UCI_LimitStrength type button',
          'Use NNUE type button'].forEach(o => line('option name ' + o));
        line('uciok');
      } else if (cmd === 'isready') line('readyok');
      else if (cmd === 'eval') line('NNUE evaluation used, 756732 bytes');
      else if (cmd.indexOf('setoption name MultiPV') === 0) this.mpv = +cmd.split(' value ')[1];
      else if (cmd.indexOf('position fen ') === 0) log.fen = cmd.slice(13);
      else if (cmd.indexOf('go ') === 0) this.search(cmd);
      else if (cmd === 'stop') this.finish();
    },
    search(go) {
      log.go.push(go);
      const mpv = Math.min(this.mpv || 1, MOVE_POOL.length);
      const out = [];
      for (let d = 1; d <= plan.depths; d++) {
        for (let i = 1; i <= mpv; i++) {
          const mate = d === plan.depths && plan.mateOn === i && plan.mateScore;
          out.push('info depth ' + d + ' seldepth ' + (d + 2) + ' multipv ' + i + ' score ' +
            (mate ? 'mate ' + plan.mateScore : 'cp ' + (90 + d - i * 3)) + ' nodes ' + (d * 1000) +
            ' nps 500000 time ' + (d * 40) + ' pv ' + MOVE_POOL[i - 1] + ' e2e4 d7d5');
        }
      }
      clearTimeout(this.timer);
      this.pending = out;
      this.step();
    },
    step() {
      if (!this.pending || !this.pending.length) { this.finish(); return; }
      this.info(this.pending.shift());
      this.timer = setTimeout(() => this.step(), 1);
    },
    finish() { clearTimeout(this.timer); this.pending = []; this.info('bestmove ' + MOVE_POOL[0]); },
    info(l) { log.info.push(l); line(l); }
  };
}

async function boot(settings, plan) {
  const panelHtml = fs.readFileSync(path.join(ROOT, 'panel.html'), 'utf8');
  const dom = new JSDOM('<!doctype html><html><body>' + boardHtml() + '</body></html>',
    { url: 'https://www.chess.com/analysis', runScripts: 'outside-only' });
  const win = dom.window, doc = win.document;
  const log = { cmds: [], info: [], go: [], moves: [], store: null, fen: START };
  const planState = Object.assign({ depths: 4, mateOn: 0, mateScore: 0 }, plan);
  const engine = {};                     // handle on the fake engine, handy when a case needs debugging

  win.chrome = {
    runtime: { getURL: p => (p === 'panel.html' ? 'chrome-extension://x/panel.html' : 'about:blank') },
    storage: {
      local: {
        get: (k, cb) => setTimeout(() => cb({ [k]: settings }), 0),
        set: obj => setTimeout(() => { log.store = JSON.parse(JSON.stringify(obj.chessTutor)); }, 0)
      }
    }
  };
  win.fetch = () => Promise.resolve({ text: () => Promise.resolve(panelHtml) });
  // the page world: the exact FEN on request, and moves only ever go through chess.com's own legal-move list
  const realPost = win.postMessage.bind(win);
  win.postMessage = (msg, o) => {
    if (!msg) return realPost(msg, o);
    if (msg.ctReq) return setTimeout(() => win.dispatchEvent(new win.MessageEvent('message',
      { data: { ctRes: 1, id: msg.id, ok: true, fen: log.fen }, source: win })), 0);
    if (msg.ctMoveReq) {
      const san = { e2e4: 'e4', d2d4: 'd4', g1f3: 'Nf3', b1c3: 'Nc3', a1a2: 'Ra2' }[msg.uci] || null;
      log.moves.push(msg.uci);
      return setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', {
        data: { ctMoveRes: 1, id: msg.id, ok: true, san, reason: null }, source: win
      })), 0);
    }
    return realPost(msg, o);
  };

  win.eval(fs.readFileSync(path.join(ROOT, 'lib.js'), 'utf8'));
  // a deterministic deviation roll: the tests need to know which candidate a low level will pick
  if (settings && settings.__rand !== undefined) win.Math.random = () => settings.__rand;
  let seenWin = null;
  win.__handshake = () => {
    const frame = doc.querySelector('iframe');
    const fw = frame && frame.contentWindow;
    if (!fw) return false;
    // jsdom gives a freshly appended iframe a new Window, so only hook the one the tutor will actually see
    if (fw !== seenWin) { seenWin = fw; return false; }
    if (fw.__ctHooked) return false;
    fw.__ctHooked = true;
    const eng = makeEngine(win, fw, log, planState);
    engine.api = eng;
    fw.postMessage = m => eng.handle(m.ctCmd);
    win.dispatchEvent(new win.MessageEvent('message', { data: { ready: true }, source: fw }));
    eng.handle('uci');                       // the engine answers `uci` on startup
    win.dispatchEvent(new win.MessageEvent('message', {
      data: { ct: true, engineName: 'Stockfish 18', engineKind: 'NNUE lite', idName: 'Stockfish 18', verified: true,
        options: [], hash: 'abc123def456' }, source: fw
    }));
    return true;
  };
  win.eval(fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8'));
  if (!await until(() => win.__handshake())) throw new Error('the engine iframe never appeared');
  if (!await until(() => /confirmed/.test(doc.querySelector('#ct-verify').textContent))) {
    throw new Error('engine never became ready: ' + doc.querySelector('#ct-status').textContent);
  }
  return {
    win, doc, log, engine, plan: planState,
    status: () => doc.querySelector('#ct-status').textContent,
    goCount: () => log.go.length,
    lastGo: () => log.go[log.go.length - 1]
  };
}

const click = (win, node) => node.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const setSelect = (win, node, value) => { node.value = value; node.dispatchEvent(new win.Event('change', { bubbles: true })); };
const setSwitch = (win, node, on) => { node.checked = on; node.dispatchEvent(new win.Event('change', { bubbles: true })); };
const setRange = (win, node, value) => {
  node.value = String(value);
  node.dispatchEvent(new win.Event('input', { bubbles: true }));
  node.dispatchEvent(new win.Event('change', { bubbles: true }));
};

// what auto-play sent to the board for the position the panel booted into (autoplay analyses on its own)
async function firstPlayedMove(t) {
  return (await until(() => t.log.moves[0] || false)) || null;
}

(async () => {
  // ---------- 0. fresh install defaults ----------
  {
    const t = await boot({ elo: 400, auto: false, autoplay: false, open: true });
    const { win, doc } = t;
    ok(doc.querySelector('#ct-mistakes') && doc.querySelector('#ct-mate'), 'the new controls are in the panel');
    eq(doc.querySelector('#ct-mate').value, 'shortest', 'checkmate style defaults to the fewest moves');
    eq(doc.querySelector('#ct-mistakes').checked, true, 'natural mistakes default to on');
    eq(doc.querySelector('#ct-timeval').textContent, '5s', 'the default think time is 5s');
    win.close();
  }

  // ---------- 1. Think time at a low level: the window is really used, the move is still the level's ----------
  {
    const t = await boot({ elo: 400, time: 5, auto: false, autoplay: false, mateMode: 'shortest', mistakes: false, open: true });
    const { win, doc } = t;
    eq(doc.querySelector('#ct-timeval').textContent, '5s', 'Think time reads back the stored value');
    eq(doc.querySelector('#ct-time').closest('.ct-field').querySelector('.ct-label').textContent, 'Think time',
      'the row is labelled as thinking time, not as a maximum');

    const before = t.goCount();
    click(win, doc.querySelector('#ct-analyze'));
    eq(await until(() => t.goCount() > before ? t.lastGo() : false), 'go movetime 5000',
      '400 ELO with a 5s think time searches for 5s instead of stopping at depth 1');
    ok(await until(() => /Thought/.test(t.status())), 'the analysis finished');
    eq(doc.querySelector('#ct-bestmove').textContent, 'e4', 'the move is still read from the 400 ELO (depth 1) line');
    ok(/played from depth 1\/1/.test(t.status()), 'the status names the played depth: ' + t.status());
    ok(/searched to 4/.test(t.status()), 'and shows the engine really kept going inside the window: ' + t.status());
    ok(/mistakes off/.test(doc.querySelector('#ct-tip').textContent), 'the tip explains the active policy');
    win.close();
  }

  // ---------- 2. Think time 0 = instant; the slider re-runs with the new window ----------
  {
    const t = await boot({ elo: 800, time: 0, auto: false, autoplay: false, mateMode: 'shortest', mistakes: false, open: true });
    const { win, doc, log } = t;
    const before = t.goCount();
    click(win, doc.querySelector('#ct-analyze'));
    eq(await until(() => t.goCount() > before ? t.lastGo() : false), 'go depth 3',
      'Think time 0 keeps the depth-bounded instant search (800 ELO = depth 3)');
    ok(await until(() => log.cmds.indexOf('stop') >= 0), 'and stops the engine once a complete answer exists');
    ok(await until(() => /first complete result/.test(t.status())), 'the status says it was the first result: ' + t.status());
    eq(doc.querySelector('#ct-response').textContent, 'Immediate (instant)', 'the dispatch readout explains instant mode');

    const goBefore = t.goCount();
    setRange(win, doc.querySelector('#ct-time'), 2.5);
    eq(doc.querySelector('#ct-timeval').textContent, '2.5s', 'the slider reads back seconds');
    eq(doc.querySelector('#ct-response').textContent, 'After 2.5s thinking', 'the dispatch readout follows the think time');
    ok(await until(() => log.store && log.store.time === 2.5), 'the new think time is stored');
    eq(await until(() => t.goCount() > goBefore ? t.lastGo() : false), 'go movetime 2500',
      'moving the slider re-runs the analysis with the new think time');
    win.close();
  }

  // ---------- 3. auto-play: which move goes out, and when ----------
  const autoplayCase = async (settings, plan) => {
    const t = await boot(Object.assign({ elo: 1200, time: 1, auto: false, autoplay: true, autoplayElo: 3200,
      mateMode: 'shortest', mistakes: false, side: 'me', open: true }, settings), plan);
    const uci = await firstPlayedMove(t);
    // the move is logged when the request goes out, and the panel writes its "Auto-played ..." line one tick
    // later, so wait for that line before reading the status (otherwise the test reads the analyze line and
    // fails at random)
    await until(() => /Auto-played|Auto-play: sent/.test(t.status()) ? true : false);
    const status = t.status(), elotxt = t.doc.querySelector('#ct-elotxt').textContent;
    t.win.close();
    return { uci, status, elotxt };
  };
  const MATE_PLAN = { depths: 4, mateOn: 2, mateScore: 3 };   // mate in 3, proven late, on MultiPV line 2

  {
    const r = await autoplayCase({}, MATE_PLAN);
    eq(r.uci, 'd2d4', 'auto-play plays the shortest proven mate even though the search listed it second');
    ok(/shortest verified mate M3/.test(r.status), 'and labels it: ' + r.status);
    ok(/after 1s of thinking/.test(r.status), 'the move went out right after the think time, no extra wait: ' + r.status);
    ok(/d4/.test(r.elotxt), 'the ELO line names the auto-played move: ' + r.elotxt);
  }
  {
    const r = await autoplayCase({ mateMode: 'normal' }, MATE_PLAN);
    eq(r.uci, 'e2e4', 'Checkmate style "Regular best move": it follows the evaluation instead of the mate');
    ok(!/mate M/.test(r.status), 'and no mate claim is made: ' + r.status);
  }
  {
    const r = await autoplayCase({ autoplayElo: 400, mateMode: 'normal', mistakes: true, __rand: 0.5 }, { depths: 4 });
    eq(r.uci, MOVE_POOL[Math.floor(0.5 * MOVE_POOL.length)],
      'Natural mistakes on: 400 ELO picks a candidate line instead of the best one, after the same 1s think time');
    ok(/natural 400 ELO slip/.test(r.status), 'the panel admits it was a slip: ' + r.status);
  }
  {
    const r = await autoplayCase({ autoplayElo: 400, mateMode: 'normal', mistakes: false }, { depths: 4 });
    eq(r.uci, 'e2e4', 'Natural mistakes off: even 400 ELO plays the best line its search found');
    ok(!/slip/.test(r.status), 'and nothing is flagged as a slip: ' + r.status);
  }
  {
    // 400 ELO plays from depth 1, so that is the depth the mate has to be proven on for it to see it at all
    const r = await autoplayCase({ autoplayElo: 400, mateMode: 'shortest', mistakes: true, __rand: 0.5 },
      { depths: 1, mateOn: 2, mateScore: 3 });
    eq(r.uci, 'd2d4', 'a proven mate is never traded away for a random slip, even at 400 ELO with mistakes on');
  }
  {
    // ... and a level that only sees depth 1 keeps playing its own move when the mate sits deeper
    const r = await autoplayCase({ autoplayElo: 400, mateMode: 'shortest', mistakes: false }, MATE_PLAN);
    eq(r.uci, 'e2e4', 'a mate the level is too shallow to reach does not change what it plays');
  }
  {
    // ---------- 3e. the aggressive hunter: it does reach the deep mate, and it says so ----------
    const t = await boot(Object.assign({ elo: 1200, time: 1, auto: false, autoplay: true, autoplayElo: 400,
      mateMode: 'hunter', huntRisk: 'very', mistakes: false, side: 'me', open: true }), MATE_PLAN);
    const { win, doc } = t;
    eq(await firstPlayedMove(t), 'd2d4',
      'the hunter plays a mate only the deepest iteration proved, at a level whose own depth is 1');
    ok(await until(() => /hunter mate M3/.test(t.status() + ' ' + doc.querySelector('#ct-elotxt').textContent)),
      'the panel labels it as the hunter\'s mate: ' + t.status() + ' | ' + doc.querySelector('#ct-elotxt').textContent);
    ok(t.log.cmds.indexOf('setoption name MultiPV value 12') >= 0,
      'and the hunter asks for a wider candidate list than the other styles');
    win.close();
  }
  {
    // the panel shows what the hunter would play: headline move and arrow 1, not the quiet depth-1 top line
    const t = await boot({ elo: 400, time: 1, auto: false, autoplay: false, mateMode: 'hunter', huntRisk: 'very',
      mistakes: false, open: true }, MATE_PLAN);
    const { win, doc } = t;
    click(win, doc.querySelector('#ct-analyze'));            // auto-analyze is off in this case
    eq(await until(() => doc.querySelector('#ct-bestmove').textContent === 'd4' ? 'd4' : false), 'd4',
      'the headline move is the mate only the deep iteration proved, not the depth-1 best move');
    ok(await until(() => /hunter mate M3/.test(t.status()) ? true : false),
      'and the status says the hunter found it: ' + t.status());
    ok(doc.querySelector('svg.ct-overlay g.ct-a0 polyline'), 'the aggressive move is the first arrow on the board');
    win.close();
  }
  {
    // the hunter must not weaken the other styles while it is off
    const t = await boot({ elo: 1200, time: 1, auto: false, autoplay: false, mateMode: 'shortest',
      mistakes: false, open: true }, MATE_PLAN);
    const { win, doc } = t;
    eq(doc.querySelector('#ct-mate').value, 'shortest', 'Checkmate style reads back the stored value');
    eq(doc.querySelector('#ct-hunt-riskrow').style.display, 'none', 'the hunter risk dial is hidden for other styles');
    eq(doc.querySelector('#ct-mate').options.length, 3, 'the panel offers all three checkmate styles');
    eq(doc.querySelector('#ct-mate').options[1].value, 'hunter', 'the aggressive hunter is the new option');
    const goBefore = t.goCount();
    setSelect(win, doc.querySelector('#ct-mate'), 'hunter');
    eq(doc.querySelector('#ct-hunt-riskrow').style.display, '', 'choosing the hunter reveals its risk dial');
    eq(await until(() => t.log.store && t.log.store.mateMode === 'hunter' ? 'stored' : false), 'stored',
      'the hunter is persisted like the other styles');
    eq(await until(() => t.goCount() > goBefore ? t.lastGo() : false), 'go movetime 1000',
      'and switching to it re-runs the search with the same think time');
    eq(await until(() => t.log.cmds.indexOf('setoption name MultiPV value 12') >= 0 ? 'wide' : false), 'wide',
      'the re-run asks for the hunter\'s candidate list');
    setSelect(win, doc.querySelector('#ct-hunt-risk'), 'sound');
    eq(await until(() => t.log.store && t.log.store.huntRisk === 'sound' ? 'stored' : false), 'stored',
      'the risk setting is persisted');
    win.close();
  }
  {
    const r = await autoplayCase({ autoplayElo: 400, time: 0, mateMode: 'normal', mistakes: false }, { depths: 4 });
    eq(r.uci, 'e2e4', 'Think time 0 auto-plays the first complete result');
    ok(/instant/.test(r.status), 'and says it played instantly: ' + r.status);
  }

  // ---------- 4a. the Natural mistakes switch: the pick changes and the setting is stored ----------
  {
    const t = await boot({ elo: 400, time: 2, auto: false, autoplay: false, mateMode: 'shortest',
      mistakes: true, open: true, __rand: 0.5 }, { depths: 4 });
    const { win, doc, log } = t;
    const before = t.goCount();
    click(win, doc.querySelector('#ct-analyze'));
    ok(await until(() => t.goCount() > before), 'the position gets analysed');
    click(win, doc.querySelector('#ct-elomove'));
    ok(await until(() => /a likely inaccuracy at 400 ELO/.test(doc.querySelector('#ct-elotxt').textContent)),
      'with mistakes on, the ELO button answers with a candidate line: ' + doc.querySelector('#ct-elotxt').textContent);
    ok(!/^e4 /.test(doc.querySelector('#ct-elotxt').textContent), 'and it is not the engine move: ' + doc.querySelector('#ct-elotxt').textContent);
    const stored = log.store;
    setSwitch(win, doc.querySelector('#ct-mistakes'), false);
    ok(await until(() => log.store.mistakes === false), 'turning Natural mistakes off is stored');
    eq(log.store.time, 2, 'and the rest of the settings ride along');
    click(win, doc.querySelector('#ct-elomove'));
    ok(await until(() => /mistakes are turned off/.test(doc.querySelector('#ct-elotxt').textContent)),
      'with mistakes off the ELO button matches the engine move: ' + doc.querySelector('#ct-elotxt').textContent);
    win.close();
  }

  // ---------- 4b. the Checkmate style switch: re-runs the search, changes the pick, is stored ----------
  {
    const t = await boot({ elo: 3200, time: 2, auto: false, autoplay: false, mateMode: 'shortest',
      mistakes: false, open: true }, { depths: 4, mateOn: 2, mateScore: 3 });
    const { win, doc, log } = t;
    const go0 = t.goCount();
    click(win, doc.querySelector('#ct-analyze'));
    ok(await until(() => t.goCount() > go0), 'the position was analysed');
    ok(await until(() => /Thought/.test(t.status())), 'and the answer is in: ' + t.status());
    click(win, doc.querySelector('#ct-elomove'));
    ok(await until(() => /mate in 3/.test(doc.querySelector('#ct-elotxt').textContent)),
      'fewest-move mode plays the proven mate: ' + doc.querySelector('#ct-elotxt').textContent);
    const goBefore = t.goCount();
    setSelect(win, doc.querySelector('#ct-mate'), 'normal');
    eq(await until(() => t.goCount() > goBefore ? t.lastGo() : false), 'go movetime 2000',
      'changing Checkmate style re-runs the search with the same think time');
    ok(await until(() => log.store.mateMode === 'normal'), 'and is stored');
    ok(await until(() => /first complete|Thought/.test(t.status())), 'the re-run finished: ' + t.status());
    click(win, doc.querySelector('#ct-elomove'));
    await tick(120);
    ok(/^e4 /.test(doc.querySelector('#ct-elotxt').textContent),
      'regular mode goes back to the top line of the search: ' + doc.querySelector('#ct-elotxt').textContent);
    ok(!/mate in/.test(doc.querySelector('#ct-elotxt').textContent), 'and does not mention the mate');
    ok(/regular best move/.test(doc.querySelector('#ct-tip').textContent), 'the tip reflects the mode');
    win.close();
  }

  console.log((failures ? 'FAILED ' : 'OK ') + checks + ' checks, ' + failures + ' failures');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERROR: ' + ((e && e.stack) || e)); process.exit(1); });
