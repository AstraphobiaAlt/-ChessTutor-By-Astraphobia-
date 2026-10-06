// Minimal service worker (required by manifest). Nothing else needed.
chrome.runtime.onInstalled.addListener(() => {
  console.log('Chess Tutor installed');
});
