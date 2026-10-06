/* Sandboxed extension page (engine.html): downloads a Stockfish build and runs it in a blob Worker.

   The tutor is only as strong as the network the engine carries, and nmrugg's "lite" builds carry a small one:
   they report a Stockfish 18/19, but they play like a much weaker engine. So the full-net builds come first:

       Stockfish 19 (full net)  ->  Stockfish 18 (full net)
       -> 19 Lite -> 18 Lite -> 17.1 Lite -> Stockfish 10     (small nets, only if ~100 MB cannot be fetched)

   Every build is asked for the single-threaded ("-single") binary: the multi-threaded ones need
   SharedArrayBuffer and therefore COOP/COEP headers, which a content script cannot give a chess.com page.
   Single-threaded still uses the same full network, it just searches on one core - the lite builds are the
   ones that are weaker, because of the network, not the thread count.

   Mirrors, in order: unpkg -> jsDelivr -> the npm registry tarball. All three serve the published package and
   send `Access-Control-Allow-Origin: *`. The tarball (registry.npmjs.org) is the source of truth - immutable,
   signed by the registry, no per-file size cap - so it is gunzipped and unpacked here in the page when the
   plain-file mirrors will not hand over a 99 MB file.

   Every file is pinned to the size and sha256 of the file inside the npm tarball - the artefact the registry
   signs, and one that the v19.0.0 / v18.0.0 GitHub release assets hash to as well for the full builds (all
   checked with sha256sum here) - so a mirror that serves something else is refused instead of being run as
   code. The engine must also report its own `id name`, and a build that claims a full net but answers "Lite"
   is rejected.

   The wasm is handed to the loader as a blob: URL (the loader takes its wasm from its own hash, so the
   sandbox's CSP never has to allow the CDN), and the same bytes go to the panel, which keeps them in the
   page's Cache Storage: the next page load starts from disk instead of downloading 95 MB again. */
(function (root) {
  'use strict';

  // ---------- tuning ----------
  var TUNE = {
    jsMs: 45000,       // the ~21 KB loader: even a cold mirror has answered by then
    stallMs: 30000,    // no bytes for this long during a download -> that mirror is dead, try the next one
    uciMs: 150000,     // `uci` after a 99 MB wasm compile and a net init, on a cold and slow machine
    cacheMs: 6000      // how long to wait for the panel to answer a cache lookup before just downloading
  };

  // ---------- where the files come from ----------
  var HOST = {
    unpkg: 'https://unpkg.com/stockfish@',
    jsdelivr: 'https://cdn.jsdelivr.net/npm/stockfish@',
    registry: 'https://registry.npmjs.org/stockfish/-/stockfish-',
    hf: 'https://huggingface.co/cstr/stockfish-js-wasm/resolve/main/',
    cdnjs: 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/'
  };

  /* One entry per build, strongest first. `pkg` is the npm version every mirror URL is built from, and the
     sha256/size pins are that tarball's files - the same bytes the GitHub releases publish for the full
     builds. `wasm: null` means the loader file is the whole engine (stockfish.js 10 is asm.js). */
  var BUILDS = [
    {
      name: 'Stockfish 19', version: 19, id: /stockfish\s*19/i, pkg: '19.0.0', full: true,
      kind: 'full NNUE net, single-thread',
      js: 'bin/stockfish-19-single.js', jsBytes: 21315,
      jsSha: '72772f8bdd7353e4e24245d946bb831f56bcccf02fa16a779c1b92a6c00e5cc2',
      wasm: 'bin/stockfish-19-single.wasm', wasmBytes: 99102793,
      wasmSha: '8725c26572762617fd96b2ea83ff130e6640b85815890d682bf8c49db0820721',
      mirrors: ['unpkg', 'jsdelivr'], tarball: true
    },
    {
      name: 'Stockfish 18', version: 18, id: /stockfish\s*18/i, pkg: '18.0.8', full: true,
      kind: 'full NNUE net, single-thread',
      js: 'bin/stockfish-18-single.js', jsBytes: 21330,
      jsSha: 'ce07b916870473a837b598b9b558c125e24568624e47dabc3381474558ee201d',
      wasm: 'bin/stockfish-18-single.wasm', wasmBytes: 112992459,
      wasmSha: 'f611ac05ddb248fe975a4f180ac9fec7f7fb650f8f17f5fe4230fcc0fe6419c7',
      mirrors: ['unpkg', 'jsdelivr'], tarball: true
    },
    {
      name: 'Stockfish 19 Lite', version: 19, id: /stockfish\s*19/i, pkg: '19.0.0', full: false,
      kind: 'small NNUE net, single-thread (last resort)',
      js: 'bin/stockfish-19-lite-single.js', jsBytes: 21415,
      jsSha: 'd3344124ab067fb0b90ee77873bb8e9fbf5fc01bc525fe714b0f942581e889e6',
      wasm: 'bin/stockfish-19-lite-single.wasm', wasmBytes: 1787571,
      wasmSha: '57ac2d72312aba346760e3f173f687a8c211208e97a87268436f7f0e10bb5387',
      mirrors: ['unpkg', 'jsdelivr'], tarball: false
    },
    {
      name: 'Stockfish 18 Lite', version: 18, id: /stockfish\s*18/i, pkg: '18.0.8', full: false,
      kind: 'small NNUE net, single-thread (last resort)',
      js: 'bin/stockfish-18-lite-single.js', jsBytes: 21429,
      jsSha: '5243fd9b276cab7dfe3ad1d43ab9ead73568fac76468c614242977a210c4a391',
      wasm: 'bin/stockfish-18-lite-single.wasm', wasmBytes: 7295411,
      wasmSha: 'a8fbc05ec6920b56d7485826dcb02c5ffd2826bcbf751cf973046f237a9096f1',
      mirrors: ['unpkg', 'jsdelivr'], tarball: false,
      // the mirror the tutor used before, kept as an extra: not byte-pinned, the engine still has to identify
      extra: [{ label: 'huggingface', js: HOST.hf + 'stockfish-18-lite-single.js', wasm: HOST.hf + 'stockfish.wasm', unpinned: true }]
    },
    {
      name: 'Stockfish 17.1 Lite', version: 17, id: /stockfish\s*17/i, pkg: '17.1.0', full: false,
      kind: 'small NNUE net, single-thread (last resort)',
      js: 'src/stockfish-17.1-lite-single-03e3232.js', jsBytes: 20672,
      jsSha: '1c8265e52fdaef797684b4979b42c5dcfe0350df3e11a87e48e4ec5f86e0ca5c',
      wasm: 'src/stockfish-17.1-lite-single-03e3232.wasm', wasmBytes: 7280741,
      wasmSha: '7ca31bedd166148931a1cc84dbd8dd9cf001744e9994caf23a3c6ff4988d7086',
      mirrors: ['unpkg', 'jsdelivr'], tarball: false
    },
    {
      name: 'Stockfish 10', version: 10, id: /stockfish\s*10/i, pkg: '10.0.2', full: false,
      kind: 'asm.js, no wasm, 2019 build',
      mirrors: [], tarball: false,
      extra: [{ label: 'cdnjs', js: HOST.cdnjs + '10.0.2/stockfish.js', wasm: null, unpinned: true }]
    }
  ];

  function planSources() {
    return BUILDS.map(function (b) {
      var pinJs = b.jsSha ? { bytes: b.jsBytes, sha: b.jsSha } : null;
      var pinWasm = b.wasmSha ? { bytes: b.wasmBytes, sha: b.wasmSha } : null;
      var providers = [];
      (b.mirrors || []).forEach(function (h) {
        providers.push({ label: h, js: HOST[h] + b.pkg + '/' + b.js, wasm: b.wasm ? HOST[h] + b.pkg + '/' + b.wasm : null, pinJs: pinJs, pinWasm: pinWasm });
      });
      if (b.tarball && b.js && b.wasm) providers.push({
        label: 'npm registry tarball', kind: 'tarball', url: HOST.registry + b.pkg + '.tgz',
        jsPath: b.js, wasmPath: b.wasm, pinJs: pinJs, pinWasm: pinWasm
      });
      (b.extra || []).forEach(function (e) {
        providers.push({ label: e.label, js: e.js, wasm: e.wasm || null, pinJs: null, pinWasm: null, unpinned: !!e.unpinned });
      });
      return {
        name: b.name, version: b.version, kind: b.kind, full: !!b.full, expect: b.id, pkg: b.pkg,
        bytes: b.wasmBytes || 0, jsBytes: b.jsBytes || 0, wasmName: b.wasm, providers: providers,
        // one cache entry per build, not per mirror: the panel keys it on the file hash, so a download from
        // unpkg is reused even on a day when the tarball mirror is the only one answering
        cacheKey: b.wasmSha ? './ct-engine-' + b.wasmSha + '.wasm' : null
      };
    });
  }

  // ---------- small helpers ----------
  var dec = new TextDecoder();
  function utf8(buf) { return dec.decode(buf); }
  function enc(text) { return new TextEncoder().encode(text); }
  function hex(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += (b[i] + 256).toString(16).slice(1);
    return s;
  }
  function digest(buf) {
    try {
      return crypto.subtle.digest('SHA-256', buf).then(hex, function () { return null; });
    } catch (e) { return Promise.resolve(null); }   // no crypto.subtle: skip the pin, HTTPS still applies
  }

  /* Minimal streaming tar reader. The gunzipped archive arrives in arbitrary chunks: unwanted entries are
     skipped by length, the two wanted ones are collected, and finish() hands back one Uint8Array each. */
  function tarReader(wanted) {
    var names = wanted || [], tail = new Uint8Array(0), cur = null, skip = 0, pad = 0, out = {}, ended = false;
    function str(b, off, len) {
      var end = off;
      while (end < off + len && b[end]) end++;
      return utf8(b.subarray(off, end));
    }
    function num(b, off, len) {           // sizes are octal ASCII
      var s = '', i;
      for (i = off; i < off + len; i++) { if (b[i] === 0 || b[i] === 32) continue; if (b[i] < 48 || b[i] > 55) break; s += String.fromCharCode(b[i]); }
      return s ? parseInt(s, 8) || 0 : 0;
    }
    function take(n) { var v = tail.subarray(0, n); tail = tail.subarray(n); return v; }
    function push(chunk) {
      if (ended || !chunk || !chunk.byteLength) return;
      if (tail.byteLength) {
        var m = new Uint8Array(tail.byteLength + chunk.byteLength);
        m.set(tail); m.set(chunk, tail.byteLength); tail = m;
      } else tail = chunk;
      while (!ended && tail.byteLength) {
        if (skip) { var n = Math.min(skip, tail.byteLength); tail = tail.subarray(n); skip -= n; continue; }
        if (cur) {
          var got = Math.min(cur.need, tail.byteLength);
          if (got) { cur.parts.push(take(got).slice()); cur.need -= got; }   // slice(): the bytes must survive this chunk
          if (cur.need) return;
          out[cur.name] = concat(cur.parts, cur.size);
          pad = (512 - (cur.size % 512)) % 512;                              // tar pads every entry to 512
          cur = null;
          continue;
        }
        if (pad) { var k = Math.min(pad, tail.byteLength); tail = tail.subarray(k); pad -= k; continue; }
        if (tail.byteLength < 512) return;
        var h = take(512), zero = true, i;
        for (i = 0; i < 512; i++) { if (h[i]) { zero = false; break; } }
        if (zero) { ended = true; return; }                                // end-of-archive marker
        var name = str(h, 0, 100), prefix = str(h, 345, 155);
        var size = num(h, 124, 12), type = String.fromCharCode(h[156] || 48);
        var full = prefix ? prefix + '/' + name : name;
        if ((type === '0' || type === '\0' || type === ' ') && names.indexOf(full) >= 0) {
          cur = { name: full, size: size, need: size, parts: [] };
          pad = (512 - (size % 512)) % 512;
        } else skip = size + ((512 - (size % 512)) % 512);
      }
    }
    function concat(parts, size) {
      var out = new Uint8Array(size || 0), off = 0;
      for (var i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].byteLength; }
      return out.subarray(0, off);
    }
    return { push: push, files: function () { return out; } };
  }

  // ---------- talking to the panel ----------
  function toParent(m) { io.report(Object.assign({ ct: true }, m)); }
  function note(text) { toParent({ note: text }); }

  /* every network/worker/cache call goes through `io`, so the node test can run the whole selection without
     a browser */
  var io = {
    request: function (url, opts) { return fetch(url, opts); },
    digest: digest,
    probe: null,          // set below
    cacheGet: null,       // set below
    cachePut: null,       // set below
    report: function (m) { try { root.parent.postMessage(m, '*'); } catch (e) {} }
  };

  // ---------- downloading ----------
  function fetchText(url) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TUNE.jsMs);
    var opts = { mode: 'cors', credentials: 'omit' };
    if (ctl) opts.signal = ctl.signal;
    return io.request(url, opts).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }, function (err) {
      clearTimeout(timer);
      throw new Error(err && err.name === 'AbortError' ? 'no answer within ' + Math.round(TUNE.jsMs / 1000) + 's' : (err && err.message) || 'fetch failed');
    });
  }

  /* Downloads with a progress report and a stall watchdog: a mirror that stops sending is abandoned instead of
     hanging the load forever. */
  function fetchBytes(url, source, onProgress) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var stallTimer = null, stalled = false;
    function beat() {
      if (!ctl) return;
      clearTimeout(stallTimer);
      stallTimer = setTimeout(function () { stalled = true; ctl.abort(); }, TUNE.stallMs);
    }
    function end() { clearTimeout(stallTimer); }
    var opts = { mode: 'cors', credentials: 'omit' };
    if (ctl) opts.signal = ctl.signal;
    beat();
    return io.request(url, opts).then(function (res) {
      if (!res.ok) { end(); throw new Error('HTTP ' + res.status); }
      var total = +res.headers.get('content-length') || source.bytes || 0;
      if (!res.body || !res.body.getReader) {
        return res.arrayBuffer().then(function (b) {
          end();
          onProgress({ phase: 'download', loaded: b.byteLength, total: b.byteLength, pct: 100 });
          return b;
        });
      }
      var reader = res.body.getReader(), chunks = [], got = 0, t0 = Date.now(), ticked = 0;
      function read() {
        return reader.read().then(function (r) {
          if (r.done) {
            end();
            var out = new Uint8Array(got), off = 0;
            for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], off); off += chunks[i].byteLength; }
            onProgress({ phase: 'download', loaded: got, total: total, pct: 100, rate: got / Math.max(0.3, (Date.now() - t0) / 1000) });
            return out.buffer;
          }
          beat();
          chunks.push(r.value); got += r.value.byteLength;
          var now = Date.now();
          if (now - ticked > 300 || (total && got >= total)) {
            ticked = now;
            var secs = (now - t0) / 1000;
            onProgress({ phase: 'download', loaded: got, total: total, pct: total ? Math.min(100, got * 100 / total) : 0, rate: secs > 0.3 ? got / secs : 0 });
          }
          return read();
        });
      }
      return read();
    }, function (err) {
      end();
      if (stalled) throw new Error('stalled (no data for ' + Math.round(TUNE.stallMs / 1000) + 's)');
      throw new Error(err && err.name === 'AbortError' ? 'download aborted' : (err && err.message) || 'fetch failed');
    }).catch(function (err) { end(); throw err instanceof Error ? err : new Error(String(err)); });
  }

  /* The npm tarball mirror: fetch the .tgz, gunzip it as it streams in, and pull the two files out of the tar.
     Nothing is buffered twice - the wanted wasm (99 MB for 19) is the only big thing we keep. */
  function fetchTarball(provider, source, onProgress) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('this browser cannot gunzip the archive'));
    var tar = tarReader([provider.jsPath, provider.wasmPath]);
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var stall = null, stalled = false;
    function beat() {
      if (!ctl) return;
      clearTimeout(stall);
      stall = setTimeout(function () { stalled = true; ctl.abort(); }, TUNE.stallMs);
    }
    var opts = { mode: 'cors', credentials: 'omit' };
    if (ctl) opts.signal = ctl.signal;
    beat();
    return io.request(provider.url, opts).then(function (res) {
      if (!res.ok) { clearTimeout(stall); throw new Error('HTTP ' + res.status); }
      var total = +res.headers.get('content-length') || 0, got = 0, t0 = Date.now(), ticked = 0;
      var count = new TransformStream({
        transform: function (chunk, ctl2) {
          beat();
          got += chunk.byteLength;
          var now = Date.now();
          if (now - ticked > 300) {
            ticked = now;
            onProgress({ phase: 'archive', loaded: got, total: total, pct: total ? Math.min(100, got * 100 / total) : 0, rate: got / Math.max(0.3, (now - t0) / 1000) });
          }
          ctl2.enqueue(chunk);
        }
      });
      var sink = new WritableStream({ write: function (chunk) { tar.push(chunk); } });
      return res.body.pipeThrough(count).pipeThrough(new DecompressionStream('gzip')).pipeTo(sink).then(function () {
        clearTimeout(stall);
        onProgress({ phase: 'archive', loaded: got, total: total, pct: 100 });
        return tar.files();
      });
    }, function (err) {
      clearTimeout(stall);
      throw new Error(stalled ? 'stalled (no data for ' + Math.round(TUNE.stallMs / 1000) + 's)' : (err && err.message) || 'fetch failed');
    });
  }

  // ---------- verifying ----------
  /* Pins are the npm package's own bytes (see BUILDS): a mirror that serves anything else is refused, because
     what arrives here is executed. */
  function verify(buf, pin, what) {
    if (!buf) return Promise.reject(new Error('no ' + what));
    if (buf.byteLength < 5000) return Promise.reject(new Error(what + ' is only ' + buf.byteLength + ' bytes'));
    if (!pin) return Promise.resolve(null);
    if (pin.bytes && buf.byteLength !== pin.bytes) return Promise.reject(new Error(what + ' is ' + buf.byteLength + ' bytes, expected ' + pin.bytes));
    return io.digest(buf).then(function (h) {
      if (h && pin.sha && h !== pin.sha) throw new Error(what + ' sha256 ' + h.slice(0, 12) + '... does not match the pinned ' + pin.sha.slice(0, 12) + '...');
      return h;
    });
  }

  // ---------- the engine worker ----------
  io.probe = function (jsText, wasmUrl) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(new Blob([jsText], { type: 'application/javascript' }));
      if (wasmUrl) url += '#' + wasmUrl;
      var w = null, done = false, idName = '', options = [];
      var t = setTimeout(function () { fail(new Error('the engine did not answer `uci` within ' + Math.round(TUNE.uciMs / 1000) + 's')); }, TUNE.uciMs);
      function fail(err) { if (done) return; done = true; clearTimeout(t); try { w.terminate(); } catch (e) {} reject(err); }
      try { w = new Worker(url); } catch (e) { return fail(e); }
      w.onerror = function (e) { fail(new Error((e && e.message) || 'worker error')); };
      w.onmessage = function (e) {
        var l = String(e.data);
        if (l.indexOf('id name ') === 0) idName = l.slice(8).trim();
        else if (l.indexOf('option name ') === 0) options.push(l);
        else if (!done && l.indexOf('uciok') === 0) {
          done = true; clearTimeout(t);
          resolve({ w: w, idName: idName, options: options });
        }
      };
      w.postMessage('uci');
    });
  };

  // ---------- the panel's Cache Storage, round trip ----------
  var seq = 0;
  io.cacheGet = function (url) {
    return new Promise(function (resolve) {
      var id = 'g' + (++seq);
      // the panel answers by posting to this frame's window, so the listener is ours, not the parent's
      function clean() { clearTimeout(t); try { root.removeEventListener('message', onMsg); } catch (e) {} }
      function onMsg(e) {
        if (e.source !== root.parent || !e.data || e.data.ctCacheRes !== id) return;
        clean();
        resolve(e.data.bytes || null);
      }
      var t = setTimeout(function () { clean(); resolve(null); }, TUNE.cacheMs);
      try { root.addEventListener('message', onMsg); } catch (e) { clean(); return resolve(null); }
      try { root.parent.postMessage({ ctCacheGet: url, id: id }, '*'); } catch (e) { clean(); resolve(null); }
    });
  };
  io.cachePut = function (url, buf) {
    try { root.parent.postMessage({ ctCachePut: url, bytes: buf }, '*', [buf]); return true; }
    catch (e) { return false; }     // the panel keeps no cache: the next visit downloads again
  };

  // ---------- one source, one mirror ----------
  function stage(source, provider, p) {
    toParent({
      stage: {
        name: source.name, label: provider.label, phase: p.phase, loaded: p.loaded || 0, total: p.total || 0,
        pct: Math.round(p.pct || 0), rate: p.rate || 0, bytes: source.bytes, full: !!source.full
      }
    });
  }

  function load(source, provider, cachedWasm) {
    var wasmBuf = null, jsBuf = null, jsText = null, cached = !!cachedWasm, bytes = 0;
    var work;
    if (provider.kind === 'tarball') {
      work = fetchTarball(provider, source, function (p) { stage(source, provider, p); }).then(function (files) {
        jsBuf = files[provider.jsPath];
        wasmBuf = files[provider.wasmPath];
        if (!jsBuf || !wasmBuf) throw new Error('the archive has no ' + (!jsBuf ? provider.jsPath : provider.wasmPath));
        jsText = utf8(jsBuf);
      });
    } else {
      work = fetchText(provider.js).then(function (text) {
        jsText = text;
        jsBuf = enc(text);
        if (cachedWasm) return cachedWasm;                                          // the panel had this file
        if (!provider.wasm) return null;
        return fetchBytes(provider.wasm, source, function (p) { stage(source, provider, p); });
      }).then(function (wasm) { wasmBuf = wasm; });
    }
    return work.then(function () {
      return verify(jsBuf, provider.pinJs, 'the loader');
    }).then(function (jsHash) {
      if (!wasmBuf) return { jsHash: jsHash, wasmHash: null };
      bytes = wasmBuf.byteLength;
      stage(source, provider, { phase: 'check', loaded: bytes, total: bytes, pct: 100 });
      return verify(wasmBuf, provider.pinWasm, 'the engine').then(function (h) { return { jsHash: jsHash, wasmHash: h }; });
    }).then(function (hashes) {
      var wasmUrl = null;
      if (wasmBuf) {
        wasmUrl = URL.createObjectURL(new Blob([wasmBuf], { type: 'application/wasm' }));
        if (!cached && source.cacheKey) io.cachePut(source.cacheKey, wasmBuf);   // hands the bytes over (transferred)
      }
      stage(source, provider, { phase: 'start', loaded: bytes, total: bytes, pct: 100 });
      // compiling a 99 MB wasm is a quiet few seconds: keep reporting, so the panel's watchdog can tell
      // "the engine is starting" from "nothing is happening"
      var tick = setInterval(function () { stage(source, provider, { phase: 'start', loaded: bytes, total: bytes, pct: 100 }); }, 5000);
      function stopTick() { clearInterval(tick); }
      return io.probe(jsText, wasmUrl).catch(function (err) {
        // The loader takes its wasm from the URL in its own hash, and we hand it a blob: URL so the bytes we
        // verified are the bytes it runs. If this browser will not let the worker fetch that blob, let the
        // loader pull the file from the mirror itself - CORS on those mirrors is what makes that a fallback
        // and not a dead end.
        if (!wasmUrl || !provider.wasm || provider.kind === 'tarball') throw err;
        note('the engine worker could not take the engine from memory (' + ((err && err.message) || err) + ') - fetching it straight from ' + provider.label);
        return io.probe(jsText, provider.wasm);
      }).then(function (r) {
        stopTick();
        r.cached = cached; r.bytes = bytes;
        r.jsHash = hashes.jsHash; r.wasmHash = hashes.wasmHash;
        return r;
      }, function (err) { stopTick(); throw err; });
    });
  }

  // ---------- choose the strongest engine that answers ----------
  var worker = null, queue = [];

  function adopt(source, provider, r, idName, unverified) {
    worker = r.w;
    worker.onmessage = function (e) { toParent({ line: String(e.data) }); };
    worker.onerror = function (e) { toParent({ error: 'worker: ' + ((e && e.message) || 'failed') }); };
    toParent({
      engineName: source.name, idName: idName, engineVersion: source.version, engineKind: source.kind,
      engineFull: !!source.full, verified: !unverified, source: provider.js || provider.url, host: provider.label,
      cached: !!r.cached, bytes: r.bytes || 0, options: r.options || [], hash: r.jsHash, wasmHash: r.wasmHash
    });
    queue.forEach(function (c) { worker.postMessage(c); });
    queue = [];
  }

  async function run(planOverride) {
    var plan = planOverride || planSources(), fallback = null;
    for (var i = 0; i < plan.length; i++) {
      var source = plan[i], dropped = false;
      // the panel keeps the file it already downloaded, keyed on the pinned hash, so every mirror of that
      // build can use it. Bytes that do not verify are dropped and downloaded again.
      var hit = source.cacheKey ? await io.cacheGet(source.cacheKey) : null;
      if (hit) stage(source, source.providers[0], { phase: 'cache', loaded: hit.byteLength, total: hit.byteLength, pct: 100 });
      for (var j = 0; j < source.providers.length; j++) {
        var provider = source.providers[j];
        try {
          var r = await load(source, provider, hit);
          var id = r.idName || 'unknown engine';
          var lite = /lite/i.test(id);
          if (source.expect.test(id) && !(source.full && lite)) { adopt(source, provider, r, id, false); return; }
          note(source.name + ' from ' + provider.label + ' answered as "' + id + '"' +
            (source.full && lite ? ' - a Lite build under a full-build name, ignored' : ' - not the expected engine'));
          if (!fallback) fallback = { source: source, provider: provider, r: r, id: id };
          else { try { r.w.terminate(); } catch (e) {} }
        } catch (err) {
          var why = (err && err.message) || err;
          if (hit && !dropped) {                       // a stale/foreign cache entry must not kill the load
            dropped = true; hit = null;
            note('the cached copy of ' + source.name + ' was not usable (' + why + ') - downloading it again');
            j--; continue;
          }
          note(source.name + ' from ' + provider.label + ' failed: ' + why);
        }
      }
    }
    if (fallback) { adopt(fallback.source, fallback.provider, fallback.r, fallback.id, true); return; }
    toParent({ fatal: true, error: 'could not load any engine (are downloads blocked?)' });
  }

  function start(planOverride) {
    root.addEventListener('message', function (e) {
      if (e.source !== root.parent || !e.data || typeof e.data !== 'object' || !e.data.ctCmd) return;
      if (worker) worker.postMessage(e.data.ctCmd); else queue.push(e.data.ctCmd);
    });
    toParent({ ready: true });
    run(planOverride).catch(function (err) { toParent({ fatal: true, error: (err && err.message) || String(err) }); });
  }

  var api = { TUNE: TUNE, BUILDS: BUILDS, planSources: planSources, tarReader: tarReader,
    io: io, load: load, verify: verify, run: run, start: start };
  root.CTEngineFrame = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
