const paint = on => {
  const s = on ? 'on' : 'off';
  chrome.action.setIcon({ path: { 16: `icons/${s}-16.png`, 32: `icons/${s}-32.png` } });
};
const sync = () => chrome.storage.local.get({ enabled: true }, s => paint(s.enabled));

chrome.runtime.onStartup.addListener(sync);
chrome.runtime.onInstalled.addListener(sync);
chrome.storage.onChanged.addListener(c => 'enabled' in c && paint(c.enabled.newValue));
