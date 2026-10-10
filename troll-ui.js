/* Chess Tutor - TROLL MODE, the DOM and audio half (troll.js is the pure logic).

   Everything here pranks the USER or decorates the user's own panel. Nothing in this file talks to an
   opponent: no chat, no emotes, no network, no attempt to make a real person's game worse. The taunts are
   rendered where only the person running the extension can read them.

   The module is installed by content.js once the panel exists and is handed a small set of hooks; it never
   reaches into content.js's internals beyond those. */
(function (root) {
  'use strict';

  var T = function () { return root.CTTroll; };

  // =====================================================================================
  //  audio - everything is synthesised, so the extension ships no media and works offline
  // =====================================================================================
  var actx = null, audioBroken = false;
  function audio() {
    try {
      if (audioBroken) return null;
      if (!actx) {
        var C = root.AudioContext || root.webkitAudioContext;
        if (!C) { audioBroken = true; return null; }
        actx = new C();
      }
      if (actx.state === 'suspended' && actx.resume) actx.resume();
      return actx;
    } catch (e) { audioBroken = true; return null; }
  }
  function gainEnv(a, g, t, peak, attack, hold, release) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }
  function noiseBuffer(a, secs) {
    var len = Math.max(1, Math.floor(a.sampleRate * secs));
    var buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  var SFX = {
    trombone: function () {                       // the blunder
      var a = audio(); if (!a) return; var t = a.currentTime;
      var o = a.createOscillator(), g = a.createGain(), f = a.createBiquadFilter();
      o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = 950;
      o.frequency.setValueAtTime(311, t); o.frequency.exponentialRampToValueAtTime(98, t + 0.95);
      gainEnv(a, g, t, 0.2, 0.05, 0.45, 0.5);
      o.connect(f); f.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 1.1);
    },
    airhorn: function () {                        // the mate
      var a = audio(); if (!a) return; var t = a.currentTime;
      [233, 311, 466].forEach(function (fr) {
        var o = a.createOscillator(), g = a.createGain();
        o.type = 'square'; o.frequency.value = fr;
        gainEnv(a, g, t, 0.085, 0.03, 0.45, 0.25);
        o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.85);
      });
    },
    scratch: function () {                        // the hung queen
      var a = audio(); if (!a) return; var t = a.currentTime;
      var s = a.createBufferSource(); s.buffer = noiseBuffer(a, 0.5);
      s.playbackRate.setValueAtTime(1.7, t);
      s.playbackRate.linearRampToValueAtTime(0.25, t + 0.18);
      s.playbackRate.linearRampToValueAtTime(1.5, t + 0.36);
      var f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1700; f.Q.value = 1.2;
      var g = a.createGain(); gainEnv(a, g, t, 0.16, 0.02, 0.2, 0.22);
      s.connect(f); f.connect(g); g.connect(a.destination); s.start(t); s.stop(t + 0.55);
    },
    boing: function () {                          // a piece taken for free
      var a = audio(); if (!a) return; var t = a.currentTime;
      var o = a.createOscillator(), g = a.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(680, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.35);
      gainEnv(a, g, t, 0.16, 0.01, 0.05, 0.3);
      o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.4);
    },
    applause: function () {                       // a genuinely good move
      var a = audio(); if (!a) return; var t = a.currentTime;
      var s = a.createBufferSource(); s.buffer = noiseBuffer(a, 1.1);
      var f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.7;
      var g = a.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.13, t + 0.12);
      g.gain.setValueAtTime(0.13, t + 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
      s.connect(f); f.connect(g); g.connect(a.destination); s.start(t); s.stop(t + 1.1);
    },
    tick: function () {                           // the clock taunt
      var a = audio(); if (!a) return; var t = a.currentTime;
      var o = a.createOscillator(), g = a.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(1500, t);
      gainEnv(a, g, t, 0.05, 0.005, 0.0, 0.06);
      o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.08);
    },
    sadviolin: function () {                      // the loss
      var a = audio(); if (!a) return; var t = a.currentTime;
      var o = a.createOscillator(), g = a.createGain(), f = a.createBiquadFilter();
      o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = 1200;
      o.frequency.setValueAtTime(392, t);
      o.frequency.linearRampToValueAtTime(370, t + 0.4);
      o.frequency.linearRampToValueAtTime(294, t + 1.1);
      gainEnv(a, g, t, 0.12, 0.15, 0.5, 0.5);
      o.connect(f); f.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 1.3);
    }
  };

  function speak(text) {
    try {
      if (!root.speechSynthesis || !root.SpeechSynthesisUtterance || !text) return;
      var u = new root.SpeechSynthesisUtterance(String(text));
      u.rate = 0.95; u.pitch = 0.9; u.volume = 0.8;
      root.speechSynthesis.cancel();
      root.speechSynthesis.speak(u);
    } catch (e) { /* no voices, no quip - not worth breaking a move over */ }
  }

  // =====================================================================================
  //  install
  // =====================================================================================
  /* cfg: { S, save, root, panel, head, status, tip, evalEl, bestEl, engineEl, verifyEl, els:{...},
            viewport(), say(msg), rand }
     The returned controller is what content.js talks to. */
  function install(cfg) {
    var S = cfg.S, save = cfg.save || function () {};
    var panel = cfg.panel, root_ = cfg.root;
    var els = cfg.els || {};
    var rand = cfg.rand || Math.random;
    var t = T();

    var state = {
      gaslit: {},          // original label text for every swapped label
      swapped: false,      // the button swap fires once per session
      nudges: 0,
      lastNudge: 0,
      lastDirective: null,
      lastTactic: null,
      stats: freshStats(),
      oppTimes: [],
      peakFrustration: 0,
      mirrorUntil: 0,
      bootLines: null,
      bootTimer: null
    };
    function freshStats() {
      return { plies: 0, oppCaptures: 0, myCaptures: 0, oppChecks: 0, myChecks: 0, oppTrades: 0, oppEntries: 0, oppLegalAvg: null };
    }

    // ---------- helpers ----------
    function on() { return !!S.troll; }
    function yes(k) { return on() && S[k] !== false; }
    function say(msg) { if (cfg.say) cfg.say(msg); }
    function sfx(name) { if (!yes('trollSound')) return; try { if (SFX[name]) SFX[name](); } catch (e) {} }
    function $(id) { return root_ ? root_.querySelector('#' + id) : null; }

    // ---------- master switch ----------
    function sync() {
      if (els.trollBody) els.trollBody.style.display = on() ? '' : 'none';
      if (els.troll) els.troll.checked = on();
      if (els.trollDir) els.trollDir.value = S.trollDirective || 'off';
      if (els.trollSincerity) els.trollSincerity.value = S.trollSincerity || 'best';
      if (els.trollChaos) els.trollChaos.value = S.trollChaosEvery || 5;
      if (els.trollRage) els.trollRage.checked = !!S.trollRage;
      if (els.trollTactic) els.trollTactic.value = S.trollRageTactic || 'auto';
      if (els.trollEval) els.trollEval.value = S.trollRageEval == null ? 250 : S.trollRageEval;
      if (els.trollEvalVal) els.trollEvalVal.textContent = '+' + (((S.trollRageEval == null ? 250 : S.trollRageEval) / 100).toFixed(1));
      if (els.trollClock) els.trollClock.value = S.trollRageClock || 0;
      if (els.trollClockVal) els.trollClockVal.textContent = (S.trollRageClock || 0) + 's';
      if (els.trollPreview) els.trollPreview.checked = S.trollPreview !== false;
      if (els.trollCommentary) els.trollCommentary.value = S.trollCommentary || 'off';
      if (els.trollSarcastic) els.trollSarcastic.checked = S.trollSarcastic !== false;
      if (els.trollShame) els.trollShame.checked = S.trollShame !== false;
      if (els.trollSound) els.trollSound.checked = S.trollSound !== false;
      if (els.trollVoice) els.trollVoice.checked = !!S.trollVoice;
      if (els.trollGaslight) els.trollGaslight.checked = S.trollGaslight !== false;
      if (els.trollRunaway) els.trollRunaway.checked = S.trollRunaway !== false;
      if (els.trollLoading) els.trollLoading.checked = S.trollLoading !== false;
      if (els.trollConfidence) els.trollConfidence.checked = S.trollConfidence !== false;
      if (els.trollMirror) els.trollMirror.checked = S.trollMirror !== false;
      if (els.trollSwap) els.trollSwap.checked = S.trollSwap !== false;
      if (els.trollJudge) els.trollJudge.checked = S.trollJudge !== false;
      if (els.trollTelem) els.trollTelem.checked = S.trollTelem !== false;
      if (els.rageRow) els.rageRow.style.display = S.trollRage ? '' : 'none';
      if (els.dirRow) els.dirRow.style.display = (S.trollDirective && S.trollDirective !== 'off') ? '' : 'none';
      showConfidence(null);
      if (!on()) { restoreLabels(); stopBootTheater(); }
    }

    // ---------- the confidence meter that lies ----------
    function showConfidence(cp) {
      if (!els.confidenceRow || !els.confidence) return;
      if (!yes('trollConfidence')) { els.confidenceRow.style.display = 'none'; return; }
      els.confidenceRow.style.display = '';
      els.confidence.textContent = cp == null ? '—' : t.confidenceFor(cp, rand);
    }

    // ---------- gaslight: cosmetic label swaps ----------
    function labelNodes() {
      return root_ ? Array.prototype.slice.call(root_.querySelectorAll('.ct-label')) : [];
    }
    function gaslightStep() {
      if (!yes('trollGaslight')) { restoreLabels(); return; }
      var nodes = labelNodes();
      if (!nodes.length) return;
      var node = nodes[Math.floor(rand() * nodes.length) % nodes.length];
      var orig = node.getAttribute('data-ct-orig');
      if (orig == null) { orig = node.textContent; node.setAttribute('data-ct-orig', orig); }
      if (node.getAttribute('data-ct-swapped') === '1') return;
      var swaps = t.GASLIGHT[orig];
      if (!swaps || !swaps.length) return;
      node.textContent = t.pick(swaps, rand);
      node.setAttribute('data-ct-swapped', '1');
      setTimeout(function () {
        node.textContent = orig;
        node.removeAttribute('data-ct-swapped');
      }, 18000 + Math.floor(rand() * 20000));
    }
    function restoreLabels() {
      var nodes = labelNodes();
      nodes.forEach(function (n) {
        var orig = n.getAttribute('data-ct-orig');
        if (orig != null) { n.textContent = orig; n.removeAttribute('data-ct-swapped'); }
      });
    }

    // ---------- the loading screen theater ----------
    function bootTheater() {
      if (!yes('trollLoading') || !els.engine) return;
      // the real status is captured once: the appended jokes must never become part of the next line's base
      if (state.bootBase == null) state.bootBase = els.engine.textContent;
      if (state.bootLines == null) state.bootLines = t.LOADING_LINES.slice();
      if (!state.bootLines.length) state.bootLines = t.LOADING_LINES.slice();
      var line = state.bootLines.splice(Math.floor(rand() * state.bootLines.length) % state.bootLines.length, 1)[0];
      els.engine.textContent = state.bootBase + ' \\u00B7 ' + line + '...';
      state.bootTimer = setTimeout(bootTheater, 900 + Math.floor(rand() * 900));
    }
    function stopBootTheater() {
      if (state.bootTimer) { clearTimeout(state.bootTimer); state.bootTimer = null; }
      if (state.bootBase != null && els.engine) els.engine.textContent = state.bootBase;
      state.bootBase = null;
      state.bootLines = null;
    }

    // ---------- the button that moves ----------
    function armButtonSwap() {
      if (!yes('trollSwap') || state.swapped || !els.analyze || !els.close) return;
      state.swapped = true;
      var a = els.analyze, c = els.close;
      var run = function () {
        if (!a.parentNode) return;
        var holder = document.createElement('span');
        a.parentNode.insertBefore(holder, a);
        c.parentNode.insertBefore(a, c);
        holder.parentNode.insertBefore(c, holder);
        holder.parentNode.removeChild(holder);
        setTimeout(function () {
          // put them back before anyone notices the hide button does something unusual
          if (!a.parentNode) return;
          var h2 = document.createElement('span');
          a.parentNode.insertBefore(h2, a);
          c.parentNode.insertBefore(a, c);
          h2.parentNode.insertBefore(c, h2);
          h2.parentNode.removeChild(h2);
        }, 1200);
      };
      a.addEventListener('mouseenter', function once() {
        a.removeEventListener('mouseenter', once);
        run();
      });
    }

    // ---------- the runaway panel ----------
    function maybeRunAway(cx, cy) {
      if (!yes('trollRunaway') || !panel) return;
      var now = Date.now();
      if (now - state.lastNudge < 750) return;
      if (panel.classList.contains('dragging')) return;
      if (panel.contains(document.activeElement)) return;
      var r = panel.getBoundingClientRect();
      if (cx < r.left - 30 || cx > r.right + 30 || cy < r.top - 30 || cy > r.bottom + 30) return;
      // only shy away when the pointer is actually reaching for something
      var targets = root_ ? root_.querySelectorAll('#ct-panel button, #ct-panel select, #ct-panel input') : [];
      var reaching = false;
      for (var i = 0; i < targets.length; i++) {
        var b = targets[i].getBoundingClientRect();
        if (cx > b.left - 26 && cx < b.right + 26 && cy > b.top - 20 && cy < b.bottom + 20) { reaching = true; break; }
      }
      if (!reaching) return;
      if (Math.abs(state.nudges) > 5) return;                    // it gets bored eventually
      var vw = (cfg.viewport && cfg.viewport()) || { w: root.innerWidth, h: root.innerHeight };
      var dx = cx < r.left + r.width / 2 ? 44 : -44;
      var dy = cy < r.top + r.height / 2 ? 26 : -26;
      var nx = Math.max(4, Math.min(vw.w - r.width - 4, r.left + dx));
      var ny = Math.max(4, Math.min(vw.h - r.height - 4, r.top + dy));
      if (nx === r.left && ny === r.top) return;
      panel.style.left = nx + 'px';
      panel.style.top = ny + 'px';
      state.nudges += (dx > 0 ? 1 : -1);
      state.lastNudge = now;
    }

    // ---------- mirror mode ----------
    function mirror(secs) {
      if (!yes('trollMirror') || !panel) return;
      panel.classList.add('ct-mirror');
      state.mirrorUntil = Date.now() + (secs || 30) * 1000;
      setTimeout(function () { panel.classList.remove('ct-mirror'); }, (secs || 30) * 1000);
    }

    // ---------- telemetry ----------
    function telemetry(ctx) {
      if (!els.telem) return;
      if (!yes('trollTelem')) { els.telem.style.display = 'none'; return; }
      var lines = [];
      lines.push(t.counterLine(state.stats));
      lines.push(t.contactLine(state.stats));
      if (ctx && ctx.pieces) {
        var d = t.distanceLine(ctx.pieces, ctx);
        if (d) lines.push(d);
      }
      var idx = t.frustrationIndex(state.stats);
      if (idx > state.peakFrustration) state.peakFrustration = idx;
      if (on() && S.trollRage) {
        lines.push('Frustration: ' + idx + '% (' + t.frustrationWord(idx) + ')');
        if (state.gateReason) lines.push('Gate: ' + state.gateReason);
        if (state.tiltNote) lines.push(state.tiltNote);
      }
      els.telem.textContent = lines.join('\\n');
      els.telem.style.display = lines.length ? '' : 'none';
      if (els.frustRow) {
        els.frustRow.style.display = (on() && S.trollRage) ? '' : 'none';
        if (els.frustFill) els.frustFill.style.width = Math.max(2, Math.min(100, idx)) + '%';
        if (els.frustVal) els.frustVal.textContent = idx + '%';
      }
    }

    // ---------- per-move bookkeeping ----------
    function noteMove(info) {
      var st = state.stats;
      st.plies++;
      if (info && info.byUs) {
        if (info.capture) state.stats.myCaptures++;
        if (info.check) state.stats.myChecks++;
      } else if (info) {
        if (info.capture) state.stats.oppCaptures++;
        if (info.check) state.stats.oppChecks++;
        if (info.trade) state.stats.oppTrades++;
        if (info.entered) state.stats.oppEntries++;
        if (info.moveMs != null) {
          state.oppTimes.push(info.moveMs);
          if (state.oppTimes.length > 24) state.oppTimes.shift();
          var tl = t.tiltRead(state.oppTimes);
          state.tiltNote = tl.tilted ? tl.note : '';
        }
        if (info.legalReplies != null) {
          state.stats.oppLegalAvg = state.stats.oppLegalAvg == null
            ? info.legalReplies
            : Math.round(state.stats.oppLegalAvg * 0.7 + info.legalReplies * 0.3);
        }
      }
      telemetry(info && info.ctx);
    }

    // ---------- what the panel says about a choice ----------
    function directiveNote(pick) {
      if (!pick) return '';
      if (pick.suspended) return t.pick(t.SUSPEND_LINES, rand) + ' — ' + pick.name.toLowerCase() + ' has no legal move here';
      return pick.name;
    }
    function rageNote(pick) {
      if (!pick || !pick.on) return '';
      var bits = [];
      if (pick.suspended) bits.push(t.pick(t.SUSPEND_LINES, rand) + ' — playing a real move');
      bits.push(pick.name);
      if (pick.gate && pick.gate.reason) bits.push(pick.gate.reason);
      return bits.join(' \\u00B7 ');
    }

    // ---------- voice of the commentary ----------
    function commentaryFor(v) {
      if (!on()) return '';
      var mode = S.trollCommentary;
      if (!mode || mode === 'off' || !t.COMMENTARY[mode]) return '';
      return t.COMMENTARY[mode](v);
    }

    // ---------- sounds for events ----------
    function onBlunder() { sfx('trombone'); if (yes('trollVoice')) speak('bruh'); }
    function onMate() { sfx('airhorn'); }
    function onHang() { sfx('scratch'); }
    function onCapture() { sfx('boing'); }
    function onBrilliant() { sfx('applause'); }
    function onLoss() { sfx('sadviolin'); mirror(30); }

    // ---------- listeners ----------
    function onMove(e) {
      if (!root_) return;
      if (e.clientX != null) maybeRunAway(e.clientX, e.clientY);
    }
    if (root_) root_.addEventListener('mousemove', onMove, { passive: true });

    // ---------- the fake bug reporter ----------
    function wireBug() {
      if (!els.bug) return;
      els.bug.addEventListener('click', function (e) {
        e.preventDefault();
        say('The bug is your position.');
      });
    }
    wireBug();

    // ---------- periodic ----------
    var timer = setInterval(function () {
      if (!on()) return;
      gaslightStep();
      if (state.mirrorUntil && Date.now() > state.mirrorUntil) {
        panel && panel.classList.remove('ct-mirror');
        state.mirrorUntil = 0;
      }
    }, 7000);

    return {
      sync: sync,
      sfx: sfx,
      speak: speak,
      noteMove: noteMove,
      telemetry: telemetry,
      bootTheater: bootTheater,
      stopBootTheater: stopBootTheater,
      armButtonSwap: armButtonSwap,
      mirror: mirror,
      showConfidence: showConfidence,
      directiveNote: directiveNote,
      rageNote: rageNote,
      commentaryFor: commentaryFor,
      onBlunder: onBlunder,
      onMate: onMate,
      onHang: onHang,
      onCapture: onCapture,
      onBrilliant: onBrilliant,
      onLoss: onLoss,
      restoreLabels: restoreLabels,
      stats: function () { return state.stats; },
      peak: function () { return { peakFrustration: state.peakFrustration }; },
      resetStats: function () { state.stats = freshStats(); state.oppTimes = []; state.peakFrustration = 0; },
      setGateReason: function (r) { state.gateReason = r || ''; },
      setTiltNote: function (r) { state.tiltNote = r || ''; },
      destroy: function () {
        clearInterval(timer);
        stopBootTheater();
        if (root_) root_.removeEventListener('mousemove', onMove);
      }
    };
  }

  var api = { install: install, SFX: SFX, speak: speak };
  root.CTTrollUI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
