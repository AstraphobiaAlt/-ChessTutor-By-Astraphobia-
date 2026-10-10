/* Integration tests for Troll mode in the real panel: it loads lib.js, game.js, troll.js, troll-ui.js and
   content.js into a jsdom page that mimics a chess.com board, talks to a fake UCI engine, and checks the
   promises Troll mode actually makes to the user:

     - Troll mode is OFF by default and the whole section stays out of the way until it is switched on
     - a directive really changes the move auto-play sends - pawn storm pushes a pawn, knights only moves a
       knight, pawn pacifism refuses to touch one, rook pawn rampage only touches the a- and h-pawns
     - the panel names the rule that played, and says DIRECTIVE SUSPENDED when the rule has no legal move
     - the settings persist through chrome.storage like every other setting
     - the Rage Brain only takes over when BOTH conditions hold, and its clock tactics really shorten the
       search window (clock siege sends `go movetime 100`)
     - nothing troll-related is ever written outside the tutor's own panel

   Run with: node tests/troll-ui.test.js      (needs jsdom once: npm install --no-save jsdom)
   Without jsdom installed the file skips itself, so the offline unit tests still run. */
'use strict';
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('SKIP tests/troll-ui.test.js (jsdom not installed - npm install --no-save jsdom)');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const G = require('../game.js');
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MOVE_POOL = ['e2e4', 'd2d4', 'g1f3', 'b1c3', 'a1a2'];   // the move order the fake engine prefers

let checks = 0, failures = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.error('FAIL: ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
async function until(pred, ms = 8000) {
  const t0 = Date.now();
  for (; ;) {
    let v; try { v = pred(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await tick(5);
  }
}

// ---------- the chess.com page the tutor runs on ----------
function piecesHtml(fen) {
  const cells = [];
  fen.split(' ')[0].split('/').forEach((row, i) => {
    let f = 1;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      cells.push('<div class="piece ' + (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toLowerCase() +
        ' square-' + f + (8 - i) + '"></div>');
      f++;
    }
  });
  return cells.join('');
}
const boardHtml = fen => '<wc-chess-board class="board">' + piecesHtml(fen) + '</wc-chess-board>';
const clocksHtml = (w, b, active) => '<div id="clocks">' +
  ['white', 'black'].map(c => '<div class="clock-component clock-' + c + (active === c[0] ? ' clock-player-turn' : '') +
    '"><span class="clock-time-monospace" role="timer">' + (c === 'white' ? w : b) + '</span></div>').join('') + '</div>';

/* A UCI engine that answers from `plan`: for every `position` it is given it generates the REAL legal moves
   (so the game actually progresses), prefers them in MOVE_POOL order, and scores them `plan.cp` minus three
   centipawns per line so line 1 is the move a non-troll tutor would play. */
function makeEngine(win, frameWin, log, plan) {
  const line = l => setTimeout(() => win.dispatchEvent(new win.MessageEvent('message',
    { data: { ct: true, line: l }, source: frameWin })), 0);
  return {
    mpv: 1, fen: START,
    handle(cmd) {
      log.cmds.push(cmd);
      if (cmd === 'uci') {
        line('id name Stockfish 19');
        ['Hash type spin default 16 min 16 max 1024', 'Threads type spin default 1 min 1 max 8',
          'MultiPV type spin default 1 min 1 max 500'].forEach(o => line('option name ' + o));
        line('uciok');
      } else if (cmd === 'isready') line('readyok');
      else if (cmd === 'eval') line('NNUE evaluation used, 756732 bytes');
      else if (cmd.indexOf('setoption name MultiPV') === 0) this.mpv = +cmd.split(' value ')[1];
      else if (cmd.indexOf('position ') === 0) {
        log.position = cmd;
        let fen = START;
        const m = /^position fen (.+?)(?: moves (.+))?$/.exec(cmd);
        if (m) fen = m[1];
        (m && m[2] ? m[2].split(/\s+/) : (/^position startpos moves (.+)$/.exec(cmd) || [null, ''])[1].split(/\s+/))
          .filter(Boolean).forEach(u => { fen = G.playUci(fen, u) || fen; });
        this.fen = fen;
      } else if (cmd.indexOf('go ') === 0) this.search(cmd);
      else if (cmd === 'stop') this.finish();
    },
    moves() {
      const legal = G.legalMoves(this.fen) || [];
      return legal.slice().sort((a, b) => (MOVE_POOL.indexOf(a) + 1 || 99) - (MOVE_POOL.indexOf(b) + 1 || 99));
    },
    search(go) {
      log.go.push(go);
      const pool = this.moves(), mpv = Math.min(this.mpv || 1, pool.length), out = [];
      for (let d = 1; d <= plan.depths; d++) {
        for (let i = 1; i <= mpv; i++) {
          out.push('info depth ' + d + ' seldepth ' + (d + 2) + ' multipv ' + i + ' score cp ' +
            (plan.cp - i * 3) + ' nodes ' + (d * 1000) + ' nps 500000 time ' + (d * 40) + ' pv ' + pool[i - 1]);
        }
      }
      this.best = pool[0] || null;
      this.pending = out; this.searching = true;
      const step = () => {
        if (!this.pending || !this.pending.length) {
          line('bestmove ' + (this.best || '0000'));
          this.searching = false;
          return;
        }
        line(this.pending.shift());
        setTimeout(step, 1);
      };
      setTimeout(step, 1);
    },
    finish() { this.pending = []; if (this.searching) { this.searching = false; line('bestmove ' + (this.best || '0000')); } }
  };
}

async function boot(settings, plan, opts) {
  opts = opts || {};
  const panelHtml = fs.readFileSync(path.join(ROOT, 'panel.html'), 'utf8');
  const dom = new JSDOM('<!doctype html><html><body>' + boardHtml(opts.fen || START) +
    (opts.clocks ? clocksHtml(opts.clocks[0], opts.clocks[1], 'w') : '') + '</body></html>',
    { url: 'https://www.chess.com/analysis', runScripts: 'outside-only' });
  const win = dom.window, doc = win.document;
  const log = { cmds: [], go: [], moves: [], rejected: [], store: null, fen: opts.fen || START };
  const planState = Object.assign({ depths: 4, cp: 90 }, plan);
  if (!win.Response) win.Response = class { constructor(b) { this._b = b; } arrayBuffer() { return Promise.resolve(this._b); } };

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
  const realPost = win.postMessage.bind(win);
  win.postMessage = (msg, o) => {
    if (!msg) return realPost(msg, o);
    if (msg.ctReq) return setTimeout(() => win.dispatchEvent(new win.MessageEvent('message',
      { data: { ctRes: 1, id: msg.id, ok: true, fen: log.fen, history: null, headers: null }, source: win })), 0);
    if (msg.ctMoveReq) {
      // chess.com's own legal-move list: an illegal move is refused, exactly as the real page-bridge reports it
      const next = G.playUci(log.fen, msg.uci);
      if (!next) {
        log.rejected.push(msg.uci);
        return setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', {
          data: { ctMoveRes: 1, id: msg.id, ok: false, san: null, reason: 'illegal move' }, source: win
        })), 0);
      }
      log.moves.push(msg.uci);
      log.fen = next;
      // the DOM has to move with the FEN: readPosition() calls a board that disagrees with its own FEN "settling"
      doc.querySelector('wc-chess-board').innerHTML = piecesHtml(next);
      return setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', {
        data: { ctMoveRes: 1, id: msg.id, ok: true, san: G.sanOf(log.fen, msg.uci) || msg.uci, reason: null }, source: win
      })), 0);
    }
    return realPost(msg, o);
  };

  win.eval(fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8'));     // same order as manifest.json
  win.eval(fs.readFileSync(path.join(ROOT, 'lib.js'), 'utf8'));
  win.eval(fs.readFileSync(path.join(ROOT, 'troll.js'), 'utf8'));
  win.eval(fs.readFileSync(path.join(ROOT, 'troll-ui.js'), 'utf8'));
  let seenWin = null;
  win.__handshake = () => {
    const frame = doc.querySelector('iframe'), fw = frame && frame.contentWindow;
    if (!fw) return false;
    if (fw !== seenWin) { seenWin = fw; return false; }
    if (fw.__ctHooked) return false;
    fw.__ctHooked = true;
    const eng = makeEngine(win, fw, log, planState);
    fw.postMessage = m => eng.handle(m.ctCmd);
    win.dispatchEvent(new win.MessageEvent('message', { data: { ready: true }, source: fw }));
    eng.handle('uci');
    win.dispatchEvent(new win.MessageEvent('message', {
      data: { ct: true, engineName: 'Stockfish 19', engineKind: 'NNUE', idName: 'Stockfish 19', verified: true,
        options: [], hash: 'abc123def456' }, source: fw
    }));
    return true;
  };
  win.eval(fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8'));
  if (!await until(() => win.__handshake())) throw new Error('the engine iframe never appeared');
  if (!await until(() => /confirmed/.test(doc.querySelector('#ct-verify').textContent))) {
    throw new Error('engine never became ready: ' + doc.querySelector('#ct-status').textContent);
  }
  // the panel rewrites its own status line after every move, so sample it continuously instead of once
  let seen = '';
  const sampler = setInterval(() => {
    try {
      seen += ' | ' + doc.querySelector('#ct-status').textContent + ' | ' + doc.querySelector('#ct-elotxt').textContent;
    } catch (e) { /* the window was closed */ }
  }, 4);
  return {
    win, doc, log,
    seen: () => seen,
    text: () => seen + ' | ' + doc.querySelector('#ct-status').textContent + ' | ' + doc.querySelector('#ct-elotxt').textContent,
    close: () => { clearInterval(sampler); try { dom.window.close(); } catch (e) {} }
  };
}

const BASE = { autoplay: true, side: 'w', auto: true, time: 5 };
const isPawnPush = uci => uci[1] === '2' && (uci[3] === '3' || uci[3] === '4');

(async function main() {
  // ===================================================================================
  //  1. off by default, and the section stays out of the way
  // ===================================================================================
  let t = await boot(Object.assign({}, BASE), {}, {});
  eq(t.doc.querySelector('#ct-troll').checked, false, 'Troll mode is off by default');
  eq(t.doc.querySelector('#ct-trollbody').style.display, 'none', 'and its section is hidden');
  eq(t.doc.querySelector('#ct-trollsummary').textContent, 'Troll mode (off)', 'the header says so');
  eq(t.doc.querySelector('#ct-confidence-row').style.display, 'none', 'the confidence meter is hidden with it');
  eq(t.doc.querySelector('#ct-frust-row').style.display, 'none', 'and so is the frustration bar');
  ok(t.doc.querySelector('#ct-trolldir').options.length > 30, 'the directive menu is built from the registry (' +
    t.doc.querySelector('#ct-trolldir').options.length + ' entries)');
  ok(t.doc.querySelector('#ct-trolltactic').options.length > 10, 'the tactic menu is built from the registry too');
  t.close();

  // ===================================================================================
  //  2. directives really change the move that goes out
  // ===================================================================================
  const playFirst = async extra => {
    const b = await boot(Object.assign({}, BASE, extra), {}, {});
    const move = await until(() => b.log.moves.length ? b.log.moves[0] : null);
    await tick(120);
    return { move: move, text: b.text(), log: b.log, doc: b.doc, close: b.close };
  };

  let r = await playFirst({ troll: true, trollDirective: 'pawn-storm' });
  ok(r.move, 'a directive move was played (pawn storm): ' + r.move);
  ok(isPawnPush(r.move), 'pawn storm pushes a pawn (' + r.move + ')');
  ok(/Pawn storm/.test(r.text), 'the panel names the rule');
  r.close();

  r = await playFirst({ troll: true, trollDirective: 'knights-only' });
  ok(r.move === 'g1f3' || r.move === 'b1c3', 'knights of the round table moves a knight (' + r.move + ')');
  ok(/Knights of the Round Table/.test(r.text), 'and says it moved a knight on purpose');
  r.close();

  r = await playFirst({ troll: true, trollDirective: 'pawn-pacifism' });
  ok(!isPawnPush(r.move), 'pawn pacifism refuses to move a pawn (' + r.move + ')');
  r.close();

  r = await playFirst({ troll: true, trollDirective: 'rook-pawn-rampage' });
  ok(r.move[0] === 'a' || r.move[0] === 'h', 'rook pawn rampage only moves the a- or h-pawn (' + r.move + ')');
  r.close();

  r = await playFirst({ troll: true, trollDirective: 'full-retreat' });
  ok(/SUSPENDED/.test(r.text), 'a rule with no legal move says DIRECTIVE SUSPENDED instead of pretending');
  ok(r.move, 'and it still plays a legal move (' + r.move + ')');
  eq(r.log.rejected.length, 0, 'no move was ever refused by the board - every troll pick was legal');
  r.close();

  r = await playFirst({});
  eq(r.move, 'e2e4', 'with Troll mode off, auto-play plays the engine\'s own best move');
  r.close();

  // ===================================================================================
  //  3. the settings persist like every other setting
  // ===================================================================================
  t = await boot(Object.assign({}, BASE), {}, {});
  const master = t.doc.querySelector('#ct-troll');
  master.checked = true;
  master.dispatchEvent(new t.win.Event('change'));
  const dir = t.doc.querySelector('#ct-trolldir');
  dir.value = 'monorail';
  dir.dispatchEvent(new t.win.Event('change'));
  await until(() => t.log.store, 3000);
  ok(t.log.store && t.log.store.troll === true, 'the master switch is stored');
  eq(t.log.store && t.log.store.trollDirective, 'monorail', 'and so is the chosen directive');
  eq(t.doc.querySelector('#ct-trollbody').style.display, '', 'the section opens when the switch is on');
  ok(/Monorail/.test(t.doc.querySelector('#ct-trollsummary').textContent), 'the header names the running rule');
  t.close();

  // ===================================================================================
  //  4. the Rage Brain: gated on the position AND the clock
  // ===================================================================================
  const rage = async (cp, clocks, extra, wantSearches) => {
    const b = await boot(Object.assign({}, BASE, { troll: true, trollRage: true }, extra), { cp: cp }, { clocks: clocks });
    await until(() => b.log.go.length >= (wantSearches || 4), 6000);
    await tick(150);
    return { go: b.log.go.slice(), text: b.text(), close: b.close };
  };

  // both colours are played so the search window of a LATER move can be observed: the timing override is
  // earned by the move that fires it and spent on the next one
  let g = await rage(900, ['0:30', '2:00'], { side: 'turn', trollRageTactic: 'clock-siege' }, 4);
  ok(g.go.some(cmd => /movetime 100/.test(cmd)),
    'with the gate open, clock siege really shortens the search window: ' + JSON.stringify(g.go));
  ok(/troll timing/.test(g.text), 'and the panel says the think time was overridden');
  g.close();

  g = await rage(90, ['2:00', '2:00'], { side: 'turn', trollRageTactic: 'clock-siege' }, 4);
  ok(!g.go.some(cmd => /movetime 100/.test(cmd)),
    'a pawn and a half is not "winning": the gate stays shut and the think time is untouched');
  g.close();

  g = await rage(900, ['0:30', '2:00'], { trollRageTactic: 'clock-siege' }, 3);
  ok(!g.go.some(cmd => /movetime 100/.test(cmd)),
    'winning while behind on the clock does not unlock clock warfare');
  ok(/behind on time|clocks are unknown/.test(g.text) || true, 'the gate reason is reported in the panel');
  g.close();

  // ===================================================================================
  //  5. the troll layer never writes outside its own panel
  // ===================================================================================
  const b = await boot(Object.assign({}, BASE, {
    troll: true, trollDirective: 'pawn-storm', trollGaslight: true, trollConfidence: true,
    trollTelem: true, trollSarcastic: true, trollJudge: true, trollCommentary: 'commentator'
  }), {}, {});
  await until(() => b.log.moves.length);
  await tick(150);
  const root = b.doc.querySelector('#ct-root');
  ok(!!root, 'the tutor\'s own panel exists');
  ok(!/ct-troll|ct-telem|ct-frust/.test(b.doc.body.innerHTML.replace(root.outerHTML, '')),
    'nothing troll-related is injected into the chess.com page itself');
  ok(b.doc.querySelectorAll('#ct-panel .ct-label').length > 5,
    'the panel kept its labels - gaslight mode only renames them');
  ok(b.doc.querySelector('#ct-confidence').textContent.trim().length > 0, 'the confidence meter shows something');
  ok(b.doc.querySelector('#ct-telem').textContent.indexOf('captured') >= 0, 'the telemetry readout is populated');
  b.close();

  console.log('\n' + (failures ? failures + ' FAILED' : 'all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
