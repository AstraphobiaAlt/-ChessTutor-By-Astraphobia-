chrome.runtime.onInstalled.addListener(() => console.log('Chess Tutor installed'));

// Native Messaging avoids exposed HTTP ports, page-origin access, and mixed-content requests.
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'ct-native' || port.sender.id !== chrome.runtime.id) return;
  let host;
  try { host = chrome.runtime.connectNative('ai.chess_tutor.stockfish'); }
  catch (e) { port.postMessage({ error: e.message }); return; }
  let closed = false;
  port.onMessage.addListener(message => {
    if (!closed && typeof message.command === 'string' && message.command.length < 16384 && !/[\r\n]/.test(message.command)) {
      host.postMessage({ command: message.command });
    }
  });
  host.onMessage.addListener(message => { if (!closed) port.postMessage(message); });
  host.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError;
    if (!closed) port.postMessage({ error: error ? error.message : 'Native Stockfish stopped' });
    closed = true;
  });
  port.onDisconnect.addListener(() => { closed = true; host.disconnect(); });
});
