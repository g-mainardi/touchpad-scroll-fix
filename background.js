const paint = on => {
  const s = on ? 'on' : 'off';
  chrome.action.setIcon({ path: { 16: `icons/${s}-16.png`, 32: `icons/${s}-32.png` } });
};
const sync = () => chrome.storage.local.get({ enabled: true }, s => paint(s.enabled));

chrome.runtime.onStartup.addListener(sync);
chrome.runtime.onInstalled.addListener(sync);
chrome.storage.onChanged.addListener(c => 'enabled' in c && paint(c.enabled.newValue));

// Touchpad scroll handed off by an iframe goes to every frame of its tab; only the parent that knows the gesture id applies it.
chrome.runtime.onMessage.addListener((m, sender) => {
  if (m?.['touchpad-scroll-fix'] && sender.tab) chrome.tabs.sendMessage(sender.tab.id, m).catch(() => {});
});
