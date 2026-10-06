/* Tests for the engine loader (engine-frame.js): which build of Stockfish the tutor ends up running, and what
   it will and will not accept from a mirror.
     - Stockfish 19 (full net) is tried first, Stockfish 18 (full net) second, lite builds only after those
     - every mirror URL is built from the pinned npm version, and the pins are the published file hashes
     - a mirror that serves a lite build under a full-build name, or bytes that do not match the pin, is skipped
     - the npm registry tarball mirror is gunzipped and unpacked in the page (no 20 MB file cap)
     - a copy already in the page's Cache Storage is used instead of downloading 95 MB again
     - if nothing verifies, the last engine that did start is used, and the panel is told it is unverified
   Run with:  node tests/engine-frame.test.js       (no dependencies) */
'use strict';
const crypto = require('crypto');
const zlib = require('zlib');
const api = require('../engine-frame.js');

let checks = 0, failures = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.error('FAIL: ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
const sha = buf => crypto.createHash('sha256').update(Buffer.from(buf)).digest('hex');

// ---------- 1. the plan: full net first, then the small ones ----------
const plan = api.planSources();
const names = plan.map(s => s.name);
eq(names.slice(0, 2).join(' > '), 'Stockfish 19 > Stockfish 18', 'the two full-net builds come first, 19 before 18');
ok(plan[0].full && plan[1].full, 'the first two sources carry the full network');
ok(plan.slice(2).every(s => !s.full), 'every later source is a lite/small build');
eq(names[names.length - 1], 'Stockfish 10', 'the 2019 asm.js build is the last resort');
ok(plan[0].expect.test('Stockfish 19 WASM by the Stockfish developers'), 'the 19 source accepts the 19 id name');
ok(!plan[0].expect.test('Stockfish 18 WASM'), 'the 19 source does not accept a 18 id name');

// every mirror URL is the pinned npm package, and both plain-file mirrors are tried before the tarball
eq(plan[0].providers.map(p => p.label).join(' > '), 'unpkg > jsdelivr > npm registry tarball', 'Stockfish 19 is fetched from unpkg, then jsDelivr, then the registry tarball');
eq(plan[0].providers[0].js, 'https://unpkg.com/stockfish@19.0.0/bin/stockfish-19-single.js', 'unpkg URL for the 19 loader');
eq(plan[0].providers[0].wasm, 'https://unpkg.com/stockfish@19.0.0/bin/stockfish-19-single.wasm', 'unpkg URL for the 19 wasm');
eq(plan[0].providers[2].url, 'https://registry.npmjs.org/stockfish/-/stockfish-19.0.0.tgz', 'the tarball mirror uses the registry URL');
eq(plan[0].providers[2].jsPath, 'bin/stockfish-19-single.js', 'the tarball mirror knows the loader path inside the package');
ok(/^[0-9a-f]{64}$/.test(plan[0].providers[0].pinWasm.sha), 'the wasm pin is a sha256');

// the published hashes (the npm tarballs and the v19.0.0 / v18.0.0 GitHub release assets agree on these)
eq(plan[0].providers[0].pinWasm.sha, '8725c26572762617fd96b2ea83ff130e6640b85815890d682bf8c49db0820721', 'pinned sha256 of the full Stockfish 19 wasm');
eq(plan[0].providers[0].pinWasm.bytes, 99102793, 'pinned size of the full Stockfish 19 wasm');
eq(plan[1].providers[0].pinWasm.sha, 'f611ac05ddb248fe975a4f180ac9fec7f7fb650f8f17f5fe4230fcc0fe6419c7', 'pinned sha256 of the full Stockfish 18 wasm');
eq(plan[1].providers[0].pinWasm.bytes, 112992459, 'pinned size of the full Stockfish 18 wasm');
eq(plan[1].providers[0].js, 'https://unpkg.com/stockfish@18.0.8/bin/stockfish-18-single.js', 'Stockfish 18 comes from the 18.0.8 package');
const lite18 = plan.find(s => s.name === 'Stockfish 18 Lite');
eq(lite18.providers[2].label, 'huggingface', 'the old huggingface mirror is still there for a lite build');
eq(plan[plan.length - 1].providers[0].wasm, null, 'the asm.js build has no wasm file');

// ---------- 2. the tar reader ----------
function tarEntry(name, body) {
  const head = Buffer.alloc(512);
  head.write(name, 0, 'utf8');
  head.write('0000644\0', 100);                                 // mode
  head.write('0000000\0', 108); head.write('0000000\0', 116);   // uid, gid
  head.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  head.write('00000000000\0', 136);                             // mtime
  head.write('0', 156);                                         // type flag: regular file
  head.write('ustar\0' + '00', 257);
  let sum = 0; for (const b of head) sum += b;
  head.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([head, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}
const bodyA = Buffer.alloc(1200, 7), bodyB = Buffer.from('let engine = 1;\n');
const archive = Buffer.concat([
  tarEntry('package/bin', Buffer.alloc(0)),
  tarEntry('package/bin/skip.wasm', Buffer.alloc(3000, 3)),      // a file we do not want
  tarEntry('package/bin/a.wasm', bodyA),
  tarEntry('package/bin/b.js', bodyB),
  Buffer.alloc(1024)                                             // end-of-archive marker
]);
for (const size of [512, 1024, 7, 1, 4096]) {                    // chunks never line up with the 512-byte blocks
  const reader = api.tarReader(['package/bin/a.wasm', 'package/bin/b.js']);
  for (let off = 0; off < archive.length; off += size) reader.push(new Uint8Array(archive.subarray(off, off + size)));
  const files = reader.files();
  eq(Buffer.from(files['package/bin/a.wasm']).toString('hex'), bodyA.toString('hex'), 'tar: wanted file out of odd ' + size + '-byte chunks');
  eq(Buffer.from(files['package/bin/b.js']).toString('utf8'), bodyB.toString('utf8'), 'tar: second wanted file survives ' + size + '-byte chunks');
  eq(files['package/bin/skip.wasm'], undefined, 'tar: unwanted entries are not collected (' + size + ')');
}

// ---------- 3. picking a source, with a fake network in front of every mirror ----------
function fakeWorker() { return { posted: [], onmessage: null, onerror: null, postMessage(m) { this.posted.push(m); }, terminate() { this.terminated = true; } }; }
function bytes(n) { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 7) & 255; return b; }
const loaderText = n => '/* stockfish loader */\n' + '/* filler */\n'.repeat(Math.ceil(n / 15));
// the tests serve their own bytes, so the mirror pins (which are the real 99 MB files) are dropped here: the
// pin logic itself is checked in 3b, and 3c/3d keep pins that match the fake files
const unpinned = () => plan.map(s => Object.assign({}, s, {
  providers: s.providers.map(p => Object.assign({}, p, { pinJs: null, pinWasm: null }))
}));

async function runWith(setup, override) {
  const messages = [], calls = [];
  const saved = Object.assign({}, api.io);
  const jsText = loaderText(6000);
  api.io.request = async (url) => { calls.push(url); throw new Error('no network in the test: ' + url); };
  api.io.probe = async () => { throw new Error('no probe in the test'); };
  api.io.cacheGet = async () => null;
  api.io.cachePut = () => true;
  api.io.report = m => messages.push(m);
  api.io.digest = async buf => sha(buf);
  setup({ messages, calls, jsText });
  await api.run(override);
  Object.assign(api.io, saved);
  return messages;
}
const engineMsg = messages => messages.find(m => m.engineName);
const notes = messages => messages.filter(m => m.note).map(m => m.note);

(async () => {
  // 3a. the first mirror answers with a Lite build under a full-build name: it must not be adopted
  {
    const good = bytes(12000);
    const messages = await runWith(({ calls, jsText }) => {
      api.io.request = async (url) => {
        calls.push(url);
        if (url.endsWith('.js')) return { ok: true, status: 200, text: async () => jsText };
        return new Response(good, { status: 200, headers: { 'content-length': String(good.length) } });
      };
      let probes = 0;
      api.io.probe = async (text, wasmUrl) => {
        probes++;
        ok(!wasmUrl || /^blob:/.test(wasmUrl), 'the loader is handed a blob: URL for the wasm');
        const lite = probes === 1;                              // the first mirror serves a Lite build
        return { w: fakeWorker(), idName: lite ? 'Stockfish 19 Lite WASM' : 'Stockfish 19 WASM by the Stockfish developers', options: ['option name Threads type spin default 1 min 1 max 1'] };
      };
    }, unpinned());
    const m = engineMsg(messages);
    ok(!!m, 'an engine was adopted');
    eq(m.engineName, 'Stockfish 19', 'the adopted engine is Stockfish 19');
    eq(m.engineFull, true, 'and it is reported as the full-net build');
    eq(m.verified, true, 'and as verified');
    eq(m.idName, 'Stockfish 19 WASM by the Stockfish developers', 'the panel gets the engine\'s own id name');
    ok(notes(messages).some(n => /Lite build under a full-build name/.test(n)), 'the lite-under-a-full-name mirror is reported: ' + notes(messages).join(' | '));
    ok(!messages.some(x => x.fatal), 'no fatal message');
  }

  // 3b. a mirror whose bytes do not match the pin is refused (the pin is what makes execution safe)
  {
    const p = plan[0].providers[0];
    let rejected = false;
    try { await api.verify(new Uint8Array(6000).fill(1), p.pinWasm, 'the engine'); } catch (e) { rejected = true; }
    ok(rejected, 'bytes that do not hash to the pin are refused');
    let small = false;
    try { await api.verify(new Uint8Array(64).fill(1), p.pinJs, 'the loader'); } catch (e) { small = true; }
    ok(small, 'a truncated download is refused before it is run');
    const pinned = new Uint8Array(6000).fill(9);
    eq(await api.verify(pinned, { bytes: 6000, sha: sha(pinned) }, 'the engine'), sha(pinned), 'matching bytes verify');
  }

  // 3c. the tarball mirror: gunzip + untar in the page, then the engine starts (pins checked for real)
  {
    const provider = Object.assign({}, plan[0].providers[2]);
    const jsText = loaderText(20000);
    const wasm = bytes(30000);
    provider.pinJs = { bytes: jsText.length, sha: sha(Buffer.from(jsText)) };
    provider.pinWasm = { bytes: wasm.length, sha: sha(wasm) };
    const tar = Buffer.concat([
      tarEntry('package/bin/stockfish-19-asm.js', Buffer.alloc(9000, 4)),
      tarEntry(provider.jsPath, Buffer.from(jsText)),
      tarEntry(provider.wasmPath, Buffer.from(wasm)),
      Buffer.alloc(1024)
    ]);
    const gz = zlib.gzipSync(tar);
    const saved = Object.assign({}, api.io);
    const messages = [], calls = [];
    let probedText = null;
    api.io.request = async (url) => { calls.push(url); return new Response(gz, { status: 200, headers: { 'content-length': String(gz.length) } }); };
    api.io.probe = async (text) => { probedText = text; return { w: fakeWorker(), idName: 'Stockfish 19 WASM', options: [] }; };
    api.io.cacheGet = async () => null; api.io.cachePut = () => true;
    api.io.report = m => messages.push(m);
    api.io.digest = async buf => sha(buf);
    const r = await api.load(plan[0], provider, null);
    eq(calls.length, 1, 'the tarball mirror touches the network once');
    ok(/stockfish-19\.0\.0\.tgz$/.test(calls[0]), 'and it is the registry tarball');
    eq(r.bytes, 30000, 'the wasm came out of the archive at its real size');
    eq(r.wasmHash, sha(wasm), 'the unpacked wasm is the pinned file');
    eq(probedText, jsText, 'the loader script also comes out of the archive, byte for byte');
    ok(messages.some(x => x.stage && x.stage.phase === 'archive'), 'the panel sees archive progress while the tarball streams');
    ok(messages.some(x => x.stage && x.stage.phase === 'start'), 'the panel sees the engine start');
    Object.assign(api.io, saved);
  }

  // 3d. a cached copy is used instead of downloading again
  {
    const provider = Object.assign({}, plan[0].providers[0]);
    const jsText = loaderText(6000);
    const wasm = bytes(30000);
    provider.pinJs = { bytes: jsText.length, sha: sha(Buffer.from(jsText)) };
    provider.pinWasm = { bytes: wasm.length, sha: sha(wasm) };
    const saved = Object.assign({}, api.io);
    const messages = [];
    let downloaded = false;
    api.io.request = async (url) => {
      if (url.endsWith('.js')) return { ok: true, status: 200, text: async () => jsText };
      downloaded = true;
      throw new Error('should not be called');
    };
    api.io.cachePut = () => { throw new Error('a cache hit must not be written back'); };
    api.io.probe = async () => ({ w: fakeWorker(), idName: 'Stockfish 19 WASM', options: [] });
    api.io.report = m => messages.push(m);
    api.io.digest = async buf => sha(buf);
    const hit = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);
    ok(/^\.\/ct-engine-[0-9a-f]{64}\.wasm$/.test(plan[0].cacheKey), 'the cache entry is keyed on the pinned hash, not on a mirror URL');
    const r = await api.load(plan[0], provider, hit);
    ok(!downloaded, 'the cached bytes are used, the wasm URL is never fetched');
    eq(r.cached, true, 'and the engine is marked as coming from the cache');
    eq(r.bytes, 30000, 'with its size');
    eq(r.wasmHash, sha(wasm), 'the cached copy is still hash-checked');
    Object.assign(api.io, saved);
  }

  // 3e. nothing verifies -> the last engine that started is used, flagged unverified
  {
    const messages = await runWith(({ calls, jsText }) => {
      api.io.request = async (url) => {
        calls.push(url);
        if (url.endsWith('.js')) return { ok: true, status: 200, text: async () => jsText };
        return new Response(bytes(8000), { status: 200, headers: { 'content-length': '8000' } });
      };
      api.io.probe = async () => ({ w: fakeWorker(), idName: 'Blackmamba 2.0', options: [] });
    }, unpinned());
    const m = engineMsg(messages);
    ok(!!m, 'an engine is still adopted so the tutor works');
    eq(m.verified, false, 'but it is reported as unverified');
    ok(!messages.some(x => x.fatal), 'and there is no fatal error');
  }

  // 3f. every mirror down -> fatal, and the panel is told what failed
  {
    const messages = await runWith(({ calls, jsText }) => {
      api.io.request = async (url) => {
        calls.push(url);
        if (url.endsWith('.js')) return { ok: true, status: 200, text: async () => jsText };
        return new Response(bytes(8000), { status: 200, headers: { 'content-length': '8000' } });
      };
      api.io.probe = async () => { throw new Error('worker error'); };
    }, unpinned());
    ok(messages.some(x => x.fatal), 'a fatal message goes to the panel');
    ok(notes(messages).length >= 3, 'every failed source/mirror is named: ' + notes(messages).slice(0, 3).join(' | '));
  }

  // 3g. an HTTP error on one mirror is skipped instead of failing the load
  {
    const messages = await runWith(({ calls, jsText }) => {
      let n = 0;
      api.io.request = async (url) => {
        calls.push(url);
        if (url.endsWith('.js') && n++ === 0) return { ok: false, status: 403, text: async () => 'too big' };
        if (url.endsWith('.js')) return { ok: true, status: 200, text: async () => jsText };
        return new Response(bytes(8000), { status: 200, headers: { 'content-length': '8000' } });
      };
      api.io.probe = async () => ({ w: fakeWorker(), idName: 'Stockfish 19 WASM', options: [] });
    }, unpinned());
    ok(notes(messages).some(n => /HTTP 403/.test(n)), 'the 403 mirror is reported: ' + notes(messages).join(' | '));
    eq(engineMsg(messages).host, 'jsdelivr', 'and the next mirror takes over');
  }

  // 3h. if the worker cannot take the wasm from a blob: URL, the loader is told to fetch it from the mirror
  {
    const source = plan[0], provider = unpinned()[0].providers[0];
    const jsText = loaderText(6000), wasm = bytes(20000);
    const saved = Object.assign({}, api.io);
    const messages = [], seen = [];
    api.io.request = async (url) => {
      if (url.endsWith('.js')) return { ok: true, status: 200, text: async () => jsText };
      return new Response(wasm, { status: 200, headers: { 'content-length': String(wasm.length) } });
    };
    api.io.cacheGet = async () => null; api.io.cachePut = () => true;
    api.io.report = m => messages.push(m);
    api.io.digest = async buf => sha(buf);
    api.io.probe = async (text, wasmUrl) => {
      seen.push(wasmUrl);
      if (seen.length === 1) throw new Error('worker error');
      return { w: fakeWorker(), idName: 'Stockfish 19 WASM', options: [] };
    };
    const r = await api.load(source, provider, null);
    eq(seen.length, 2, 'the worker was tried twice');
    ok(/^blob:/.test(seen[0]), 'first with the verified bytes in memory');
    eq(seen[1], provider.wasm, 'then pointed at the mirror URL');
    eq(r.bytes, 20000, 'and the engine still starts');
    Object.assign(api.io, saved);
  }

  // 3i. the cache is keyed per build and a bad entry is thrown away instead of being trusted
  {
    const wasm = bytes(30000), jsText = loaderText(6000);
    const source = {
      name: 'Stockfish 19', version: 19, kind: 'full NNUE net, single-thread', full: true, expect: /stockfish\s*19/i,
      bytes: wasm.length, cacheKey: './ct-engine-' + sha(wasm) + '.wasm',
      providers: [{ label: 'unpkg', js: 'https://mirror.test/loader.js', wasm: 'https://mirror.test/engine.wasm',
        pinJs: null, pinWasm: { bytes: wasm.length, sha: sha(wasm) } }]
    };
    const saved = Object.assign({}, api.io);
    const messages = [], wasmFetches = [], puts = [];
    let cachedBytes = bytes(4096);                      // a stale/foreign entry under the right key
    api.io.request = async (url) => {
      if (url.endsWith('.js')) return { ok: true, status: 200, text: async () => jsText };
      wasmFetches.push(url);
      return new Response(wasm, { status: 200, headers: { 'content-length': String(wasm.length) } });
    };
    api.io.cacheGet = async () => cachedBytes;
    api.io.cachePut = (key, buf) => {
      puts.push(key);
      cachedBytes = buf.slice(0, buf.byteLength);        // the real put transfers the buffer, so copy in the test
      return true;
    };
    api.io.report = m => messages.push(m);
    api.io.digest = async buf => sha(buf);
    api.io.probe = async () => ({ w: fakeWorker(), idName: 'Stockfish 19 WASM', options: [] });

    await api.run([source]);
    ok(notes(messages).some(n => /cached copy of Stockfish 19 was not usable/.test(n)), 'the unusable cache entry is reported: ' + notes(messages).join(' | '));
    eq(wasmFetches.length, 1, 'and the engine is downloaded instead');
    eq(puts[0], source.cacheKey, 'what was downloaded is stored under the build key');
    eq(sha(cachedBytes), sha(wasm), 'and it is the verified file');

    messages.length = 0; wasmFetches.length = 0;        // next visit: the good copy is already there
    await api.run([source]);
    eq(wasmFetches.length, 0, 'the next visit downloads no wasm at all');
    eq(engineMsg(messages).cached, true, 'and the engine is reported as coming from the cache');
    eq(notes(messages).length, 0, 'with nothing to complain about');
    Object.assign(api.io, saved);
  }

  // 3j. start(): `ready` goes out first, commands sent while the engine loads are queued and replayed, and the
  //     cache lookup really travels to the panel and back. A fresh module instance is loaded because a page
  //     only ever runs one frame (the previous cases left an engine adopted in this one).
  {
    delete require.cache[require.resolve('../engine-frame.js')];
    const fresh = require('../engine-frame.js');
    const posted = [], listeners = [], asked = [];
    const realAdd = globalThis.addEventListener, realParent = globalThis.parent;
    globalThis.addEventListener = (type, fn) => { if (type === 'message') listeners.push(fn); };
    globalThis.parent = {
      postMessage(m) {
        posted.push(m);
        if (m.ctCacheGet) {                     // what content.js does with a cache lookup: answer, empty here
          asked.push(m.ctCacheGet);
          setTimeout(() => listeners.forEach(fn => fn({ source: globalThis.parent, data: { ctCacheRes: m.id, bytes: null } })), 0);
        }
      },
      addEventListener() {}, removeEventListener() {}
    };
    const worker = { posted: [], postMessage(m) { this.posted.push(m); }, terminate() {} };
    let release; const gate = new Promise(r => { release = r; });
    fresh.io.request = async (url) => url.endsWith('.js')
      ? { ok: true, status: 200, text: async () => loaderText(6000) }
      : new Response(bytes(9000), { status: 200, headers: { 'content-length': '9000' } });
    fresh.io.probe = async () => { await gate; return { w: worker, idName: 'Stockfish 19 WASM', options: [] }; };
    fresh.io.digest = async () => null;

    fresh.start(unpinned());
    ok(posted.some(m => m.ready), 'the panel is told the frame is alive before anything is downloaded');
    const send = cmd => listeners.forEach(fn => fn({ source: globalThis.parent, data: { ctCmd: cmd } }));
    send('uci');                                 // a command while the engine is still downloading
    await new Promise(r => setTimeout(r, 20));
    ok(asked.length >= 1, 'the frame asks the panel for a cached copy before downloading');
    ok(/^\.\/ct-engine-[0-9a-f]{64}\.wasm$/.test(asked[0]), 'the lookup is keyed on the pinned hash: ' + asked[0]);
    ok(!posted.some(m => m.engineName), 'the panel is not told about an engine that has not started yet');
    release();
    await new Promise(r => setTimeout(r, 40));
    eq(worker.posted.join(','), 'uci', 'the command is queued and replayed once the engine is up');
    send('isready');
    eq(worker.posted.join(','), 'uci,isready', 'later commands go straight to the worker');
    eq(posted.filter(m => m.engineName).length, 1, 'the panel is told exactly once which engine it got');
    globalThis.addEventListener = realAdd; globalThis.parent = realParent;
  }

  console.log((failures ? 'FAILED ' : 'OK ') + checks + ' checks, ' + failures + ' failures');
  process.exit(failures ? 1 : 0);
})();
