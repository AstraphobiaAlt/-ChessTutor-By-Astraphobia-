/* Sandboxed extension page: downloads a Stockfish build and runs it in a blob Worker.
   Tries Stockfish 18 (NNUE, wasm) -> 17.1 -> 10 (asm.js). For every candidate it reads the engine's OWN
   "id name" line and checks it against what the source claims, so the UI can say whether it is really SF18. */
(function () {
  var HF = 'https://huggingface.co/cstr/stockfish-js-wasm/resolve/main/';
  var JD = 'https://cdn.jsdelivr.net/npm/stockfish@17.1.0/src/';
  // sha256: paste the hash shown in the panel's engine details here to pin a build (null = don't pin).
  var SOURCES = [
    { name: 'Stockfish 18', kind: 'NNUE lite, single-thread', expect: /stockfish\s*18/i, sha256: null,
      js: HF + 'stockfish-18-lite-single.js', wasm: HF + 'stockfish.wasm' },
    { name: 'Stockfish 17.1', kind: 'NNUE lite, single-thread', expect: /stockfish\s*17/i, sha256: null,
      js: JD + 'stockfish-17.1-lite-single-03e3232.js', wasm: JD + 'stockfish-17.1-lite-single-03e3232.wasm' },
    { name: 'Stockfish 10', kind: 'basic, asm.js', expect: /stockfish\s*10/i, sha256: null,
      js: 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js', wasm: null }
  ];
  var worker = null, queue = [];
  function toParent(m) { parent.postMessage(Object.assign({ ct: true }, m), '*'); }

  window.addEventListener('message', function (e) {
    if (e.source !== parent || typeof e.data !== 'object' || !e.data || !e.data.ctCmd) return;
    if (worker) worker.postMessage(e.data.ctCmd); else queue.push(e.data.ctCmd);
  });
  toParent({ ready: true });

  function sha256(text) {
    try {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) {
        return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function probe(src) {
    return fetch(src.js).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (code) {
      if (code.length < 5000) throw new Error('bad download');
      return sha256(code).then(function (hash) {
        if (src.sha256 && hash && hash !== src.sha256) throw new Error('hash mismatch');
        var url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
        if (src.wasm) url += '#' + src.wasm;
        return new Promise(function (resolve, reject) {
          var w = new Worker(url), done = false, idName = '', options = [];
          var t = setTimeout(function () { if (!done) { done = true; w.terminate(); reject(new Error('timeout')); } }, 60000);
          w.onerror = function (e) { if (!done) { done = true; clearTimeout(t); w.terminate(); reject(new Error(e.message || 'worker error')); } };
          w.onmessage = function (e) {
            var l = String(e.data);
            if (l.indexOf('id name ') === 0) idName = l.slice(8).trim();
            else if (l.indexOf('option name ') === 0) options.push(l);
            else if (!done && l.indexOf('uciok') === 0) {
              done = true; clearTimeout(t);
              resolve({ w: w, idName: idName, options: options, hash: hash, verified: src.expect.test(idName) });
            }
          };
          w.postMessage('uci');
        });
      });
    });
  }

  var fallback = null;   // first engine that loaded but did not identify as expected
  function use(src, r) {
    worker = r.w;
    worker.onmessage = function (e) { toParent({ line: String(e.data) }); };
    worker.onerror = function (e) { toParent({ error: 'worker: ' + (e.message || 'failed') }); };
    toParent({ engineName: src.name, engineKind: src.kind, idName: r.idName, verified: r.verified,
      options: r.options, hash: r.hash, source: src.js });
    queue.forEach(function (c) { worker.postMessage(c); });
    queue = [];
  }

  (function next(i) {
    if (i >= SOURCES.length) {
      if (fallback) { use(fallback.src, fallback.r); return; }
      toParent({ fatal: true, error: 'could not load any engine (network filter blocking downloads?)' });
      return;
    }
    probe(SOURCES[i]).then(function (r) {
      if (r.verified) { if (fallback) fallback.r.w.terminate(); use(SOURCES[i], r); }
      else { if (!fallback) fallback = { src: SOURCES[i], r: r }; else r.w.terminate(); next(i + 1); }
    }).catch(function () { next(i + 1); });
  })(0);
})();
