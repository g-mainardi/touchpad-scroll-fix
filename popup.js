const $ = id => document.getElementById(id);
document.body.classList.toggle('win', location.search === '?win');

const STRINGS = {
  en: {
    enabled: 'Enabled',
    language: 'Language',
    sensitivity: 'Sensitivity',
    decrease: 'Decrease sensitivity',
    increase: 'Increase sensitivity',
    testLine: 'Test line',
    hint: 'Scroll inside the box to try it.',
    open: 'Open in a window',
    touchpad: 'Touchpad (scaled)',
    mouse: 'Mouse (untouched)',
    notCancelable: 'not cancelable',
  },
  it: {
    enabled: 'Attiva',
    language: 'Lingua',
    sensitivity: 'Sensibilità',
    decrease: 'Diminuisci sensibilità',
    increase: 'Aumenta sensibilità',
    testLine: 'Riga di prova',
    hint: 'Scorri nel riquadro per provare.',
    open: 'Apri in una finestra',
    touchpad: 'Touchpad (corretto)',
    mouse: 'Mouse (non toccato)',
    notCancelable: 'non annullabile',
  },
};
let t = STRINGS.en;

const localize = lang => {
  t = STRINGS[lang] ?? STRINGS.en;
  document.documentElement.lang = $('lang').value = STRINGS[lang] ? lang : 'en';
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t[el.dataset.i18n];
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.ariaLabel = t[el.dataset.i18nAria];
  $('test').innerHTML = Array.from({ length: 80 }, (_, i) => `<p>${t.testLine} ${i + 1}</p>`).join('');
};

const show = () => { $('val').value = (+$('factor').value).toFixed(2); };
const save = () => { show(); chrome.storage.local.set({ factor: +$('factor').value }); };

chrome.storage.local.get({ ...S, lang: 'en' }, s => {
  localize(s.lang);
  $('enabled').checked = s.enabled;
  $('factor').value = s.factor;
  show();
});
$('lang').onchange = e => { localize(e.target.value); chrome.storage.local.set({ lang: e.target.value }); };
$('enabled').onchange = e => chrome.storage.local.set({ enabled: e.target.checked });
$('factor').oninput = save;
$('minus').onclick = () => { $('factor').stepDown(); save(); };
$('plus').onclick = () => { $('factor').stepUp(); save(); };
$('open').onclick = () => chrome.windows.create({ url: 'popup.html?win', type: 'popup', width: 420, height: 640 });

globalThis.onTsfWheel = (e, touchpad) => {
  $('info').textContent = `${touchpad ? t.touchpad : t.mouse}\n` +
    `deltaY ${e.deltaY.toFixed(1)} · wheelDeltaY ${e.wheelDeltaY}${e.cancelable ? '' : ` · ${t.notCancelable}`}`;
};
