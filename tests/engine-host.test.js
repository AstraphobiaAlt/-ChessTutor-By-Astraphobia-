const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const entries = new Map();
const cache = { match: async k => entries.get(k)?.clone(), put: async (k, v) => entries.set(k, v.clone()) };
function host() {
  let listener;
  const up = [], down = [];
  const parent = { postMessage: m => up.push(m) };
  const child = { postMessage: m => down.push(m) };
  vm.runInNewContext(fs.readFileSync('engine-host.js', 'utf8'), {
    ArrayBuffer, URL, Response, Map, parent, location: { href: 'https://extension.test/engine-host.html' },
    caches: { open: async () => cache },
    window: { addEventListener: (_, f) => { listener = f; } },
    document: { createElement: () => ({ contentWindow: child }), body: { appendChild() {} } }
  });
  return { up, down, send: data => listener({ source: child, data }),
    reply: data => listener({ source: parent, origin: 'https://www.chess.com', data }) };
}
(async () => {
  const key = './ct-engine-' + 'a'.repeat(64) + '.wasm';
  const a = host();
  await a.send({ ctCachePut: key, bytes: new Uint8Array([1, 2, 3]).buffer });
  assert(a.up.some(m => m.cacheSaved));
  const b = host(); // a fresh frame after navigating, same extension disk cache
  await b.send({ ctCacheGet: key, id: 'g1' });
  assert(b.down.some(m => m.ctCacheFound === 'g1'));
  assert.deepEqual([...new Uint8Array(b.down.find(m => m.ctCacheRes).bytes)], [1, 2, 3]);
  assert(!b.up.some(m => m.ctCacheGet));
  const other = './ct-engine-' + 'b'.repeat(64) + '.wasm';
  await b.send({ ctCacheGet: other, id: 'g2' });
  assert(b.up.some(m => m.ctCacheGet === other));
  await b.reply({ ctCacheRes: 'g2', bytes: new Uint8Array([4]).buffer });
  const c = host();
  await c.send({ ctCacheGet: other, id: 'g3' });
  assert.equal(new Uint8Array(c.down.find(m => m.ctCacheRes).bytes)[0], 4);
  await c.send({ ctCachePut: '../bad', bytes: new ArrayBuffer(1) });
  assert(c.up.some(m => m.cacheSaveError));
  console.log('OK extension cache survives new frame; migration and invalid keys tested');
})().catch(e => { console.error(e); process.exitCode = 1; });
