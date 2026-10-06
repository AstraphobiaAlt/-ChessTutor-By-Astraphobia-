/* Tests for the free-dragging panel geometry (lib.js -> panelGeom).
   Run with:  node tests/panel-geom.test.js
   The panel is dragged freely and the walls do not stop it; these checks pin down the promises the UI makes:
     - a panel that hangs past a wall always leaves a grab strip on that wall, on screen, over the panel
     - a panel with more than KEEP px outside a wall is "hidden" in that direction (so a reveal may pull it out)
     - a panel fully on screen is never hidden, so pushing it back in always restores it whole
     - the grab strips never fall outside the viewport and never cover an edge the panel does not touch */
'use strict';
const L = require('../lib.js');

const KEEP = 22;
let checks = 0, failures = 0;

function ok(cond, msg) {
  checks++;
  if (!cond) { failures++; console.error('FAIL: ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + a + ', want ' + b + ')'); }

function geom(p, v) { return L.panelGeom(p, v, KEEP); }
const rect = (x, y, w, h) => ({ x, y, w, h });
function covers(strip, area) {            // does the strip overlap the panel's on-screen part?
  const a = strip.rect, b = area;
  return Math.max(a.x, b.x) < Math.min(a.x + a.w, b.x + b.w) && Math.max(a.y, b.y) < Math.min(a.y + a.h, b.y + b.h);
}
function visible(panel, v) {
  return rect(Math.max(0, panel.x), Math.max(0, panel.y),
    Math.max(0, Math.min(panel.x + panel.w, v.w) - Math.max(0, panel.x)),
    Math.max(0, Math.min(panel.y + panel.h, v.h) - Math.max(0, panel.y)));
}

// ---- 1. panel fully on screen: nothing hidden, no strips
let g = geom(rect(600, 400, 272, 420), { w: 1200, h: 900 });
eq(g.hidden, null, 'on-screen panel is not hidden');
eq(g.strips.length, 0, 'on-screen panel needs no grab strips');

// ---- 2. flush against each wall: still not hidden, still no strips
for (const p of [rect(0, 400, 272, 420), rect(1200 - 272, 400, 272, 420), rect(600, 0, 272, 420), rect(600, 900 - 420, 272, 420)]) {
  g = geom(p, { w: 1200, h: 900 });
  eq(g.hidden, null, 'flush panel at ' + JSON.stringify(p) + ' is not hidden');
  eq(g.strips.length, 0, 'flush panel at ' + JSON.stringify(p) + ' needs no strips');
}

// ---- 3. slightly past a wall (< KEEP): the panel itself is still grabbable, so no "hidden" state, but the
//         wall does get a strip (it covers the part that pokes through)
g = geom(rect(-10, 400, 272, 420), { w: 1200, h: 900 });
eq(g.hidden, null, '10px past the wall is not hidden yet');
eq(g.strips.length, 1, '10px past the wall still gets a strip');
eq(g.strips[0].dir, 'l', 'strip is on the left wall');

// ---- 4. pushed through each wall: hidden in that direction, one strip exactly on that wall
const cases = [
  ['l', rect(-250, 400, 272, 420)], ['r', rect(1180, 400, 272, 420)],
  ['t', rect(600, -200, 272, 420)], ['b', rect(600, 700, 272, 420)]
];
for (const [dir, p] of cases) {
  g = geom(p, { w: 1200, h: 900 });
  eq(g.hidden, dir, 'pushed through the ' + dir + ' wall -> hidden ' + dir);
  ok(g.strips.some(s => s.dir === dir), 'pushed through the ' + dir + ' wall -> strip on that wall');
}

// ---- 5. the left-wall strip: sits on the wall, covers the part of the panel that pokes in, stays on screen
g = geom(rect(-250, 400, 272, 420), { w: 1200, h: 900 });
let s = g.strips.find(x => x.dir === 'l');
eq(s.rect.x, 0, 'left strip is flush with the left wall');
eq(s.rect.w, KEEP, 'left strip is KEEP wide');
ok(s.rect.y >= 0 && s.rect.y + s.rect.h <= 900, 'left strip stays on screen vertically');
ok(covers(s, visible(rect(-250, 400, 272, 420), { w: 1200, h: 900 })), 'left strip covers the part poking in');

// ---- 6. a corner: two walls poked through -> two strips, both usable
g = geom(rect(-250, 700, 272, 420), { w: 1200, h: 900 });
ok(g.strips.some(x => x.dir === 'l') && g.strips.some(x => x.dir === 'b'), 'corner poke leaves two strips');
for (const st of g.strips) {
  ok(st.rect.x >= 0 && st.rect.x + st.rect.w <= 1200 && st.rect.y >= 0 && st.rect.y + st.rect.h <= 900,
    'corner strip ' + st.dir + ' stays inside the viewport');
}

// ---- 7. random sweep: invariants hold for anything the drag can produce, on desktop and phone viewports
const views = [{ w: 1200, h: 900 }, { w: 1920, h: 1080 }, { w: 390, h: 844 }, { w: 300, h: 260 }];
let rng = 1234567;
const rand = n => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * n;
for (const v of views) {
  for (let i = 0; i < 4000; i++) {
    const w = 60 + rand(400), h = 60 + rand(500);
    // drag positions: anywhere, wall-clamped (post-release) or deeper (mid-drag)
    const x = -(w - KEEP) + rand(v.w - KEEP + (w - KEEP) + 400) - 200;
    const y = -(h - KEEP) + rand(v.h - KEEP + (h - KEEP) + 400) - 200;
    const p = rect(x, y, w, h);
    g = geom(p, v);
    const over = g.over;
    const worst = Math.max(over.l, over.r, over.t, over.b);
    ok(g.hidden === null ? worst <= KEEP : over[g.hidden] > KEEP,
      'hidden agrees with the deepest wall poke ' + JSON.stringify([p, v, g.hidden, over]));
    const vis = visible(p, v);
    for (const st of g.strips) {
      ok(over[st.dir] > 0.5, 'strip ' + st.dir + ' only exists for a wall the panel really pokes through');
      const vertical = st.dir === 'l' || st.dir === 'r';
      ok(vertical ? st.rect.x >= 0 && st.rect.x + st.rect.w <= v.w : st.rect.y >= 0 && st.rect.y + st.rect.h <= v.h,
        'strip ' + st.dir + ' stays inside the viewport ' + JSON.stringify([p, v, st]));
      if (vis.w > 0 && vis.h > 0) ok(covers(st, vis), 'strip ' + st.dir + ' is grabbable over the panel ' + JSON.stringify([p, v, st]));
    }
    // count: one strip per wall the panel hangs past (sub-pixel overshoot is ignored, it cannot be grabbed)
    const touching = ['l', 'r', 't', 'b'].filter(d => over[d] > 0.5);
    ok(g.strips.length === touching.length, 'one strip per poked wall ' + JSON.stringify([p, v, g.strips.length, touching]));
  }
}

// ---- 8. KEEP is the contract: a panel clamped to the limit still shows exactly a KEEP px sliver
for (const v of views) {
  for (const [w, h] of [[272, 420], [500, 700], [90, 120]]) {
    for (const [x, y] of [[-(w - KEEP), -(h - KEEP)], [v.w - KEEP, v.h - KEEP], [-(w - KEEP), v.h - KEEP]]) {
      const p = rect(x, y, w, h);
      g = geom(p, v);
      ok(g.hidden !== null, 'clamped-to-the-limit panel is still pull-back-able ' + JSON.stringify([p, v]));
      ok(g.strips.length >= 1, 'clamped-to-the-limit panel still has a grab strip ' + JSON.stringify([p, v]));
    }
  }
}

// ---- 9. nothing on screen at all (e.g. the panel is display:none): no strips, nothing hidden
g = geom(rect(0, 0, 0, 0), { w: 1200, h: 900 });
eq(g.strips.length, 0, 'hidden panel leaves no strips behind');
eq(g.hidden, null, 'hidden panel is not "deep in a wall"');

console.log((failures ? 'FAILED ' : 'OK ') + checks + ' checks, ' + failures + ' failures');
process.exit(failures ? 1 : 0);
