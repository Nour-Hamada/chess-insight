const $ = id => document.getElementById(id);
let tab;
const config = await chrome.storage.local.get({ enabled: true, depth: 14 });
$('enabled').checked = config.enabled; $('depth').value = String(config.depth);
[tab] = await chrome.tabs.query({ active: true, currentWindow: true });
async function status() {
  try {
    const state = await chrome.tabs.sendMessage(tab.id, { type: 'CI_STATUS' });
    $('status').textContent = state.found ? 'تم رصد رقعة في هذه الصفحة.' : 'الإضافة جاهزة وتنتظر ظهور رقعة.';
  } catch { $('status').textContent = 'افتح صفحة رقعة، ثم فعّل الإضافة هنا.'; }
}
$('enabled').addEventListener('change', () => chrome.storage.local.set({ enabled: $('enabled').checked }));
$('depth').addEventListener('change', () => chrome.storage.local.set({ depth: Number($('depth').value) }));
$('activate').addEventListener('click', async () => {
  $('activate').disabled = true;
  try {
    const origin = new URL(tab.url).origin;
    if (!/^https?:\/\//.test(origin)) throw new Error('افتح موقع شطرنج عاديًا أولًا.');
    const builtIn = /^https:\/\/(www\.)?chess\.com$/.test(origin) || origin === 'https://lichess.org' || origin === 'https://nour-hamada.github.io';
    if (!builtIn) {
      const pattern = origin + '/*';
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) throw new Error('لم يتم منح إذن هذا الموقع.');
      const id = 'site-' + new URL(origin).host.replace(/[^a-z0-9]/gi, '-');
      const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
      if (!existing.length) await chrome.scripting.registerContentScripts([{ id, matches: [pattern], js: ['content.js'], runAt: 'document_idle', persistAcrossSessions: true }]);
    }
    await chrome.storage.local.set({ enabled: true }); $('enabled').checked = true;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'CI_RESUME' });
    await status();
  } catch (e) { $('status').textContent = e.message; }
  finally { $('activate').disabled = false; }
});
status();
