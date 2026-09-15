# Touchpad Scroll Fix

Estensione per Chrome che riduce la sensibilità dello scroll del touchpad su Linux (GNOME/Wayland) senza toccare la rotella del mouse.

## Installazione

1. Apri `chrome://extensions` e attiva **Modalità sviluppatore**.
2. **Carica estensione non pacchettizzata** e scegli questa cartella.

Con Chrome flatpak la cartella deve stare in un percorso che il sandbox può leggere, per esempio `~/Documents`.

## Come funziona

- Il tipo di dispositivo viene deciso sul primo evento di ogni gesto: la rotella manda scatti interi (`wheelDelta` multiplo di 120), il touchpad valori arbitrari.
- Per i gesti da touchpad annulla lo scroll nativo e scorre lo stesso elemento di `delta × sensibilità`, conservando i decimali.
- Se il gesto parte dentro un iframe che non ha più niente da scorrere, lo scroll ridotto passa alla pagina che lo contiene, come fa lo scroll nativo.
- Non interviene su rotella del mouse, pinch-zoom (Ctrl), siti che gestiscono lo scroll da soli e pagine con lo scroll bloccato.
- La sensibilità si regola dal popup, che ha anche un'area di prova e si può aprire in una finestra separata.

## Sviluppo

- `test.html` verifica la logica: aprilo in Chrome e leggi PASS/FAIL, oppure in headless:
  `google-chrome --headless --allow-file-access-from-files --virtual-time-budget=3000 --dump-dom file://$PWD/test.html`
- `test-iframe.mjs` verifica con eventi di input reali (Chrome headless via DevTools Protocol) touchpad, rotella del mouse e passaggio dello scroll dagli iframe: `node test-iframe.mjs` (di default usa Chrome flatpak, altrimenti `CHROME=google-chrome`).
- `icons/*.svg` sono i sorgenti delle icone PNG.
- Dopo una modifica ricarica l'estensione da `chrome://extensions`; se hai toccato `content.js` ricarica anche le schede aperte.
