let creating;
async function ensureEngine() {
  if (creating) return creating;
  creating = (async () => {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL('offscreen.html')] });
    if (!contexts.length) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['WORKERS'], justification: 'Run the bundled Stockfish WebAssembly worker locally to evaluate the detected chess position.' });
  })();
  try { await creating; } finally { creating = null; }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target === 'engine') return false;
  if (message?.type !== 'CI_ANALYZE' || !sender.tab || sender.id !== chrome.runtime.id) return false;
  (async () => {
    const settings = await chrome.storage.local.get({ enabled: true, depth: 14 });
    if (!settings.enabled) throw new Error('التحليل متوقف.');
    await ensureEngine();
    return chrome.runtime.sendMessage({ target: 'engine', type: 'analyze', clientId: sender.tab.id, requestId: message.requestId, fen: message.fen, position: message.position, depth: settings.depth });
  })().then(respond, e => respond({ error: e.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(id => {
  chrome.runtime.sendMessage({ target: 'engine', type: 'cancel', clientId: id }).catch(() => {});
});
