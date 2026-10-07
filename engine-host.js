/* Extension-origin storage broker. The untrusted engine stays in its opaque sandbox;
   large buffers use transferable messages, never chrome.runtime's JSON transport. */
(() => {
  'use strict';
  const frame = document.createElement('iframe');
  const pending = new Map();
  const CACHE = 'chess-tutor-engine-v2';
  const keyFor = name => {
    if (typeof name !== 'string' || !/^\.\/ct-engine-[a-f0-9]{64}\.wasm$/.test(name)) throw new Error('Invalid engine cache key');
    return new URL(name.slice(2), 'https://chess-tutor-cache.invalid/').href;
  };
  const post = (target, msg) => target.postMessage(msg, '*', msg.bytes instanceof ArrayBuffer ? [msg.bytes] : []);
  window.addEventListener('message', async e => {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (e.source === parent) {
      // Only the embedding chess.com page may control this engine.
      if (e.origin !== 'https://www.chess.com' && e.origin !== 'http://www.chess.com') return;
      if (d.ctCacheRes && pending.has(d.ctCacheRes)) {
        const key = pending.get(d.ctCacheRes);
        pending.delete(d.ctCacheRes);
        if (d.bytes instanceof ArrayBuffer) {
          try {
            const cache = await caches.open(CACHE);
            await cache.put(key, new Response(d.bytes));
            post(parent, { ct: true, cacheSaved: true });
          } catch (err) { post(parent, { ct: true, cacheSaveError: err.message }); }
        }
      }
      post(frame.contentWindow, d);
      return;
    }
    if (e.source !== frame.contentWindow) return;
    if (d.ctCacheGet) {
      try {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(keyFor(d.ctCacheGet));
        if (hit) {
          post(parent, { ct: true, cacheSaved: true });
          post(frame.contentWindow, { ctCacheFound: d.id });
          post(frame.contentWindow, { ctCacheRes: d.id, bytes: await hit.arrayBuffer() });
          return;
        }
      } catch (err) {
        post(parent, { ct: true, note: 'Extension cache read failed: ' + err.message });
      }
      try { pending.set(d.id, keyFor(d.ctCacheGet)); } catch (_) {}
      // Migration/fallback: the older version may already have a site-owned copy.
      post(parent, Object.assign({ ct: true }, d));
      return;
    }
    if (d.ctCachePut) {
      try {
        const cache = await caches.open(CACHE);
        await cache.put(keyFor(d.ctCachePut), new Response(d.bytes));
        post(parent, { ct: true, cacheSaved: true });
      } catch (err) {
        post(parent, { ct: true, cacheSaveError: err.message });
        post(parent, Object.assign({ ct: true }, d)); // best-effort legacy fallback if disk is full
      }
      return;
    }
    post(parent, d);
  });
  frame.src = 'engine.html';
  document.body.appendChild(frame);
})();
