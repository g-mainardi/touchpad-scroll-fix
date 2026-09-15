const $ = id => document.getElementById(id);
document.body.classList.toggle('win', location.search === '?win');
$('test').innerHTML = Array.from({ length: 80 }, (_, i) => `<p>Riga di prova ${i + 1}</p>`).join('');

const show = () => { $('val').value = (+$('factor').value).toFixed(2); };
const save = () => { show(); chrome.storage.local.set({ factor: +$('factor').value }); };

chrome.storage.local.get(S, s => {
  $('enabled').checked = s.enabled;
  $('factor').value = s.factor;
  show();
});
$('enabled').onchange = e => chrome.storage.local.set({ enabled: e.target.checked });
$('factor').oninput = save;
$('minus').onclick = () => { $('factor').stepDown(); save(); };
$('plus').onclick = () => { $('factor').stepUp(); save(); };
$('open').onclick = () => chrome.windows.create({ url: 'popup.html?win', type: 'popup', width: 420, height: 640 });

globalThis.onTsfWheel = (e, touchpad) => {
  $('info').textContent = `${touchpad ? 'Touchpad (corretto)' : 'Mouse (non toccato)'}\n` +
    `deltaY ${e.deltaY.toFixed(1)} · wheelDeltaY ${e.wheelDeltaY}${e.cancelable ? '' : ' · non annullabile'}`;
};
